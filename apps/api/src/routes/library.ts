import type { FastifyInstance } from 'fastify';
import { TOPICS, type PlaybookPositionInput, type Topic } from '@easycontract/shared';
import { type Services, HttpError, audit, notFound, requireCan } from '../lib/context.ts';
import {
  activatePlaybook, addClauseVersion, addPlaybookVersion, createClause, createPlaybook, getClause, getPlaybook, listClauses, listPlaybooks,
} from '../library/store.ts';

const MAX_TEXT = 5000;

function text(v: unknown, field: string, { required = false, max = MAX_TEXT } = {}): string {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be text.`);
  const t = v.trim();
  if (required && !t) throw new HttpError(400, `${field} is required.`);
  if (t.length > max) throw new HttpError(400, `${field} is too long.`);
  return t;
}

function topic(v: unknown): Topic {
  if (!TOPICS.includes(v as Topic)) throw new HttpError(400, 'Pick a topic.');
  return v as Topic;
}

function positionsFrom(v: unknown): PlaybookPositionInput[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'Positions must be a list.');
  const seen = new Set<Topic>();
  const out: PlaybookPositionInput[] = [];
  for (const raw of v as Record<string, unknown>[]) {
    const t = topic(raw?.topic);
    if (seen.has(t)) throw new HttpError(400, 'Each topic can only appear once in a playbook.');
    seen.add(t);
    const p = { topic: t, preferredText: text(raw.preferredText, 'Preferred wording'), fallbackText: text(raw.fallbackText, 'Fallback wording'), redLine: text(raw.redLine, 'Red line') };
    if (p.preferredText || p.fallbackText || p.redLine) out.push(p);
  }
  if (!out.length) throw new HttpError(400, 'Fill in at least one position.');
  return out;
}

export const libraryRoutes = ({ db }: Services) => async (app: FastifyInstance) => {
  const canEdit = (req: { actor: Parameters<typeof requireCan>[1] }, resource?: { type: string; id: string }) =>
    requireCan(db, req.actor, req.actor.role, 'library.edit', resource);

  // ---------- Clause library ----------

  app.get('/api/library/clauses', async (req) => {
    requireCan(db, req.actor, req.actor.role, 'tenant.view');
    return listClauses(db, req.actor.tenantId);
  });

  app.get('/api/library/clauses/:id', async (req) => {
    requireCan(db, req.actor, req.actor.role, 'tenant.view');
    const c = getClause(db, req.actor.tenantId, (req.params as { id: string }).id);
    if (!c) throw notFound();
    return c;
  });

  app.post('/api/library/clauses', async (req, reply) => {
    canEdit(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = createClause(db, req.actor.tenantId, req.actor.userId, {
      topic: topic(b.topic), title: text(b.title, 'Title', { required: true, max: 200 }), text: text(b.text, 'Wording', { required: true }), guidance: text(b.guidance, 'Guidance'),
    });
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'library.clause_create', resourceType: 'library_clauses', resourceId: id, outcome: 'allowed' });
    reply.status(201);
    return getClause(db, req.actor.tenantId, id);
  });

  /** Saving changes adds a new version. Earlier versions stay as they were. */
  app.post('/api/library/clauses/:id/versions', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getClause(db, req.actor.tenantId, id)) throw notFound();
    canEdit(req, { type: 'library_clauses', id });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const version = addClauseVersion(db, req.actor.tenantId, req.actor.userId, id, {
      text: text(b.text, 'Wording', { required: true }), guidance: text(b.guidance, 'Guidance'), title: text(b.title, 'Title', { max: 200 }) || undefined,
    });
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'library.clause_version', resourceType: 'library_clauses', resourceId: id, outcome: 'allowed', metadata: { version } });
    reply.status(201);
    return getClause(db, req.actor.tenantId, id);
  });

  // ---------- Playbooks ----------

  app.get('/api/playbooks', async (req) => {
    requireCan(db, req.actor, req.actor.role, 'tenant.view');
    return listPlaybooks(db, req.actor.tenantId);
  });

  app.get('/api/playbooks/:id', async (req) => {
    requireCan(db, req.actor, req.actor.role, 'tenant.view');
    const p = getPlaybook(db, req.actor.tenantId, (req.params as { id: string }).id);
    if (!p) throw notFound();
    return p;
  });

  app.post('/api/playbooks', async (req, reply) => {
    canEdit(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = text(b.name, 'Name', { required: true, max: 120 });
    if (db.prepare(`SELECT 1 FROM playbooks WHERE tenant_id = ? AND name = ?`).get(req.actor.tenantId, name)) {
      throw new HttpError(409, 'A playbook with that name exists. Edit it to make a new version.');
    }
    const id = createPlaybook(db, req.actor.tenantId, name, positionsFrom(b.positions));
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'playbook.create', resourceType: 'playbooks', resourceId: id, outcome: 'allowed' });
    reply.status(201);
    return getPlaybook(db, req.actor.tenantId, id);
  });

  /** Saving edited positions creates the next version; the version you edited is kept unchanged. */
  app.post('/api/playbooks/:id/versions', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getPlaybook(db, req.actor.tenantId, id)) throw notFound();
    canEdit(req, { type: 'playbooks', id });
    const newIdValue = addPlaybookVersion(db, req.actor.tenantId, id, positionsFrom((req.body as Record<string, unknown> | null)?.positions));
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'playbook.version', resourceType: 'playbooks', resourceId: newIdValue, outcome: 'allowed' });
    reply.status(201);
    return getPlaybook(db, req.actor.tenantId, newIdValue);
  });

  app.post('/api/playbooks/:id/activate', async (req) => {
    const { id } = req.params as { id: string };
    if (!getPlaybook(db, req.actor.tenantId, id)) throw notFound();
    canEdit(req, { type: 'playbooks', id });
    activatePlaybook(db, req.actor.tenantId, id);
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'playbook.activate', resourceType: 'playbooks', resourceId: id, outcome: 'allowed' });
    return getPlaybook(db, req.actor.tenantId, id);
  });

  app.post('/api/playbooks/deactivate', async (req) => {
    canEdit(req);
    activatePlaybook(db, req.actor.tenantId, null);
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'playbook.deactivate', resourceType: 'playbooks', outcome: 'allowed' });
    return { active: null };
  });
};
