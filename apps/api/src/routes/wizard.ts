import type { FastifyInstance } from 'fastify';
import {
  CONTRACT_TYPES, POLICY_DISCLAIMER, POLICY_IS_DRAFT, POLICY_VERSION, SEVERITY_LABELS,
  type ContractType, type ContractTypeInfo, type DraftPreview, type DraftSummary, type DocumentRole,
} from '@easycontract/shared';
import type { Db } from '../db/index.ts';
import { newId, now } from '../db/index.ts';
import { type Actor, type Services, HttpError, audit, fileName, notFound, requireCan } from '../lib/context.ts';
import { TYPES, type Answers } from '../wizard/templates.ts';
import { assemble, cleanAnswers, missingEssentials, prefill, toBlocks } from '../wizard/engine.ts';
import { latestLibraryClause } from '../library/store.ts';
import { runFindings } from '../analysis/findings.ts';
import { readProfile } from './tenant.ts';
import type { ReportBlock, ReportDoc } from '../reports/model.ts';
import { renderDocx } from '../reports/docx.ts';
import { renderPdf } from '../reports/pdf.ts';

interface DraftRow { id: string; type: ContractType; title: string; answers_json: string; updated_at: string }

// Types whose essentials match the general review check. Others rely on the wizard's own essential questions.
const REVIEW_ROLE: Record<ContractType, DocumentRole> = {
  service_agreement: 'main_agreement', supply: 'main_agreement', lease: 'main_agreement', nda: 'other', employment: 'other', sales_terms: 'other',
};

const typeInfo = (t: ContractType): ContractTypeInfo => ({ id: t, label: TYPES[t].label, description: TYPES[t].description, questions: TYPES[t].questions });
const summary = (r: DraftRow): DraftSummary => ({ id: r.id, type: r.type, title: r.title, updatedAt: r.updated_at });

function loadDraft(db: Db, actor: Actor, id: string) {
  const r = db.prepare(`SELECT id, type, title, answers_json, updated_at FROM drafts WHERE id = ? AND tenant_id = ?`).get(id, actor.tenantId) as DraftRow | undefined;
  if (!r) throw notFound();
  return { row: r, answers: JSON.parse(r.answers_json) as Answers };
}

export const wizardRoutes = ({ db, playbooks }: Services) => async (app: FastifyInstance) => {
  async function preview(actor: Actor, row: DraftRow, answers: Answers): Promise<DraftPreview> {
    const playbook = await playbooks.activePlaybook(actor.tenantId);
    const sections = assemble(row.type, answers, { playbook, library: (t) => latestLibraryClause(db, actor.tenantId, t) });
    const findings = runFindings({
      versionId: row.id, role: REVIEW_ROLE[row.type], title: row.title, blocks: toBlocks(sections, row.id), projectDocuments: [], playbook,
    });
    return { draft: summary(row), sections, missing: missingEssentials(row.type, answers), findings };
  }

  app.get('/api/wizard/types', async () => CONTRACT_TYPES.map(typeInfo));

  app.get('/api/drafts', async (req) => {
    requireCan(db, req.actor, req.actor.role, 'project.view');
    return (db.prepare(`SELECT id, type, title, answers_json, updated_at FROM drafts WHERE tenant_id = ? ORDER BY updated_at DESC`).all(req.actor.tenantId) as unknown as DraftRow[]).map(summary);
  });

  app.post('/api/drafts', async (req, reply) => {
    requireCan(db, req.actor, req.actor.role, 'project.create');
    const type = (req.body as { type?: string } | null)?.type as ContractType;
    if (!CONTRACT_TYPES.includes(type)) throw new HttpError(400, 'Pick a contract type.');
    const profile = readProfile((db.prepare(`SELECT profile_json FROM tenants WHERE id = ?`).get(req.actor.tenantId) as { profile_json: string }).profile_json);
    const id = newId('drf');
    const t = now();
    const answers = prefill(type, profile);
    db.prepare(`INSERT INTO drafts (id, tenant_id, type, title, answers_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, req.actor.tenantId, type, `${TYPES[type].label} (draft)`, JSON.stringify(answers), req.actor.userId, t, t);
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'draft.create', resourceType: 'drafts', resourceId: id, outcome: 'allowed', metadata: { type } });
    reply.status(201);
    return { draft: summary(loadDraft(db, req.actor, id).row), type: typeInfo(type), answers };
  });

  app.get('/api/drafts/:id', async (req) => {
    const { row, answers } = loadDraft(db, req.actor, (req.params as { id: string }).id);
    return { draft: summary(row), type: typeInfo(row.type), answers };
  });

  app.put('/api/drafts/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { row } = loadDraft(db, req.actor, id);
    requireCan(db, req.actor, req.actor.role, 'project.create', { type: 'drafts', id });
    const body = (req.body ?? {}) as { answers?: unknown; title?: unknown };
    const answers = cleanAnswers(row.type, body.answers);
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : row.title;
    db.prepare(`UPDATE drafts SET answers_json = ?, title = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`).run(JSON.stringify(answers), title, now(), id, req.actor.tenantId);
    return { draft: summary(loadDraft(db, req.actor, id).row), answers };
  });

  app.get('/api/drafts/:id/preview', async (req): Promise<DraftPreview> => {
    const { row, answers } = loadDraft(db, req.actor, (req.params as { id: string }).id);
    return preview(req.actor, row, answers);
  });

  /** The draft contract as an editable Word file or a PDF, with the disclaimer on every page. */
  app.get('/api/drafts/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { format } = req.query as { format?: string };
    if (format !== 'docx' && format !== 'pdf') throw new HttpError(400, 'Choose Word or PDF.');
    const { row, answers } = loadDraft(db, req.actor, id);
    const p = await preview(req.actor, row, answers);
    const doc = contractDoc(row, answers, p);
    const bytes = format === 'docx' ? await renderDocx(doc) : await renderPdf(doc);
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'draft.export', resourceType: 'drafts', resourceId: id, outcome: 'allowed', metadata: { format } });
    reply.header('content-type', format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf');
    reply.header('content-disposition', `attachment; filename="${fileName(row.title, format)}"`);
    reply.header('cache-control', 'no-store');
    return reply.send(bytes);
  });
};

function contractDoc(row: DraftRow, a: Answers, p: DraftPreview): ReportDoc {
  const blocks: ReportBlock[] = [];
  for (const s of p.sections) {
    blocks.push({ type: 'heading', level: 2, text: `${s.number}. ${s.heading}` });
    blocks.push({ type: 'paragraph', text: s.text });
  }
  blocks.push({ type: 'heading', level: 2, text: 'Signatures' });
  const signer = (who: string) => `For ${who}\nSignature: ______________________   Name: ______________________   Date: ______________`;
  blocks.push({ type: 'paragraph', text: signer(a.ourName?.trim() || 'the first party') });
  if (row.type !== 'sales_terms') blocks.push({ type: 'paragraph', text: signer(a.otherName?.trim() || 'the second party') });

  // Notes for the person drafting; clearly marked so they are removed before sending.
  blocks.push({ type: 'rule' });
  blocks.push({ type: 'heading', level: 1, text: 'Drafting notes (remove before sending)' });
  blocks.push({ type: 'paragraph', text: 'Prepared with EasyContract from your answers. Have it reviewed by a legal practitioner before you use it.' });
  if (p.missing.length) {
    blocks.push({ type: 'heading', level: 3, text: 'Missing essentials' });
    for (const m of p.missing) blocks.push({ type: 'warning', text: `Not answered: ${m.label}` });
  }
  if (p.findings.findings.length) {
    blocks.push({ type: 'heading', level: 3, text: 'Risk checks on this draft' });
    for (const f of p.findings.findings) {
      blocks.push({ type: 'label', text: SEVERITY_LABELS[f.severity], tone: f.severity });
      blocks.push({ type: 'paragraph', text: `${f.title}. ${f.plain}` });
    }
  }
  blocks.push({ type: 'heading', level: 3, text: 'Where each clause came from' });
  blocks.push({ type: 'bullets', items: p.sections.map((s) => `${s.number}. ${s.heading}: ${s.source.label}`) });
  const notes = p.sections.flatMap((s) => [s.protective && `${s.number}. ${s.heading}: ${s.protective}`, s.loophole && `${s.number}. ${s.heading}: watch for: ${s.loophole}`].filter(Boolean) as string[]);
  if (notes.length) {
    blocks.push({ type: 'heading', level: 3, text: 'Protective options and common loopholes' });
    blocks.push({ type: 'bullets', items: notes });
  }

  return {
    title: `${TYPES[row.type].label}: draft`,
    meta: [
      row.title,
      `Prepared with EasyContract on ${now().slice(0, 10)}. This is a draft for review, not a final contract.`,
      `Usage policy version ${POLICY_VERSION}${POLICY_IS_DRAFT ? ' (draft, not yet reviewed by a lawyer)' : ''}`,
    ],
    blocks,
    disclaimer: POLICY_DISCLAIMER,
  };
}
