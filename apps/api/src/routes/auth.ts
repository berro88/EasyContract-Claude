import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { POLICY_VERSION, ROLES, type Role } from '@easycontract/shared';
import { now } from '../db/index.ts';
import { type Services, HttpError, audit, requireCan } from '../lib/context.ts';
import {
  FailureLimiter, SESSION_COOKIE, addMembership, createCompany, createInvite, createSession, createUser, dummyPasswordHash, endSession,
  hashPassword, inviteByToken, normaliseEmail, passwordProblem, readCookie, recordPolicyAcceptance, sessionCookie, validEmail, verifyPassword,
} from '../lib/auth.ts';

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const authRoutes = ({ db, config }: Services) => async (app: FastifyInstance) => {
  const limiter = new FailureLimiter();
  const emailLimiter = new FailureLimiter(30);

  const startSession = (reply: FastifyReply, userId: string, tenantId: string) => {
    const { token, maxAge } = createSession(db, userId, tenantId);
    reply.header('set-cookie', sessionCookie(token, maxAge, config.secureCookies));
  };

  /** The policy version the person ticked must be the current one. */
  const requirePolicy = (v: unknown) => {
    if (v !== POLICY_VERSION) throw new HttpError(400, 'Read and accept the current usage policy to continue.', 'policy_required');
  };

  app.post('/api/auth/signup', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = text(b.name);
    const companyName = text(b.companyName);
    const email = normaliseEmail(b.email);
    if (!name || !companyName) throw new HttpError(400, 'Enter your name and your company name.');
    if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
    const problem = passwordProblem(b.password);
    if (problem) throw new HttpError(400, problem);
    requirePolicy(b.acceptPolicyVersion);
    if (db.prepare(`SELECT 1 FROM users WHERE email = ?`).get(email)) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');

    const passwordHash = await hashPassword(b.password as string);
    db.exec('BEGIN');
    let userId: string;
    let tenantId: string;
    try {
      userId = createUser(db, { email, name, passwordHash });
      tenantId = createCompany(db, { companyName, userId });
      recordPolicyAcceptance(db, userId, tenantId);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    audit(db, { tenantId, userId, action: 'auth.signup', resourceType: 'users', resourceId: userId, outcome: 'allowed', metadata: { policyVersion: POLICY_VERSION } });
    startSession(reply, userId, tenantId);
    reply.status(201);
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const email = normaliseEmail(b.email);
    // Limit per address and per email, so a spoofed forwarding header can't reset the count.
    const keys = [`ip|${req.ip}|${email}`, `email|${email}`];
    if (limiter.blocked(keys[0]) || emailLimiter.blocked(keys[1])) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.');
    const user = db.prepare(`SELECT u.id, c.password_hash FROM users u JOIN user_credentials c ON c.user_id = u.id WHERE u.email = ?`)
      .get(email) as { id: string; password_hash: string } | undefined;
    const ok = await verifyPassword(typeof b.password === 'string' ? b.password : '', user?.password_hash ?? await dummyPasswordHash());
    if (!user || !ok) {
      limiter.fail(keys[0]);
      emailLimiter.fail(keys[1]);
      throw new HttpError(401, "That email and password don't match.");
    }
    limiter.reset(keys[0]);
    emailLimiter.reset(keys[1]);
    const m = db.prepare(`SELECT tenant_id FROM tenant_memberships WHERE user_id = ? ORDER BY created_at LIMIT 1`).get(user.id) as { tenant_id: string } | undefined;
    if (!m) throw new HttpError(403, 'This account is not part of any company.');
    audit(db, { tenantId: m.tenant_id, userId: user.id, action: 'auth.login', resourceType: 'users', resourceId: user.id, outcome: 'allowed' });
    startSession(reply, user.id, m.tenant_id);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) endSession(db, token);
    reply.header('set-cookie', sessionCookie('', 0, config.secureCookies));
    return { ok: true };
  });

  /** Shows who an invite is for, so the person knows what they are joining. */
  app.get('/api/auth/invite/:token', async (req) => {
    const inv = inviteByToken(db, (req.params as { token: string }).token);
    if (!inv) throw new HttpError(404, 'This invite link is not valid. It may have expired, been used or been withdrawn.');
    const existing = !!db.prepare(`SELECT 1 FROM users WHERE email = ?`).get(inv.email);
    return { companyName: inv.tenant_name, email: inv.email, role: inv.role, existingAccount: existing };
  });

  /** Joins the company. New people create an account; existing ones confirm their password. */
  app.post('/api/auth/accept-invite', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const inv = inviteByToken(db, text(b.token, 100));
    if (!inv) throw new HttpError(404, 'This invite link is not valid. It may have expired, been used or been withdrawn.');
    requirePolicy(b.acceptPolicyVersion);
    const existing = db.prepare(`SELECT u.id, c.password_hash FROM users u JOIN user_credentials c ON c.user_id = u.id WHERE u.email = ?`)
      .get(inv.email) as { id: string; password_hash: string } | undefined;
    let userId: string;
    if (existing) {
      if (!(await verifyPassword(typeof b.password === 'string' ? b.password : '', existing.password_hash))) throw new HttpError(401, "That password doesn't match your existing account.");
      userId = existing.id;
    } else {
      const name = text(b.name);
      if (!name) throw new HttpError(400, 'Enter your name.');
      const problem = passwordProblem(b.password);
      if (problem) throw new HttpError(400, problem);
      userId = createUser(db, { email: inv.email, name, passwordHash: await hashPassword(b.password as string) });
    }
    addMembership(db, inv.tenant_id, userId, inv.role);
    recordPolicyAcceptance(db, userId, inv.tenant_id);
    db.prepare(`UPDATE tenant_invites SET accepted_at = ? WHERE id = ?`).run(now(), inv.id);
    audit(db, { tenantId: inv.tenant_id, userId, action: 'invite.accept', resourceType: 'tenant_invites', resourceId: inv.id, outcome: 'allowed', metadata: { role: inv.role, policyVersion: POLICY_VERSION } });
    startSession(reply, userId, inv.tenant_id);
    return { ok: true };
  });

  /** Accepting a new version of the usage policy. */
  app.post('/api/policy/accept', async (req) => {
    requirePolicy((req.body as Record<string, unknown> | null)?.version);
    recordPolicyAcceptance(db, req.actor.userId, req.actor.tenantId);
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'policy.accept', resourceType: 'policy_acceptances', outcome: 'allowed', metadata: { version: POLICY_VERSION } });
    return { policyAccepted: true };
  });

  // ---------- Company members and invites ----------

  app.get('/api/tenant/members', async (req) => {
    requireCan(db, req.actor, req.actor.role, 'tenant.view');
    return db.prepare(`SELECT u.id, u.name, u.email, m.role, m.created_at AS joinedAt FROM tenant_memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? ORDER BY m.created_at`)
      .all(req.actor.tenantId);
  });

  app.put('/api/tenant/members/:userId', async (req: FastifyRequest) => {
    requireCan(db, req.actor, req.actor.role, 'member.invite');
    const { userId } = req.params as { userId: string };
    const role = (req.body as { role?: string } | null)?.role as Role;
    if (!ROLES.includes(role)) throw new HttpError(400, 'Pick a role.');
    const current = db.prepare(`SELECT role FROM tenant_memberships WHERE tenant_id = ? AND user_id = ?`).get(req.actor.tenantId, userId) as { role: Role } | undefined;
    if (!current) throw new HttpError(404, 'Not found');
    if ((role === 'owner' || current.role === 'owner') && req.actor.role !== 'owner') throw new HttpError(403, 'Only an owner can change owners.');
    const owners = (db.prepare(`SELECT COUNT(*) AS n FROM tenant_memberships WHERE tenant_id = ? AND role = 'owner'`).get(req.actor.tenantId) as { n: number }).n;
    if (current.role === 'owner' && role !== 'owner' && owners <= 1) throw new HttpError(400, 'A company needs at least one owner.');
    db.prepare(`UPDATE tenant_memberships SET role = ? WHERE tenant_id = ? AND user_id = ?`).run(role, req.actor.tenantId, userId);
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'member.role_change', resourceType: 'users', resourceId: userId, outcome: 'allowed', metadata: { role } });
    return { role };
  });

  app.get('/api/tenant/invites', async (req) => {
    requireCan(db, req.actor, req.actor.role, 'member.invite');
    return db.prepare(`SELECT id, email, role, created_at AS createdAt, expires_at AS expiresAt FROM tenant_invites
                       WHERE tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC`)
      .all(req.actor.tenantId, now());
  });

  /** No email is sent. The link is returned once, for the inviter to share. */
  app.post('/api/tenant/invites', async (req, reply) => {
    requireCan(db, req.actor, req.actor.role, 'member.invite');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const email = normaliseEmail(b.email);
    const role = b.role as Role;
    if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (!ROLES.includes(role)) throw new HttpError(400, 'Pick a role.');
    if (role === 'owner' && req.actor.role !== 'owner') throw new HttpError(403, 'Only an owner can invite another owner.');
    const member = db.prepare(`SELECT 1 FROM tenant_memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? AND u.email = ?`).get(req.actor.tenantId, email);
    if (member) throw new HttpError(409, 'That person is already in your company.');
    const inv = createInvite(db, { tenantId: req.actor.tenantId, email, role, invitedBy: req.actor.userId });
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'invite.create', resourceType: 'tenant_invites', resourceId: inv.id, outcome: 'allowed', metadata: { role } });
    reply.status(201);
    return { id: inv.id, email, role, expiresAt: inv.expiresAt, link: `/invite/${inv.token}` };
  });

  app.delete('/api/tenant/invites/:id', async (req) => {
    requireCan(db, req.actor, req.actor.role, 'member.invite');
    const { id } = req.params as { id: string };
    const r = db.prepare(`UPDATE tenant_invites SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND accepted_at IS NULL`).run(now(), id, req.actor.tenantId);
    if (!r.changes) throw new HttpError(404, 'Not found');
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'invite.revoke', resourceType: 'tenant_invites', resourceId: id, outcome: 'allowed' });
    return { ok: true };
  });
};
