import type { FastifyInstance } from 'fastify';
import type { ProjectSummary, Role } from '@easycontract/shared';
import { newId, now } from '../db/index.ts';
import { type Actor, type Services, HttpError, audit, auditCrossTenant, notFound, requireCan } from '../lib/context.ts';
import { effectiveProjectRole } from '../lib/access-policy.ts';
import type { Db } from '../db/index.ts';
import { listDocuments } from './documents.ts';

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  document_count: number;
}

const toSummary = (r: ProjectRow): ProjectSummary => ({
  id: r.id, name: r.name, description: r.description, createdAt: r.created_at, documentCount: r.document_count,
});

/**
 * Loads a project in the caller's tenant and works out their role on it.
 * Anything else — missing, or another tenant's — is a 404.
 */
export function loadProject(db: Db, actor: Actor, projectId: string): { project: ProjectRow; role: Role } {
  const project = db.prepare(
    `SELECT p.id, p.name, p.description, p.created_at,
            (SELECT COUNT(*) FROM documents d WHERE d.project_id = p.id AND d.tenant_id = p.tenant_id) AS document_count
     FROM projects p WHERE p.id = ? AND p.tenant_id = ?`,
  ).get(projectId, actor.tenantId) as ProjectRow | undefined;
  if (!project) {
    auditCrossTenant(db, actor, 'projects', projectId);
    throw notFound();
  }
  const grant = db.prepare(
    `SELECT role FROM project_grants WHERE project_id = ? AND tenant_id = ? AND user_id = ? AND accepted_at IS NOT NULL LIMIT 1`,
  ).get(projectId, actor.tenantId, actor.userId) as { role: Role } | undefined;
  return { project, role: effectiveProjectRole(actor.role, grant?.role ?? null) };
}

export const projectRoutes = ({ db }: Services) => async (app: FastifyInstance) => {
  app.get('/api/projects', async (req) => {
    requireCan(db, req.actor, req.actor.role, 'project.view');
    const rows = db.prepare(
      `SELECT p.id, p.name, p.description, p.created_at,
              (SELECT COUNT(*) FROM documents d WHERE d.project_id = p.id AND d.tenant_id = p.tenant_id) AS document_count
       FROM projects p WHERE p.tenant_id = ? ORDER BY p.created_at DESC`,
    ).all(req.actor.tenantId) as unknown as ProjectRow[];
    return rows.map(toSummary);
  });

  app.post('/api/projects', async (req, reply) => {
    requireCan(db, req.actor, req.actor.role, 'project.create');
    const body = (req.body ?? {}) as { name?: unknown; description?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new HttpError(400, 'Give the project a name.');
    if (name.length > 200) throw new HttpError(400, 'That name is too long.');
    const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 2000) : null;
    const id = newId('prj');
    const t = now();
    db.prepare(`INSERT INTO projects (id, tenant_id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, req.actor.tenantId, name, description, req.actor.userId, t);
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'project.create', resourceType: 'projects', resourceId: id, outcome: 'allowed' });
    reply.status(201);
    return toSummary({ id, name, description, created_at: t, document_count: 0 });
  });

  app.get('/api/projects/:projectId', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { project, role } = loadProject(db, req.actor, projectId);
    requireCan(db, req.actor, role, 'project.view', { type: 'projects', id: projectId });
    return { ...toSummary(project), role, documents: listDocuments(db, req.actor.tenantId, projectId) };
  });
};
