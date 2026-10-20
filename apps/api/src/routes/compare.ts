import type { FastifyInstance } from 'fastify';
import {
  AUTHORITATIVE_STATUSES, NEGOTIATION_LABELS, NEGOTIATION_STATUSES, type AmendmentSummary, type CompareResponse, type DocumentRef,
  type EffectivePositionResponse, type ExtractionBlock, type LetterMatchResponse, type NegotiationStatus, type PartyChange,
  type ProposedSignedResponse, type ProposedSignedRow,
} from '@easycontract/shared';
import type { Db } from '../db/index.ts';
import { now } from '../db/index.ts';
import { type Actor, type Services, HttpError, audit, notFound, requireCan } from '../lib/context.ts';
import { alignBlocks, comparable, hasTrackedChanges, stripNumber, summarise } from '../analysis/align.ts';
import { definedTerms, detectPartyChange } from '../analysis/parties.ts';
import { effectivePosition } from '../analysis/amendments.ts';
import { matchLetter } from '../analysis/letters.ts';
import { type DocumentRow, type VersionRow, excerpt, latestVersion, loadDocument, negotiationStatus, versionBlocks } from './documents.ts';
import { loadProject } from './projects.ts';

interface Loaded {
  doc: DocumentRow;
  version: VersionRow;
  blocks: ExtractionBlock[];
  ref: DocumentRef;
}

/** Loads a readable version of a document the caller may see. */
function loadVersion(db: Db, actor: Actor, documentId: string, versionId?: string): Loaded {
  const doc = loadDocument(db, actor, documentId);
  const version = versionId
    ? (db.prepare(`SELECT * FROM document_versions WHERE id = ? AND document_id = ? AND tenant_id = ?`).get(versionId, documentId, actor.tenantId) as VersionRow | undefined)
    : latestVersion(db, actor.tenantId, documentId);
  if (!version) throw notFound();
  if (version.status !== 'ready') throw new HttpError(422, `We couldn't read "${doc.title}", so it can't be compared. Upload a readable copy first.`);
  const { status } = negotiationStatus(db, actor.tenantId, doc);
  return {
    doc, version, blocks: versionBlocks(db, actor.tenantId, version.id),
    ref: { documentId: doc.id, versionId: version.id, title: doc.title, versionNumber: version.version_number, negotiationStatus: status },
  };
}

const isAuthoritative = (s: NegotiationStatus) => AUTHORITATIVE_STATUSES.includes(s);

function trackedWarnings(...docs: Loaded[]): string[] {
  return docs.filter((d) => hasTrackedChanges(d.blocks))
    .map((d) => `"${d.doc.title}" (version ${d.version.version_number}) has unaccepted tracked changes. They are left out of this comparison; accept or reject them in Word and upload again to include them.`);
}

function partyChangesFor(rows: { left: { blockId: string; text: string } | null; right: { blockId: string; text: string } | null; changed: boolean }[], leftTexts: string[], rightTexts: string[]): PartyChange[] {
  const leftNames = definedTerms(leftTexts);
  const rightDefined = definedTerms(rightTexts);
  const out: PartyChange[] = [];
  for (const r of rows) {
    if (!r.changed || !r.left || !r.right) continue;
    const c = detectPartyChange({ leftText: r.left.text, rightText: r.right.text, leftBlockId: r.left.blockId, rightBlockId: r.right.blockId, leftNames, rightDefined });
    if (c) out.push(c);
  }
  return out;
}

export const compareRoutes = ({ db }: Services) => async (app: FastifyInstance) => {
  /** Sets a document's negotiation status. This is the only way a document becomes authoritative. */
  app.put('/api/documents/:documentId/status', async (req) => {
    const { documentId } = req.params as { documentId: string };
    const doc = loadDocument(db, req.actor, documentId);
    const { role } = loadProject(db, req.actor, doc.project_id);
    requireCan(db, req.actor, role, 'document.upload', { type: 'documents', id: documentId });
    const status = (req.body as { negotiationStatus?: string } | null)?.negotiationStatus as NegotiationStatus;
    if (!NEGOTIATION_STATUSES.includes(status)) throw new HttpError(400, 'Pick a valid status.');
    db.prepare(
      `INSERT INTO document_statuses (document_id, tenant_id, negotiation_status, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(document_id) DO UPDATE SET negotiation_status = excluded.negotiation_status, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(documentId, req.actor.tenantId, status, req.actor.userId, now());
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'document.status_update', resourceType: 'documents', resourceId: documentId, outcome: 'allowed', metadata: { status } });
    return { negotiationStatus: status };
  });

  /** Links an amendment, addendum or letter to the agreement it applies to (or clears the link). */
  app.put('/api/documents/:documentId/link', async (req) => {
    const { documentId } = req.params as { documentId: string };
    const doc = loadDocument(db, req.actor, documentId);
    const { role } = loadProject(db, req.actor, doc.project_id);
    requireCan(db, req.actor, role, 'document.upload', { type: 'documents', id: documentId });
    const target = (req.body as { targetDocumentId?: string | null } | null)?.targetDocumentId ?? null;
    if (target) {
      const t = db.prepare(`SELECT id FROM documents WHERE id = ? AND tenant_id = ? AND project_id = ?`).get(target, req.actor.tenantId, doc.project_id);
      if (!t || target === documentId) throw new HttpError(400, 'Pick another document in this project.');
      db.prepare(
        `INSERT INTO document_links (document_id, tenant_id, target_document_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(document_id) DO UPDATE SET target_document_id = excluded.target_document_id`,
      ).run(documentId, req.actor.tenantId, target, req.actor.userId, now());
    } else {
      db.prepare(`DELETE FROM document_links WHERE document_id = ? AND tenant_id = ?`).run(documentId, req.actor.tenantId);
    }
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'document.link_update', resourceType: 'documents', resourceId: documentId, outcome: 'allowed' });
    return { appliesTo: target };
  });

  /** Mode 1: any two versions (of one document or two documents), matched by content. */
  app.get('/api/compare', async (req): Promise<CompareResponse> => {
    const q = req.query as { left?: string; right?: string; leftVersion?: string; rightVersion?: string };
    if (!q.left || !q.right) throw new HttpError(400, 'Pick two documents to compare.');
    const left = loadVersion(db, req.actor, q.left, q.leftVersion);
    const right = loadVersion(db, req.actor, q.right, q.rightVersion);
    if (left.doc.project_id !== right.doc.project_id) throw new HttpError(400, 'Both documents must be in the same project.');
    if (left.version.id === right.version.id) throw new HttpError(400, 'Pick two different versions.');
    const rows = alignBlocks(comparable(left.blocks), comparable(right.blocks));
    const partyChanges = partyChangesFor(
      rows.map((r) => ({ left: r.left, right: r.right, changed: r.status === 'changed' })),
      comparable(left.blocks).map((b) => b.text), comparable(right.blocks).map((b) => b.text),
    );
    return { left: left.ref, right: right.ref, rows, partyChanges, summary: summarise(rows), warnings: trackedWarnings(left, right) };
  });

  /**
   * Mode 3: proposed against signed. Which side is agreed comes only from the
   * negotiation status a person set, never from a name. The two wordings are
   * returned in separate fields and never merged.
   */
  app.get('/api/proposed-vs-signed', async (req): Promise<ProposedSignedResponse> => {
    const q = req.query as { a?: string; b?: string };
    if (!q.a || !q.b) throw new HttpError(400, 'Pick a proposed document and a signed document.');
    const a = loadVersion(db, req.actor, q.a);
    const b = loadVersion(db, req.actor, q.b);
    if (a.doc.project_id !== b.doc.project_id) throw new HttpError(400, 'Both documents must be in the same project.');
    const aAuth = isAuthoritative(a.ref.negotiationStatus);
    const bAuth = isAuthoritative(b.ref.negotiationStatus);
    if (aAuth === bAuth) {
      throw new HttpError(409, aAuth
        ? 'Both documents are marked as agreed or signed. Mark only the signed one as Signed, and the other as Proposed.'
        : 'Neither document is confirmed as agreed or signed. Set the status of the signed one on the project page. File names and words like "final" don\'t count.');
    }
    const [proposed, agreed] = aAuth ? [b, a] : [a, b];
    const aligned = alignBlocks(comparable(proposed.blocks), comparable(agreed.blocks));
    const rows: ProposedSignedRow[] = aligned.map((r) => ({
      status: !r.left ? 'signed_only' : !r.right ? 'proposed_only' : r.status === 'changed' ? 'changed_before_signing' : 'same',
      proposed: r.left,
      agreed: r.right,
      diff: r.diff,
    }));
    const partyChanges = partyChangesFor(
      aligned.map((r) => ({ left: r.left, right: r.right, changed: r.status === 'changed' })),
      comparable(proposed.blocks).map((x) => x.text), comparable(agreed.blocks).map((x) => x.text),
    );
    return { proposed: proposed.ref, agreed: agreed.ref, rows, partyChanges, warnings: trackedWarnings(proposed, agreed) };
  });

  /** Mode 2: the base agreement plus its amendments, as currently in force. */
  app.get('/api/projects/:projectId/effective', async (req): Promise<EffectivePositionResponse> => {
    const { projectId } = req.params as { projectId: string };
    const { role } = loadProject(db, req.actor, projectId);
    requireCan(db, req.actor, role, 'document.view', { type: 'projects', id: projectId });
    const { base: baseId } = req.query as { base?: string };
    if (!baseId) throw new HttpError(400, 'Pick the base agreement.');
    const base = loadVersion(db, req.actor, baseId);
    if (base.doc.project_id !== projectId) throw notFound();

    const earlierNumbers = new Set(
      (db.prepare(`SELECT b.clause_number FROM extraction_blocks b JOIN document_versions v ON v.id = b.version_id
                   WHERE v.document_id = ? AND v.tenant_id = ? AND v.id <> ? AND b.clause_number IS NOT NULL`)
        .all(baseId, req.actor.tenantId, base.version.id) as { clause_number: string }[]).map((r) => r.clause_number),
    );

    // Amendments and addenda that apply to this base: linked to it, or not linked elsewhere.
    const docs = db.prepare(
      `SELECT d.id FROM documents d LEFT JOIN document_links l ON l.document_id = d.id AND l.tenant_id = d.tenant_id
       WHERE d.project_id = ? AND d.tenant_id = ? AND d.role IN ('amendment','addendum') AND d.id <> ?
         AND (l.target_document_id IS NULL OR l.target_document_id = ?)
       ORDER BY d.created_at`,
    ).all(projectId, req.actor.tenantId, baseId, baseId) as { id: string }[];
    const skipped: string[] = [];
    const amendments = docs.flatMap(({ id }) => {
      try { return [loadVersion(db, req.actor, id)]; } catch (err) {
        if (err instanceof HttpError && err.status === 422) skipped.push(err.message);
        else throw err;
        return [];
      }
    });

    const { clauses, results } = effectivePosition(base.blocks, earlierNumbers, amendments.map((a) => ({
      documentId: a.doc.id, title: a.doc.title, authoritative: isAuthoritative(a.ref.negotiationStatus),
      statusLabel: NEGOTIATION_LABELS[a.ref.negotiationStatus], blocks: a.blocks,
    })));

    const summaries: AmendmentSummary[] = results.map((r, i) => ({
      document: amendments[i].ref,
      negotiationStatus: amendments[i].ref.negotiationStatus,
      incorporation: r.incorporation,
      incorporatedCount: r.incorporated,
      instructionCount: r.instructions.length,
      instructions: r.instructions,
    }));

    const baseTexts = comparable(base.blocks).map((b) => b.text);
    const appliedTexts = amendments.filter((a) => isAuthoritative(a.ref.negotiationStatus)).flatMap((a) => comparable(a.blocks).map((b) => b.text));
    const baseById = new Map(comparable(base.blocks).map((b) => [b.id, b]));
    const partyChanges = partyChangesFor(
      clauses.filter((c) => c.baseBlockId && c.changedBy.length && !c.deleted).map((c) => {
        const b = baseById.get(c.baseBlockId!)!;
        return { left: { blockId: b.id, text: stripNumber(b.text, b.clauseNumber) }, right: { blockId: c.changedBy[c.changedBy.length - 1].sourceBlockIds[0], text: c.text }, changed: true };
      }),
      baseTexts, [...baseTexts, ...appliedTexts],
    );

    // Unreadable amendments are left out, and we say so rather than skipping them quietly.
    const warnings = [...skipped.map((m) => `${m.replace(/, so it can't be compared\./, '.')} It is left out of the effective position.`), ...trackedWarnings(base, ...amendments)];
    const baseWarning = isAuthoritative(base.ref.negotiationStatus) ? null
      : `Nobody has confirmed that "${base.doc.title}" is the agreed or signed version (its status is "${NEGOTIATION_LABELS[base.ref.negotiationStatus]}"). Set its status on the project page before relying on this.`;
    return { base: base.ref, baseWarning, clauses, amendments: summaries, partyChanges, warnings };
  });

  /** Matches a letter without clause numbers to the agreement and clause it concerns. */
  app.get('/api/documents/:documentId/letter-match', async (req): Promise<LetterMatchResponse> => {
    const { documentId } = req.params as { documentId: string };
    const letter = loadVersion(db, req.actor, documentId);
    const docs = db.prepare(
      `SELECT id FROM documents WHERE project_id = ? AND tenant_id = ? AND id <> ? AND role IN ('main_agreement','signed_copy','amendment','addendum') ORDER BY created_at`,
    ).all(letter.doc.project_id, req.actor.tenantId, documentId) as { id: string }[];
    const candidates = docs.flatMap(({ id }) => {
      try {
        const c = loadVersion(db, req.actor, id);
        return [{ documentId: c.doc.id, title: c.doc.title, blocks: c.blocks }];
      } catch { return []; }
    });
    const m = matchLetter(letter.blocks, candidates);
    return {
      letter: letter.ref, status: m.status, agreement: m.agreement,
      clause: m.clause ? { blockId: m.clause.blockId, clauseNumber: m.clause.clauseNumber, excerpt: excerpt(m.clause.text, m.clause.clauseNumber) } : null,
      reasons: m.reasons, problems: m.problems,
    };
  });
};

