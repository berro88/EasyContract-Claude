import type { FastifyInstance } from 'fastify';
import {
  type BlockAnchor, type BlockFlag, type BlockKind, DOCUMENT_ROLES, type DocumentRole, type DocumentSummary,
  type DocumentVersionSummary, type ExpertiseLevel, type ExtractionBlock, POLICY_DISCLAIMER,
  TOPICS, TOPIC_LABELS, type ClauseExplanation, type Topic, type TopicBlockRef, type TopicsResponse,
} from '@easycontract/shared';
import type { Db } from '../db/index.ts';
import { newId, now } from '../db/index.ts';
import { type Actor, type Services, HttpError, audit, auditCrossTenant, notFound, recordUsage, requireCan } from '../lib/context.ts';
import { MIME, UnsupportedFileError, detectFileKind, extract } from '../extraction/index.ts';
import { anchorKey, detectFlags, stableBlockId } from '../extraction/common.ts';
import { extractDocx } from '../extraction/docx.ts';
import { readPdfPageText } from '../extraction/pdf.ts';
import { loadProject } from './projects.ts';
import { classifyBlocks } from '../analysis/topics.ts';

interface VersionRow {
  id: string; document_id: string; version_number: number; file_name: string; mime_type: string; size_bytes: number;
  sha256: string; storage_key: string; page_count: number | null; status: 'ready' | 'unreadable'; quality_message: string | null; created_at: string;
}
interface DocumentRow { id: string; project_id: string; title: string; role: DocumentRole; created_at: string }
interface BlockRow { id: string; version_id: string; seq: number; kind: BlockKind; clause_number: string | null; text: string; anchor_json: string; flags_json: string }

const toVersion = (v: VersionRow): DocumentVersionSummary => ({
  id: v.id, versionNumber: v.version_number, fileName: v.file_name, mimeType: v.mime_type, sizeBytes: v.size_bytes,
  sha256: v.sha256, pageCount: v.page_count, status: v.status, qualityMessage: v.quality_message, createdAt: v.created_at,
});

const toBlock = (b: BlockRow): ExtractionBlock => ({
  id: b.id, versionId: b.version_id, seq: b.seq, kind: b.kind, clauseNumber: b.clause_number, text: b.text,
  anchor: JSON.parse(b.anchor_json) as BlockAnchor, flags: JSON.parse(b.flags_json) as BlockFlag[],
});

function latestVersion(db: Db, tenantId: string, documentId: string) {
  return db.prepare(
    `SELECT * FROM document_versions WHERE document_id = ? AND tenant_id = ? ORDER BY version_number DESC LIMIT 1`,
  ).get(documentId, tenantId) as VersionRow | undefined;
}

export function listDocuments(db: Db, tenantId: string, projectId: string): DocumentSummary[] {
  const docs = db.prepare(
    `SELECT id, project_id, title, role, created_at FROM documents WHERE project_id = ? AND tenant_id = ? ORDER BY created_at`,
  ).all(projectId, tenantId) as unknown as DocumentRow[];
  return docs.map((d) => {
    const v = latestVersion(db, tenantId, d.id);
    return { id: d.id, projectId: d.project_id, title: d.title, role: d.role, createdAt: d.created_at, latestVersion: v ? toVersion(v) : null };
  });
}

/** Loads a document in the caller's tenant, checking project-level access. Otherwise 404. */
function loadDocument(db: Db, actor: Actor, documentId: string) {
  const doc = db.prepare(`SELECT id, project_id, title, role, created_at FROM documents WHERE id = ? AND tenant_id = ?`)
    .get(documentId, actor.tenantId) as DocumentRow | undefined;
  if (!doc) {
    auditCrossTenant(db, actor, 'documents', documentId);
    throw notFound();
  }
  const { role } = loadProject(db, actor, doc.project_id);
  requireCan(db, actor, role, 'document.view', { type: 'documents', id: documentId });
  return doc;
}

export function describeLocation(anchor: BlockAnchor, level: ExpertiseLevel): string {
  if (anchor.format === 'pdf') {
    return level === 'plain' ? `page ${anchor.page}` : `page ${anchor.page}, characters ${anchor.charStart}–${anchor.charEnd}`;
  }
  if (level === 'plain') return anchor.revisionId ? 'a tracked change in the Word document' : 'the Word document';
  const parts = [`${anchor.part}, paragraph ${anchor.paragraphId}${anchor.paragraphIdSource === 'position' ? ' (by position)' : ''}`];
  if (anchor.revisionId) parts.push(`revision ${anchor.revisionId}${anchor.author ? ` by ${anchor.author}` : ''}${anchor.date ? ` on ${anchor.date.slice(0, 10)}` : ''}`);
  return parts.join(', ');
}

const MAX_TITLE = 200;
const EXCERPT_CHARS = 160;

function versionBlocks(db: Db, tenantId: string, versionId: string): ExtractionBlock[] {
  return (db.prepare(`SELECT * FROM extraction_blocks WHERE version_id = ? AND tenant_id = ? ORDER BY seq`)
    .all(versionId, tenantId) as unknown as BlockRow[]).map(toBlock);
}

function excerpt(text: string, clauseNumber: string | null) {
  // PDF text often starts with its own typed number; the card already shows it.
  let t = text.replace(/\s+/g, ' ');
  if (clauseNumber) t = t.replace(new RegExp(`^\\s*(?:clause|section|article)?\\s*${clauseNumber.replace(/[.()]/g, '\\$&')}[.)]?\\s+`, 'i'), '');
  return t.length > EXCERPT_CHARS ? `${t.slice(0, EXCERPT_CHARS).trimEnd()}…` : t;
}

/** Sorts a version's blocks into topic cards. Every topic is listed, found or not. */
export function buildTopics(blocks: ExtractionBlock[], versionId: string): TopicsResponse {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const classified = classifyBlocks(blocks);
  const ref = (id: string, heading: string | null): TopicBlockRef => {
    const b = byId.get(id)!;
    return { blockId: b.id, clauseNumber: b.clauseNumber, kind: b.kind, excerpt: excerpt(b.text, b.clauseNumber), heading };
  };
  const cards = new Map<Topic, TopicBlockRef[]>();
  const unsorted: TopicBlockRef[] = [];
  for (const c of classified) {
    if (!c.topics.length) unsorted.push(ref(c.blockId, c.heading));
    for (const t of c.topics) cards.set(t, [...(cards.get(t) ?? []), ref(c.blockId, c.heading)]);
  }
  return {
    versionId,
    cards: TOPICS.filter((t) => cards.has(t)).map((t) => ({ topic: t, label: TOPIC_LABELS[t], blocks: cards.get(t)! })),
    notFound: TOPICS.filter((t) => !cards.has(t)),
    unsorted,
  };
}

export const documentRoutes = ({ db, storage, ai }: Services) => async (app: FastifyInstance) => {
  app.post('/api/projects/:projectId/documents', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const actor = req.actor;
    const { role } = loadProject(db, actor, projectId);
    requireCan(db, actor, role, 'document.upload', { type: 'projects', id: projectId });

    let fileName = '';
    let bytes: Buffer | null = null;
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        fileName = part.filename;
        bytes = await part.toBuffer(); // throws 413 when over the limit
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }
    if (!bytes || !fileName) throw new HttpError(400, 'Choose a file to upload.');
    if (bytes.length === 0) throw new HttpError(400, 'That file is empty.');

    const docRole = (fields.role ?? '') as DocumentRole;
    if (!DOCUMENT_ROLES.includes(docRole)) throw new HttpError(400, 'Pick what this document is (for example "Main agreement").');

    // A new version of an existing document, or a new document.
    let existing: DocumentRow | undefined;
    if (fields.documentId) {
      existing = db.prepare(`SELECT id, project_id, title, role, created_at FROM documents WHERE id = ? AND tenant_id = ? AND project_id = ?`)
        .get(fields.documentId, actor.tenantId, projectId) as DocumentRow | undefined;
      if (!existing) throw notFound();
    }

    let kind;
    let result;
    try {
      kind = detectFileKind(fileName, bytes);
      result = await extract(kind, bytes);
    } catch (err) {
      if (err instanceof UnsupportedFileError) throw new HttpError(415, err.message);
      throw err;
    }

    const stored = await storage.put(actor.tenantId, bytes);
    const t = now();
    const documentId = existing?.id ?? newId('doc');
    const versionId = newId('ver');
    const title = (fields.title?.trim() || fileName.replace(/\.[^.]+$/, '')).slice(0, MAX_TITLE);
    const versionNumber = existing
      ? ((db.prepare(`SELECT MAX(version_number) AS n FROM document_versions WHERE document_id = ? AND tenant_id = ?`)
          .get(documentId, actor.tenantId) as { n: number }).n + 1)
      : 1;
    const status = result.unreadable ? 'unreadable' : 'ready';

    db.exec('BEGIN');
    try {
      if (!existing) {
        db.prepare(`INSERT INTO documents (id, tenant_id, project_id, title, role, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(documentId, actor.tenantId, projectId, title, docRole, actor.userId, t);
      }
      db.prepare(
        `INSERT INTO document_versions (id, tenant_id, document_id, version_number, file_name, mime_type, size_bytes, sha256, storage_key,
           page_count, status, quality_message, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(versionId, actor.tenantId, documentId, versionNumber, fileName.slice(0, 255), MIME[kind], bytes.length, stored.sha256,
        stored.key, result.pageCount, status, result.unreadable, actor.userId, t);

      if (!result.unreadable) {
        const insert = db.prepare(
          `INSERT INTO extraction_blocks (id, tenant_id, version_id, seq, kind, clause_number, text, anchor_json, flags_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const seen = new Map<string, number>();
        result.blocks.forEach((b, i) => {
          const base = anchorKey(b.anchor, b.kind, 0);
          const occurrence = seen.get(base) ?? 0;
          seen.set(base, occurrence + 1);
          const id = stableBlockId(versionId, anchorKey(b.anchor, b.kind, occurrence));
          insert.run(id, actor.tenantId, versionId, i, b.kind, b.clauseNumber, b.text, JSON.stringify(b.anchor), JSON.stringify(detectFlags(b.text)));
        });
      }
      if (result.pageCount) {
        recordUsage(db, { tenantId: actor.tenantId, userId: actor.userId, kind: 'pages_processed', quantity: result.pageCount, refType: 'document_versions', refId: versionId });
      }
      audit(db, { tenantId: actor.tenantId, userId: actor.userId, action: 'document.upload', resourceType: 'documents', resourceId: documentId,
        outcome: 'allowed', metadata: { versionId, format: kind, sizeBytes: bytes.length, pages: result.pageCount, status, role: docRole } });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    reply.status(201);
    return {
      document: listDocuments(db, actor.tenantId, projectId).find((d) => d.id === documentId),
      blockCount: result.unreadable ? 0 : result.blocks.length,
    };
  });

  app.get('/api/documents/:documentId', async (req) => {
    const { documentId } = req.params as { documentId: string };
    const doc = loadDocument(db, req.actor, documentId);
    const versions = db.prepare(`SELECT * FROM document_versions WHERE document_id = ? AND tenant_id = ? ORDER BY version_number DESC`)
      .all(documentId, req.actor.tenantId) as unknown as VersionRow[];
    return { id: doc.id, projectId: doc.project_id, title: doc.title, role: doc.role, createdAt: doc.created_at, versions: versions.map(toVersion) };
  });

  app.get('/api/documents/:documentId/blocks', async (req) => {
    const { documentId } = req.params as { documentId: string };
    const { version } = req.query as { version?: string };
    loadDocument(db, req.actor, documentId);
    const v = version
      ? (db.prepare(`SELECT * FROM document_versions WHERE id = ? AND document_id = ? AND tenant_id = ?`).get(version, documentId, req.actor.tenantId) as VersionRow | undefined)
      : latestVersion(db, req.actor.tenantId, documentId);
    if (!v) throw notFound();
    const blocks = db.prepare(`SELECT * FROM extraction_blocks WHERE version_id = ? AND tenant_id = ? ORDER BY seq`)
      .all(v.id, req.actor.tenantId) as unknown as BlockRow[];
    return { version: toVersion(v), blocks: blocks.map(toBlock) };
  });

  app.get('/api/documents/:documentId/topics', async (req): Promise<TopicsResponse> => {
    const { documentId } = req.params as { documentId: string };
    loadDocument(db, req.actor, documentId);
    const v = latestVersion(db, req.actor.tenantId, documentId);
    if (!v) throw notFound();
    return buildTopics(versionBlocks(db, req.actor.tenantId, v.id), v.id);
  });

  app.get('/api/documents/:documentId/file', async (req, reply) => {
    const { documentId } = req.params as { documentId: string };
    loadDocument(db, req.actor, documentId);
    const v = latestVersion(db, req.actor.tenantId, documentId);
    if (!v) throw notFound();
    const bytes = await storage.get(req.actor.tenantId, v.storage_key);
    reply.header('content-type', v.mime_type);
    reply.header('content-disposition', `inline; filename="${encodeURIComponent(v.file_name)}"`);
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(Buffer.from(bytes));
  });

  /** One block, with a note from the AI provider. Every note names its source block. */
  app.get('/api/blocks/:blockId', async (req) => {
    const { blockId } = req.params as { blockId: string };
    const { level: rawLevel } = req.query as { level?: string };
    const level: ExpertiseLevel = rawLevel === 'legal' ? 'legal' : 'plain';
    const { block, documentId, version } = loadBlock(db, req.actor, blockId);
    const note = await ai.describeBlock({
      blockId: block.id, kind: block.kind, clauseNumber: block.clauseNumber, text: block.text, level,
      location: describeLocation(block.anchor, level),
    });
    // Topics depend on headings around the block, so classify the whole version.
    const c = classifyBlocks(versionBlocks(db, req.actor.tenantId, version.id)).find((x) => x.blockId === block.id);
    const explanations: ClauseExplanation[] = [];
    for (const topic of c?.topics ?? []) {
      explanations.push(await ai.explainClause({ blockId: block.id, text: block.text, topic, level, reasons: c?.reasons[topic] }));
    }
    return { block, documentId, note, heading: c?.heading ?? null, explanations, disclaimer: POLICY_DISCLAIMER };
  });

  /**
   * Opens the exact passage by reading the original file again and following
   * the anchor. `verified` says whether the file still says what we stored.
   */
  app.get('/api/blocks/:blockId/passage', async (req) => {
    const { blockId } = req.params as { blockId: string };
    const { block, version } = loadBlock(db, req.actor, blockId);
    const bytes = await storage.get(req.actor.tenantId, version.storage_key);
    const a = block.anchor;
    if (a.format === 'pdf') {
      const pageText = await readPdfPageText(bytes, a.page);
      const text = pageText.slice(a.charStart, a.charEnd);
      return {
        blockId, text, verified: text === block.text, location: describeLocation(a, 'legal'),
        before: pageText.slice(Math.max(0, a.charStart - 200), a.charStart),
        after: pageText.slice(a.charEnd, a.charEnd + 200),
        disclaimer: POLICY_DISCLAIMER,
      };
    }
    const { blocks } = await extractDocx(bytes);
    const i = blocks.findIndex((b) => b.kind === block.kind && b.anchor.format === 'docx' && b.anchor.paragraphId === a.paragraphId
      && (b.anchor.revisionId ?? null) === (a.revisionId ?? null));
    const found = blocks[i];
    return {
      blockId, text: found?.text ?? null, verified: found?.text === block.text, location: describeLocation(a, 'legal'),
      before: i > 0 ? blocks[i - 1].text : '', after: i >= 0 && i < blocks.length - 1 ? blocks[i + 1].text : '',
      disclaimer: POLICY_DISCLAIMER,
    };
  });
};

function loadBlock(db: Db, actor: Actor, blockId: string) {
  const row = db.prepare(`SELECT * FROM extraction_blocks WHERE id = ? AND tenant_id = ?`).get(blockId, actor.tenantId) as BlockRow | undefined;
  if (!row) {
    auditCrossTenant(db, actor, 'extraction_blocks', blockId);
    throw notFound();
  }
  const version = db.prepare(`SELECT * FROM document_versions WHERE id = ? AND tenant_id = ?`).get(row.version_id, actor.tenantId) as unknown as VersionRow;
  loadDocument(db, actor, version.document_id);
  return { block: toBlock(row), version, documentId: version.document_id };
}
