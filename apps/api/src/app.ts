import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import type { Role } from '@easycontract/shared';
import type { Services } from './lib/context.ts';
import { HttpError } from './lib/context.ts';
import { tenantRoutes } from './routes/tenant.ts';
import { projectRoutes } from './routes/projects.ts';
import { documentRoutes } from './routes/documents.ts';
import { compareRoutes } from './routes/compare.ts';
import { findingsRoutes } from './routes/findings.ts';
import { libraryRoutes } from './routes/library.ts';
import { wizardRoutes } from './routes/wizard.ts';

export async function buildApp(services: Services, opts: { logger?: boolean } = {}) {
  const app = Fastify({
    // Default serializers log method, URL and status only: never request bodies.
    logger: opts.logger ? { level: 'info' } : false,
    bodyLimit: 1024 * 1024,
  });

  await app.register(multipart, {
    limits: { fileSize: services.config.maxUploadBytes, files: 1, fields: 10, fieldSize: 10_000 },
  });

  app.decorateRequest('actor', null as never);

  // Dev authentication: the `x-user-id` header picks the user. Real sign-in
  // replaces this in Stage 8; everything downstream only sees `request.actor`.
  app.addHook('onRequest', async (req) => {
    if (req.url === '/api/health') return;
    const userId = req.headers['x-user-id'];
    if (typeof userId !== 'string' || !userId) throw new HttpError(401, 'Sign in first.');
    const wantedTenant = req.headers['x-tenant-id'];
    const membership = services.db
      .prepare(
        `SELECT tenant_id, role FROM tenant_memberships WHERE user_id = ? ${typeof wantedTenant === 'string' ? 'AND tenant_id = ?' : ''}
         ORDER BY created_at LIMIT 1`,
      )
      .get(...(typeof wantedTenant === 'string' ? [userId, wantedTenant] : [userId])) as { tenant_id: string; role: Role } | undefined;
    if (!membership) throw new HttpError(401, 'Sign in first.');
    req.actor = { userId, tenantId: membership.tenant_id, role: membership.role };
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.statusCode === 413) {
      return reply.status(413).send({ error: `That file is too large. The limit is ${Math.round(services.config.maxUploadBytes / 1024 / 1024)} MB.` });
    }
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    req.log.error({ err: { message: err.message, code: err.code } }, 'request failed');
    return reply.status(500).send({ error: 'Something went wrong on our side.' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(tenantRoutes(services));
  await app.register(projectRoutes(services));
  await app.register(documentRoutes(services));
  await app.register(compareRoutes(services));
  await app.register(findingsRoutes(services));
  await app.register(libraryRoutes(services));
  await app.register(wizardRoutes(services));
  return app;
}
