// Passwords, sessions and invites. Secrets (passwords, session and invite
// tokens) are only ever stored as hashes, and never logged.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { POLICY_KEY, POLICY_VERSION, type Role } from '@easycontract/shared';
import type { Db } from '../db/index.ts';
import { newId, now } from '../db/index.ts';
import { seedExamples } from '../library/store.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };
export const MIN_PASSWORD = 10;
export const SESSION_COOKIE = 'ec_session';
const SESSION_DAYS = 14;
const INVITE_DAYS = 14;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A hash to compare against when the email is unknown, so timing doesn't reveal which emails exist. */
let dummyHash: Promise<string> | null = null;
export const dummyPasswordHash = () => (dummyHash ??= hashPassword(randomBytes(12).toString('hex')));

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `Use a password of at least ${MIN_PASSWORD} characters.`;
  if (password.length > 200) return 'That password is too long.';
  return null;
}

export const normaliseEmail = (e: unknown) => (typeof e === 'string' ? e.trim().toLowerCase() : '');
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

// ---------- Sessions ----------

export function createSession(db: Db, userId: string, tenantId: string): { token: string; maxAge: number } {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare(`INSERT INTO sessions (id, user_id, tenant_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`).run(sha256(token), userId, tenantId, now(), expires);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export function sessionFor(db: Db, token: string): { userId: string; tenantId: string } | null {
  const row = db.prepare(`SELECT user_id, tenant_id, expires_at FROM sessions WHERE id = ?`).get(sha256(token)) as { user_id: string; tenant_id: string; expires_at: string } | undefined;
  if (!row || row.expires_at < now()) return null;
  return { userId: row.user_id, tenantId: row.tenant_id };
}

export const endSession = (db: Db, token: string) => db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sha256(token));

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(token: string, maxAge: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

// ---------- Rate limit ----------

/** Counts failed sign-ins per key in memory. Enough for one small server. */
export class FailureLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max = 10, private windowMs = 15 * 60_000) {}
  blocked(key: string) {
    const recent = (this.hits.get(key) ?? []).filter((t) => t > Date.now() - this.windowMs);
    this.hits.set(key, recent);
    return recent.length >= this.max;
  }
  fail(key: string) { this.hits.set(key, [...(this.hits.get(key) ?? []), Date.now()]); }
  reset(key: string) { this.hits.delete(key); }
}

// ---------- Accounts ----------

export function recordPolicyAcceptance(db: Db, userId: string, tenantId: string, version = POLICY_VERSION) {
  db.prepare(`INSERT INTO policy_acceptances (id, user_id, tenant_id, document_key, version, accepted_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(newId('pol'), userId, tenantId, POLICY_KEY, version, now());
}

export function hasAcceptedPolicy(db: Db, userId: string, tenantId: string) {
  return !!db.prepare(`SELECT 1 FROM policy_acceptances WHERE user_id = ? AND tenant_id = ? AND document_key = ? AND version = ?`)
    .get(userId, tenantId, POLICY_KEY, POLICY_VERSION);
}

/** A new company with its first owner, a plan and the local AI provider. */
export function createCompany(db: Db, input: { companyName: string; userId: string }) {
  const tenantId = newId('ten');
  const t = now();
  db.prepare(`INSERT INTO tenants (id, name, profile_json, created_at) VALUES (?, ?, ?, ?)`).run(tenantId, input.companyName, JSON.stringify({ name: input.companyName }), t);
  db.prepare(`INSERT OR IGNORE INTO plans (id, name, limits_json) VALUES ('local_unlimited', 'Local unlimited', '{}')`).run();
  db.prepare(`INSERT INTO subscriptions (id, tenant_id, plan_id, status, created_at) VALUES (?, ?, 'local_unlimited', 'active', ?)`).run(newId('sub'), tenantId, t);
  db.prepare(`INSERT INTO ai_provider_configs (id, tenant_id, provider_key, model_id, data_residency, allow_external_processing, created_at) VALUES (?, ?, 'deterministic', NULL, 'local', 0, ?)`)
    .run(newId('aic'), tenantId, t);
  addMembership(db, tenantId, input.userId, 'owner');
  seedExamples(db, tenantId);
  return tenantId;
}

export function createUser(db: Db, input: { email: string; name: string; passwordHash: string }) {
  const id = newId('usr');
  const t = now();
  db.prepare(`INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)`).run(id, input.email, input.name, t);
  db.prepare(`INSERT INTO user_credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)`).run(id, input.passwordHash, t);
  return id;
}

export function addMembership(db: Db, tenantId: string, userId: string, role: Role) {
  db.prepare(`INSERT OR IGNORE INTO tenant_memberships (tenant_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`).run(tenantId, userId, role, now());
}

// ---------- Temporary open access ----------

export const OPEN_ACCESS_USER = 'user_open_preview';
const OPEN_ACCESS_EMAIL = 'open-preview@easycontract.invalid';

/**
 * The shared company and user that open-access visitors act as. Created once;
 * it has no password, so nobody can sign in to it normally.
 */
export function ensureOpenAccessAccount(db: Db): { userId: string; tenantId: string } {
  const existing = db.prepare(`SELECT tenant_id FROM tenant_memberships WHERE user_id = ? LIMIT 1`).get(OPEN_ACCESS_USER) as { tenant_id: string } | undefined;
  if (existing) return { userId: OPEN_ACCESS_USER, tenantId: existing.tenant_id };
  db.prepare(`INSERT INTO users (id, email, name, created_at) VALUES (?, ?, 'Open preview visitor', ?)`).run(OPEN_ACCESS_USER, OPEN_ACCESS_EMAIL, now());
  const tenantId = createCompany(db, { companyName: 'Open preview (shared)', userId: OPEN_ACCESS_USER });
  recordPolicyAcceptance(db, OPEN_ACCESS_USER, tenantId);
  return { userId: OPEN_ACCESS_USER, tenantId };
}

// ---------- Invites ----------

export function createInvite(db: Db, input: { tenantId: string; email: string; role: Role; invitedBy: string }) {
  const token = newToken();
  const id = newId('inv');
  const expires = new Date(Date.now() + INVITE_DAYS * 864e5).toISOString();
  db.prepare(`INSERT INTO tenant_invites (id, tenant_id, email, role, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.tenantId, input.email, input.role, sha256(token), input.invitedBy, now(), expires);
  return { id, token, expiresAt: expires };
}

export interface InviteRow { id: string; tenant_id: string; email: string; role: Role; expires_at: string; accepted_at: string | null; revoked_at: string | null; tenant_name: string }

export function inviteByToken(db: Db, token: string): InviteRow | null {
  const r = db.prepare(
    `SELECT i.id, i.tenant_id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, t.name AS tenant_name
     FROM tenant_invites i JOIN tenants t ON t.id = i.tenant_id WHERE i.token_hash = ?`,
  ).get(sha256(token)) as InviteRow | undefined;
  if (!r || r.accepted_at || r.revoked_at || r.expires_at < now()) return null;
  return r;
}
