import type { FastifyInstance } from 'fastify';
import {
  DECISIONS, DECISION_LABELS, FINDING_RULE_LABELS, POLICY_DISCLAIMER, POLICY_IS_DRAFT, POLICY_VERSION, SEVERITY_LABELS,
  type Decision, type Finding, type FindingDecision, type FindingsResponse,
} from '@easycontract/shared';
import type { Db } from '../db/index.ts';
import { newId, now } from '../db/index.ts';
import { type Actor, type Services, HttpError, audit, notFound, requireCan } from '../lib/context.ts';
import { runFindings } from '../analysis/findings.ts';
import { type DocumentRow, type VersionRow, latestVersion, listDocuments, loadDocument, versionBlocks } from './documents.ts';
import { loadProject } from './projects.ts';
import type { ReportBlock, ReportDoc } from '../reports/model.ts';
import { renderDocx } from '../reports/docx.ts';
import { renderPdf } from '../reports/pdf.ts';
import { type Cell, renderXlsx } from '../reports/xlsx.ts';

interface DecisionRow {
  finding_key: string; finding_title: string; decision: Decision | null; note: string; wording_hash: string; decided_at: string; decided_by_name: string;
}

const MAX_NOTE = 2000;

function computeFindings(db: Db, actor: Actor, doc: DocumentRow, v: VersionRow) {
  const projectDocuments = listDocuments(db, actor.tenantId, doc.project_id)
    .filter((d) => d.id !== doc.id && d.latestVersion?.status === 'ready')
    .map((d) => ({ title: d.title, role: d.role }));
  return runFindings({ versionId: v.id, role: doc.role, title: doc.title, blocks: versionBlocks(db, actor.tenantId, v.id), projectDocuments });
}

/** Attaches saved decisions. A decision follows its finding across reruns and new versions. */
function withDecisions(db: Db, tenantId: string, documentId: string, res: FindingsResponse): FindingsResponse {
  const rows = db.prepare(
    `SELECT d.finding_key, d.finding_title, d.decision, d.note, d.wording_hash, d.decided_at, u.name AS decided_by_name
     FROM finding_decisions d JOIN users u ON u.id = d.decided_by WHERE d.document_id = ? AND d.tenant_id = ?`,
  ).all(documentId, tenantId) as unknown as DecisionRow[];
  const byKey = new Map(rows.map((r) => [r.finding_key, r]));
  const toDecision = (r: DecisionRow, f?: Finding): FindingDecision => ({
    findingKey: r.finding_key, findingTitle: r.finding_title, decision: r.decision, note: r.note, decidedBy: r.decided_by_name,
    decidedAt: r.decided_at, wordingChanged: f ? f.wordingHash !== r.wording_hash : false,
  });
  const findings = res.findings.map((f) => ({ ...f, decision: byKey.has(f.key) ? toDecision(byKey.get(f.key)!, f) : null }));
  const live = new Set(res.findings.map((f) => f.key));
  return { ...res, findings, orphanedDecisions: rows.filter((r) => !live.has(r.finding_key)).map((r) => toDecision(r)) };
}

function loadReadable(db: Db, actor: Actor, documentId: string) {
  const doc = loadDocument(db, actor, documentId);
  const v = latestVersion(db, actor.tenantId, documentId);
  if (!v) throw notFound();
  if (v.status !== 'ready') throw new HttpError(422, `We couldn't read "${doc.title}", so it can't be checked for risks.`);
  return { doc, v };
}

// ---------- Reports ----------

function reviewReport(db: Db, actor: Actor, doc: DocumentRow, v: VersionRow, res: FindingsResponse): ReportDoc {
  const company = (db.prepare(`SELECT name FROM tenants WHERE id = ?`).get(actor.tenantId) as { name: string }).name;
  const blocks: ReportBlock[] = [];
  const decided = res.findings.filter((f) => f.decision?.decision).length;

  blocks.push({ type: 'heading', level: 1, text: 'Summary' });
  blocks.push({ type: 'paragraph', text: `${res.summary.red} high concern, ${res.summary.amber} to check, ${res.summary.green} looking covered. Decisions recorded on ${decided} of ${res.findings.length} findings.` });
  const flagged = versionBlocks(db, actor.tenantId, v.id).filter((b) => b.flags.includes('embedded_instruction'));
  if (flagged.length) {
    blocks.push({ type: 'warning', text: `This document contains ${flagged.length} passage(s) with wording that looks like instructions to software. EasyContract treated them as ordinary text and did not act on them. Ask why they are in the contract.` });
  }

  blocks.push({ type: 'heading', level: 1, text: 'Findings' });
  if (!res.findings.length) blocks.push({ type: 'paragraph', text: 'None of the automatic checks found anything in this document.', muted: true });
  for (const f of res.findings) {
    blocks.push({ type: 'label', text: `${SEVERITY_LABELS[f.severity]} · ${FINDING_RULE_LABELS[f.rule]}`, tone: f.severity });
    blocks.push({ type: 'heading', level: 3, text: f.title });
    blocks.push({ type: 'paragraph', text: f.plain });
    blocks.push({ type: 'paragraph', text: `In detail: ${f.legal}`, muted: true });
    if (f.cannotWorkOut) blocks.push({ type: 'paragraph', text: `Can't be worked out: ${f.cannotWorkOut}`, bold: true });
    for (const p of f.passages) {
      blocks.push({ type: 'quote', label: `${p.role === 'related' ? 'Related, ' : ''}${p.clauseNumber ? `clause ${p.clauseNumber}` : 'passage'}:`, text: p.excerpt });
    }
    if (!f.passages.length) blocks.push({ type: 'paragraph', text: 'Not stated anywhere in this document.', muted: true });
    const d = f.decision;
    blocks.push({ type: 'paragraph', bold: true, text: d?.decision ? `Decision: ${DECISION_LABELS[d.decision]} (${d.decidedBy}, ${d.decidedAt.slice(0, 10)})` : 'Decision: none yet' });
    if (d?.note) blocks.push({ type: 'paragraph', text: `Note: ${d.note}` });
    if (d?.wordingChanged) blocks.push({ type: 'warning', text: 'The wording behind this finding has changed since the decision was made. Review the decision again.' });
    blocks.push({ type: 'rule' });
  }

  if (res.orphanedDecisions.length) {
    blocks.push({ type: 'heading', level: 1, text: 'Decisions on findings that no longer appear' });
    blocks.push({ type: 'bullets', items: res.orphanedDecisions.map((d) => `${d.findingTitle}: ${d.decision ? DECISION_LABELS[d.decision] : 'no decision'}${d.note ? ` (note: ${d.note})` : ''}`) });
  }

  blocks.push({ type: 'heading', level: 1, text: 'What was checked' });
  blocks.push({ type: 'bullets', items: res.rulesChecked.map((r) => r.label) });
  blocks.push({ type: 'paragraph', muted: true, text: "These are automatic checks for common problems. They only report what is in the document, and finding nothing doesn't mean the contract is safe." });

  return {
    title: `Contract review: ${doc.title}`,
    meta: [
      `Document: ${v.file_name}, version ${v.version_number}`,
      `Prepared for ${company} on ${now().slice(0, 10)}`,
      `Usage policy version ${POLICY_VERSION}${POLICY_IS_DRAFT ? ' (draft, not yet reviewed by a lawyer)' : ''}`,
    ],
    blocks,
    disclaimer: POLICY_DISCLAIMER,
  };
}

function reviewWorkbook(doc: DocumentRow, v: VersionRow, res: FindingsResponse) {
  const header = ['Severity', 'Check', 'Finding', 'Clauses', 'Explanation', "Can't be worked out", 'Decision', 'Note', 'Wording changed since decision'];
  const first = 4; // data starts on sheet row 4 (row 1 is the disclaimer)
  const last = first + Math.max(res.findings.length, 1) - 1;
  const rows: Cell[][] = [
    [`Findings: ${doc.title} (${v.file_name}, version ${v.version_number})`],
    header,
    ...res.findings.map((f) => [
      SEVERITY_LABELS[f.severity], FINDING_RULE_LABELS[f.rule], f.title,
      f.passages.map((p) => p.clauseNumber ?? 'unnumbered').join(', ') || 'not stated', f.plain, f.cannotWorkOut ?? '',
      f.decision?.decision ? DECISION_LABELS[f.decision.decision] : '', f.decision?.note ?? '', !!f.decision?.wordingChanged,
    ] as Cell[]),
  ];
  const range = (c: string) => `Findings!$${c}$${first}:$${c}$${last}`;
  const count = (c: string, value: string) => ({ formula: `COUNTIF(${range(c)},"${value}")` });
  const summary: Cell[][] = [
    [`Summary: ${doc.title}`],
    ['Measure', 'Count'],
    ['High concern', count('A', SEVERITY_LABELS.red)],
    ['Check this', count('A', SEVERITY_LABELS.amber)],
    ['Looks covered', count('A', SEVERITY_LABELS.green)],
    ['All findings', { formula: 'SUM(B4:B6)' }],
    ['Accepted', count('G', DECISION_LABELS.accepted)],
    ['Rejected', count('G', DECISION_LABELS.rejected)],
    ['Negotiate', count('G', DECISION_LABELS.negotiate)],
    ['No decision yet', { formula: 'B7-SUM(B8:B10)' }],
    ['Decisions to review (wording changed)', { formula: `COUNTIF(${range('I')},TRUE)` }],
  ];
  return [
    { name: 'Summary', rows: summary, widths: [38, 12] },
    { name: 'Findings', rows, widths: [14, 32, 40, 12, 60, 40, 12, 40, 14] },
  ];
}

const CONTENT_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

export const findingsRoutes = ({ db }: Services) => async (app: FastifyInstance) => {
  /** Risk findings for a document's latest version, with any saved decisions. */
  app.get('/api/documents/:documentId/findings', async (req): Promise<FindingsResponse> => {
    const { documentId } = req.params as { documentId: string };
    const { doc, v } = loadReadable(db, req.actor, documentId);
    return withDecisions(db, req.actor.tenantId, documentId, computeFindings(db, req.actor, doc, v));
  });

  /** Records accept / reject / negotiate and a note against a finding. */
  app.put('/api/documents/:documentId/findings/:findingKey/decision', async (req) => {
    const { documentId, findingKey } = req.params as { documentId: string; findingKey: string };
    const { doc, v } = loadReadable(db, req.actor, documentId);
    const { role } = loadProject(db, req.actor, doc.project_id);
    requireCan(db, req.actor, role, 'finding.decide', { type: 'documents', id: documentId });
    const body = (req.body ?? {}) as { decision?: unknown; note?: unknown };
    const decision = body.decision ?? null;
    if (decision !== null && !DECISIONS.includes(decision as Decision)) throw new HttpError(400, 'Pick Accept, Reject or Negotiate.');
    if (body.note !== undefined && typeof body.note !== 'string') throw new HttpError(400, 'The note must be text.');
    const note = ((body.note as string | undefined) ?? '').trim();
    if (note.length > MAX_NOTE) throw new HttpError(400, `Keep the note under ${MAX_NOTE} characters.`);

    // The finding must exist now; its current wording is what the decision is about.
    const finding = computeFindings(db, req.actor, doc, v).findings.find((f) => f.key === findingKey);
    if (!finding) throw new HttpError(404, 'This finding no longer appears. Refresh the findings.');

    if (decision === null && !note) {
      db.prepare(`DELETE FROM finding_decisions WHERE document_id = ? AND tenant_id = ? AND finding_key = ?`).run(documentId, req.actor.tenantId, findingKey);
    } else {
      db.prepare(
        `INSERT INTO finding_decisions (id, tenant_id, document_id, finding_key, finding_title, decision, note, wording_hash, decided_by, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(document_id, finding_key) DO UPDATE SET decision = excluded.decision, note = excluded.note, finding_title = excluded.finding_title,
           wording_hash = excluded.wording_hash, decided_by = excluded.decided_by, decided_at = excluded.decided_at`,
      ).run(newId('dec'), req.actor.tenantId, documentId, findingKey, finding.title, decision as Decision | null, note, finding.wordingHash, req.actor.userId, now());
    }
    // Metadata only: the note is never written to the audit log.
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'finding.decision', resourceType: 'documents', resourceId: documentId,
      outcome: 'allowed', metadata: { rule: finding.rule, decision: (decision as string | null) ?? 'cleared', hasNote: !!note } });
    const updated = withDecisions(db, req.actor.tenantId, documentId, computeFindings(db, req.actor, doc, v));
    return updated.findings.find((f) => f.key === findingKey)!.decision;
  });

  /** Downloads a review report as Word, PDF or Excel. The disclaimer is on every page and sheet. */
  app.get('/api/documents/:documentId/report', async (req, reply) => {
    const { documentId } = req.params as { documentId: string };
    const { format } = req.query as { format?: string };
    if (format !== 'docx' && format !== 'pdf' && format !== 'xlsx') throw new HttpError(400, 'Choose Word, PDF or Excel.');
    const { doc, v } = loadReadable(db, req.actor, documentId);
    const res = withDecisions(db, req.actor.tenantId, documentId, computeFindings(db, req.actor, doc, v));
    const bytes = format === 'xlsx'
      ? await renderXlsx(reviewWorkbook(doc, v, res), POLICY_DISCLAIMER)
      : format === 'docx' ? await renderDocx(reviewReport(db, req.actor, doc, v, res)) : await renderPdf(reviewReport(db, req.actor, doc, v, res));
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'report.export', resourceType: 'documents', resourceId: documentId, outcome: 'allowed', metadata: { format } });
    const fileName = `${doc.title.replace(/[^\w.-]+/g, '-').slice(0, 80)}-review.${format}`;
    reply.header('content-type', CONTENT_TYPES[format]);
    reply.header('content-disposition', `attachment; filename="${fileName}"`);
    reply.header('cache-control', 'no-store');
    return reply.send(bytes);
  });
};
