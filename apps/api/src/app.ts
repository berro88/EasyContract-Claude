import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Writable } from 'node:stream';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { Role } from '@easycontract/shared';
import type { Services } from './lib/context.ts';
import { HttpError } from './lib/context.ts';
import { SESSION_COOKIE, ensureOpenAccessAccount, hasAcceptedPolicy, readCookie, sessionFor } from './lib/auth.ts';
import { authRoutes } from './routes/auth.ts';
import { tenantRoutes } from './routes/tenant.ts';
import { projectRoutes } from './routes/projects.ts';
import { documentRoutes } from './routes/documents.ts';
import { compareRoutes } from './routes/compare.ts';
import { findingsRoutes } from './routes/findings.ts';
import { libraryRoutes } from './routes/library.ts';
import { wizardRoutes } from './routes/wizard.ts';

/** Reachable without signing in. */
const PUBLIC = [/^\/api\/health$/, /^\/api\/policy$/, /^\/api\/auth\/(signup|login|logout|accept-invite|config)$/, /^\/api\/auth\/invite\/[\w-]+$/];
/** Reachable while signed in but before accepting the current usage policy. */
const BEFORE_POLICY = [/^\/api\/me$/, /^\/api\/policy\/accept$/, /^\/api\/auth\/logout$/];

const digest = (s: string) => createHash('sha256').update(s).digest();
/** The host of an Origin header, or null for "null" and anything malformed. */
const originHost = (origin: string) => { try { return new URL(origin).host; } catch { return null; } };

export async function buildApp(services: Services, opts: { logger?: boolean; logStream?: Writable } = {}) {
  const { config, db } = services;
  const app = Fastify({
    // Default serializers log method, URL and status only: never request bodies or file contents.
    logger: opts.logStream ? { level: 'info', stream: opts.logStream } : opts.logger ? { level: 'info' } : false,
    bodyLimit: 1024 * 1024,
    trustProxy: config.production,
  });

  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10, fieldSize: 10_000 },
  });

  app.decorateRequest('actor', null as never);

  // Temporary open access: one shared account for every visitor who isn't signed in.
  const openAccount = config.openAccess ? ensureOpenAccessAccount(db) : null;

  // Security headers on every response.
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('content-security-policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (config.production) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (req.url.startsWith('/api/')) reply.header('cache-control', reply.getHeader('cache-control') ?? 'no-store');
    return payload;
  });

  // Private preview: one shared password for the whole site, from the environment only.
  if (config.previewPassword && !config.openAccess) {
    const expected = digest(config.previewPassword);
    app.addHook('onRequest', async (req, reply) => {
      if (req.url === '/api/health') return;
      const header = req.headers.authorization ?? '';
      const given = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':') : '';
      if (!timingSafeEqual(digest(given), expected)) {
        reply.header('www-authenticate', 'Basic realm="EasyContract preview", charset="UTF-8"');
        throw new HttpError(401, 'This preview is password-protected.');
      }
    });
  }

  // Sign-in: a session cookie, or (outside production only) the x-user-id dev header.
  app.addHook('onRequest', async (req) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/') || PUBLIC.some((r) => r.test(path))) return;

    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const session = token ? sessionFor(db, token) : null;
    if (session) {
      const m = db.prepare(`SELECT role FROM tenant_memberships WHERE user_id = ? AND tenant_id = ?`).get(session.userId, session.tenantId) as { role: Role } | undefined;
      if (!m) throw new HttpError(401, 'Sign in first.');
      // Cookies come with every request, so refuse writes started from another site.
      const origin = req.headers.origin;
      if (req.method !== 'GET' && req.method !== 'HEAD' && origin && originHost(origin) !== req.headers.host) {
        throw new HttpError(403, 'Request blocked: it came from another site.');
      }
      req.actor = { userId: session.userId, tenantId: session.tenantId, role: m.role, via: 'session' };
      if (!BEFORE_POLICY.some((r) => r.test(path)) && !hasAcceptedPolicy(db, session.userId, session.tenantId)) {
        throw new HttpError(403, 'Please read and accept the current usage policy to continue.', 'policy_required');
      }
      return;
    }

    if (openAccount && !(config.devAuth && req.headers['x-user-id'])) {
      req.actor = { userId: openAccount.userId, tenantId: openAccount.tenantId, role: 'owner', via: 'open' };
      return;
    }

    const userId = config.devAuth ? req.headers['x-user-id'] : undefined;
    if (typeof userId !== 'string' || !userId) throw new HttpError(401, 'Sign in first.');
    const wantedTenant = req.headers['x-tenant-id'];
    const membership = db
      .prepare(`SELECT tenant_id, role FROM tenant_memberships WHERE user_id = ? ${typeof wantedTenant === 'string' ? 'AND tenant_id = ?' : ''} ORDER BY created_at LIMIT 1`)
      .get(...(typeof wantedTenant === 'string' ? [userId, wantedTenant] : [userId])) as { tenant_id: string; role: Role } | undefined;
    if (!membership) throw new HttpError(401, 'Sign in first.');
    req.actor = { userId, tenantId: membership.tenant_id, role: membership.role, via: 'dev' };
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.statusCode === 413) {
      return reply.status(413).send({ error: `That file is too large. The limit is ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.` });
    }
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    // Only the message and code are logged: never request bodies or document text.
    req.log.error({ err: { message: err.message, code: err.code } }, 'request failed');
    return reply.status(500).send({ error: 'Something went wrong on our side.' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes(services));
  await app.register(tenantRoutes(services));
  await app.register(projectRoutes(services));
  await app.register(documentRoutes(services));
  await app.register(compareRoutes(services));
  await app.register(findingsRoutes(services));
  await app.register(libraryRoutes(services));
  await app.register(wizardRoutes(services));

  // The built web app, with every non-API path falling back to index.html.
  const dist = config.webDistDir;
  if (dist && existsSync(join(dist, 'index.html'))) {
    await app.register(fastifyStatic, { root: dist, wildcard: false, index: false });
    const indexHtml = readFileSync(join(dist, 'index.html'));
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' });
      const path = req.url.split('?')[0];
      if (path !== '/' && existsSync(join(dist, path)) && !path.includes('..')) return reply.sendFile(path.slice(1));
      return reply.type('text/html').send(indexHtml);
    });
  }
  return app;
}
