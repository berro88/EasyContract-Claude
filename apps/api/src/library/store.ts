// Clause library and playbooks. Both are versioned: an edit always adds a new
// version and never changes an old one.

import {
  EXAMPLE_PREFIX, TOPICS, type LibraryClause, type LibraryClauseVersion, type PlaybookPositionInput, type PlaybookSeries,
  type PlaybookVersion, type Topic,
} from '@easycontract/shared';
import type { Db } from '../db/index.ts';
import { newId, now } from '../db/index.ts';
import type { PlaybookPosition, PlaybookSource } from '../interfaces/index.ts';

const isExampleName = (name: string) => name.startsWith(EXAMPLE_PREFIX);

// ---------- Clause library ----------

interface ClauseRow { id: string; topic: Topic; title: string; is_example: number }
interface VersionRow { id: string; version: number; text: string; guidance: string; created_by_name: string | null; created_at: string }

const toVersion = (v: VersionRow): LibraryClauseVersion => ({
  id: v.id, version: v.version, text: v.text, guidance: v.guidance, createdBy: v.created_by_name, createdAt: v.created_at,
});

export function clauseVersions(db: Db, tenantId: string, clauseId: string): LibraryClauseVersion[] {
  return (db.prepare(
    `SELECT v.id, v.version, v.text, v.guidance, v.created_at, u.name AS created_by_name
     FROM library_clause_versions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.clause_id = ? AND v.tenant_id = ? ORDER BY v.version DESC`,
  ).all(clauseId, tenantId) as unknown as VersionRow[]).map(toVersion);
}

export function listClauses(db: Db, tenantId: string): LibraryClause[] {
  const rows = db.prepare(`SELECT id, topic, title, is_example FROM library_clauses WHERE tenant_id = ? ORDER BY topic, title`)
    .all(tenantId) as unknown as ClauseRow[];
  return rows.map((r) => {
    const versions = clauseVersions(db, tenantId, r.id);
    return { id: r.id, topic: r.topic, title: r.title, isExample: !!r.is_example, latest: versions[0], versionCount: versions.length };
  });
}

export function getClause(db: Db, tenantId: string, clauseId: string) {
  const r = db.prepare(`SELECT id, topic, title, is_example FROM library_clauses WHERE id = ? AND tenant_id = ?`).get(clauseId, tenantId) as ClauseRow | undefined;
  if (!r) return null;
  const versions = clauseVersions(db, tenantId, r.id);
  return { id: r.id, topic: r.topic, title: r.title, isExample: !!r.is_example, latest: versions[0], versionCount: versions.length, versions };
}

export function createClause(db: Db, tenantId: string, userId: string | null, input: { topic: Topic; title: string; text: string; guidance: string; isExample?: boolean }) {
  const id = newId('lcl');
  const t = now();
  db.prepare(`INSERT INTO library_clauses (id, tenant_id, topic, title, is_example, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, tenantId, input.topic, input.title, input.isExample ? 1 : 0, userId, t);
  db.prepare(`INSERT INTO library_clause_versions (id, tenant_id, clause_id, version, text, guidance, created_by, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`)
    .run(newId('lcv'), tenantId, id, input.text, input.guidance, userId, t);
  return id;
}

export function addClauseVersion(db: Db, tenantId: string, userId: string, clauseId: string, input: { text: string; guidance: string; title?: string }) {
  const n = (db.prepare(`SELECT MAX(version) AS n FROM library_clause_versions WHERE clause_id = ? AND tenant_id = ?`).get(clauseId, tenantId) as { n: number }).n;
  db.prepare(`INSERT INTO library_clause_versions (id, tenant_id, clause_id, version, text, guidance, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(newId('lcv'), tenantId, clauseId, n + 1, input.text, input.guidance, userId, now());
  if (input.title) db.prepare(`UPDATE library_clauses SET title = ? WHERE id = ? AND tenant_id = ?`).run(input.title, clauseId, tenantId);
  return n + 1;
}

/** The newest library wording for a topic, if any. Non-example clauses win over examples. */
export function latestLibraryClause(db: Db, tenantId: string, topic: Topic): LibraryClause | null {
  const candidates = listClauses(db, tenantId).filter((c) => c.topic === topic);
  return candidates.find((c) => !c.isExample) ?? candidates[0] ?? null;
}

// ---------- Playbooks ----------

interface PlaybookRow { id: string; name: string; version: number; is_active: number; created_at: string }
interface PositionRow { topic: Topic; preferred_text: string | null; fallback_text: string | null; red_line: string | null }

function positions(db: Db, tenantId: string, playbookId: string): PlaybookPositionInput[] {
  return (db.prepare(`SELECT topic, preferred_text, fallback_text, red_line FROM playbook_positions WHERE playbook_id = ? AND tenant_id = ?`)
    .all(playbookId, tenantId) as unknown as PositionRow[])
    .map((p) => ({ topic: p.topic, preferredText: p.preferred_text ?? '', fallbackText: p.fallback_text ?? '', redLine: p.red_line ?? '' }))
    .sort((a, b) => TOPICS.indexOf(a.topic) - TOPICS.indexOf(b.topic));
}

export function getPlaybook(db: Db, tenantId: string, id: string): PlaybookVersion | null {
  const r = db.prepare(`SELECT id, name, version, is_active, created_at FROM playbooks WHERE id = ? AND tenant_id = ?`).get(id, tenantId) as PlaybookRow | undefined;
  if (!r) return null;
  return { id: r.id, name: r.name, version: r.version, isActive: !!r.is_active, isExample: isExampleName(r.name), createdAt: r.created_at, positions: positions(db, tenantId, r.id) };
}

export function listPlaybooks(db: Db, tenantId: string): PlaybookSeries[] {
  const rows = db.prepare(`SELECT id, name, version, is_active, created_at FROM playbooks WHERE tenant_id = ? ORDER BY name, version DESC`).all(tenantId) as unknown as PlaybookRow[];
  const series = new Map<string, PlaybookSeries>();
  for (const r of rows) {
    const s = series.get(r.name) ?? { name: r.name, isExample: isExampleName(r.name), versions: [] };
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM playbook_positions WHERE playbook_id = ?`).get(r.id) as { n: number }).n;
    s.versions.push({ id: r.id, version: r.version, isActive: !!r.is_active, createdAt: r.created_at, positionCount: count });
    series.set(r.name, s);
  }
  return [...series.values()];
}

function insertPositions(db: Db, tenantId: string, playbookId: string, list: PlaybookPositionInput[]) {
  const stmt = db.prepare(`INSERT INTO playbook_positions (id, tenant_id, playbook_id, topic, preferred_text, fallback_text, red_line, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const t = now();
  for (const p of list) stmt.run(newId('pbp'), tenantId, playbookId, p.topic, p.preferredText || null, p.fallbackText || null, p.redLine || null, t);
}

export function createPlaybook(db: Db, tenantId: string, name: string, list: PlaybookPositionInput[]) {
  const id = newId('pbk');
  db.prepare(`INSERT INTO playbooks (id, tenant_id, name, version, is_active, created_at) VALUES (?, ?, ?, 1, 0, ?)`).run(id, tenantId, name, now());
  insertPositions(db, tenantId, id, list);
  return id;
}

/** Saves edited positions as the next version. If the edited version was active, the new one takes over. */
export function addPlaybookVersion(db: Db, tenantId: string, fromId: string, list: PlaybookPositionInput[]) {
  const from = getPlaybook(db, tenantId, fromId)!;
  const n = (db.prepare(`SELECT MAX(version) AS n FROM playbooks WHERE tenant_id = ? AND name = ?`).get(tenantId, from.name) as { n: number }).n;
  const id = newId('pbk');
  db.prepare(`INSERT INTO playbooks (id, tenant_id, name, version, is_active, created_at) VALUES (?, ?, ?, ?, 0, ?)`).run(id, tenantId, from.name, n + 1, now());
  insertPositions(db, tenantId, id, list);
  if (from.isActive) activatePlaybook(db, tenantId, id);
  return id;
}

export function activatePlaybook(db: Db, tenantId: string, id: string | null) {
  db.prepare(`UPDATE playbooks SET is_active = 0 WHERE tenant_id = ?`).run(tenantId);
  if (id) db.prepare(`UPDATE playbooks SET is_active = 1 WHERE id = ? AND tenant_id = ?`).run(id, tenantId);
}

export interface ActivePlaybook {
  id: string;
  name: string;
  version: number;
  isExample: boolean;
  positions: PlaybookPosition[];
}

/** Reads playbooks from this database. Other sources (a shared library, a connector) can implement the same interface. */
export class DbPlaybookSource implements PlaybookSource {
  constructor(private db: Db) {}

  async activePlaybook(tenantId: string): Promise<ActivePlaybook | null> {
    const r = this.db.prepare(`SELECT id FROM playbooks WHERE tenant_id = ? AND is_active = 1 LIMIT 1`).get(tenantId) as { id: string } | undefined;
    const p = r && getPlaybook(this.db, tenantId, r.id);
    if (!p) return null;
    return {
      id: p.id, name: p.name, version: p.version, isExample: p.isExample,
      positions: p.positions.map((x) => ({ topic: x.topic, preferredText: x.preferredText || null, fallbackText: x.fallbackText || null, redLine: x.redLine || null })),
    };
  }

  async activePositions(tenantId: string): Promise<PlaybookPosition[]> {
    return (await this.activePlaybook(tenantId))?.positions ?? [];
  }
}

// ---------- Examples ----------

/**
 * Clearly labelled example content so the features can be tried. It is not
 * legal content: every title starts with EXAMPLE and says to replace it.
 */
const EXAMPLE_NOTE = 'Illustrative wording only, not legal advice. Replace it with wording approved by your lawyer.';

export const EXAMPLE_POSITIONS: PlaybookPositionInput[] = [
  {
    topic: 'liability_caps',
    preferredText: "Each party's total liability under this agreement is limited to the fees paid in the 12 months before the claim.",
    fallbackText: "Each party's total liability under this agreement is limited to the fees paid in the 24 months before the claim.",
    redLine: 'Never accept "unlimited liability" or "without limit".',
  },
  {
    topic: 'payment',
    preferredText: 'Invoices are payable within 30 days of receipt.',
    fallbackText: 'Invoices are payable within 45 days of receipt.',
    redLine: 'Never accept "payable on demand" or "payable in advance".',
  },
  {
    topic: 'termination_notice',
    preferredText: "Either party may terminate this agreement on 90 days' written notice.",
    fallbackText: "Either party may terminate this agreement on 60 days' written notice.",
    redLine: 'Never accept "terminate immediately without cause".',
  },
];

export function seedExamples(db: Db, tenantId: string) {
  const name = `${EXAMPLE_PREFIX} playbook (illustrative, not legal advice)`;
  const has = db.prepare(`SELECT 1 FROM playbooks WHERE tenant_id = ? AND name = ?`).get(tenantId, name);
  if (!has) createPlaybook(db, tenantId, name, EXAMPLE_POSITIONS); // inactive until someone activates it
  const hasClauses = db.prepare(`SELECT 1 FROM library_clauses WHERE tenant_id = ? AND is_example = 1`).get(tenantId);
  if (!hasClauses) {
    for (const p of EXAMPLE_POSITIONS) {
      createClause(db, tenantId, null, { topic: p.topic, title: `${EXAMPLE_PREFIX}: ${p.topic.replace(/_/g, ' ')}`, text: p.preferredText, guidance: EXAMPLE_NOTE, isExample: true });
    }
  }
}
