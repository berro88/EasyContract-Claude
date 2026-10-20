import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, type Me, type PlaybookSeries } from '@easycontract/shared';
import { asOwner, makeApp } from './helpers.ts';

type App = Awaited<ReturnType<typeof makeApp>>['app'];

const SIGNUP = { name: 'Alex Example', companyName: 'Example Holdings', email: 'alex@example.test', password: 'correct horse battery', acceptPolicyVersion: POLICY_VERSION };

const cookieFrom = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie']).split(';')[0];
const signup = (app: App, body: object = SIGNUP) => app.inject({ method: 'POST', url: '/api/auth/signup', payload: body });
const login = (app: App, email: string, password: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
const me = async (app: App, cookie: string) => app.inject({ url: '/api/me', headers: { cookie } });

/** Production-like: no dev header shortcut. */
const prodApp = () => makeApp({ config: { devAuth: false, production: true, secureCookies: true } });

describe('sign-up', () => {
  it('requires accepting the current usage policy', async () => {
    const { app } = await prodApp();
    const missing = await signup(app, { ...SIGNUP, acceptPolicyVersion: undefined });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe('policy_required');
    expect((await signup(app, { ...SIGNUP, acceptPolicyVersion: '0.0-old' })).statusCode).toBe(400);
  });

  it('creates a company, records the policy version and date, and signs you in with a secure cookie', async () => {
    const { app, db } = await prodApp();
    const res = await signup(app);
    expect(res.statusCode).toBe(201);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^ec_session=[\w-]{20,};/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/; Secure/);
    const body = (await me(app, cookieFrom(res))).json() as Me;
    expect(body).toMatchObject({ user: { email: 'alex@example.test', name: 'Alex Example' }, tenant: { name: 'Example Holdings' }, role: 'owner', policyAccepted: true, authMode: 'session', plan: 'local_unlimited' });
    const acceptance = db.prepare(`SELECT version, accepted_at FROM policy_acceptances WHERE user_id = ?`).get(body.user.id) as { version: string; accepted_at: string };
    expect(acceptance.version).toBe(POLICY_VERSION);
    expect(acceptance.accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Passwords are stored only as scrypt hashes.
    const cred = db.prepare(`SELECT password_hash FROM user_credentials WHERE user_id = ?`).get(body.user.id) as { password_hash: string };
    expect(cred.password_hash).toMatch(/^scrypt\$/);
    expect(cred.password_hash).not.toContain(SIGNUP.password);
    // New companies get the labelled examples too, switched off.
    const pbs = (await app.inject({ url: '/api/playbooks', headers: { cookie: cookieFrom(res) } })).json() as PlaybookSeries[];
    expect(pbs[0].versions[0].isActive).toBe(false);
  });

  it('rejects weak passwords, bad emails and duplicate accounts', async () => {
    const { app } = await prodApp();
    expect((await signup(app, { ...SIGNUP, password: 'short' })).statusCode).toBe(400);
    expect((await signup(app, { ...SIGNUP, email: 'not-an-email' })).statusCode).toBe(400);
    await signup(app);
    expect((await signup(app, { ...SIGNUP, email: 'ALEX@example.test' })).statusCode).toBe(409);
  });
});

describe('sign-in and sessions', () => {
  it('signs in, signs out, and limits repeated failures', async () => {
    const { app } = await prodApp();
    await signup(app);
    expect((await login(app, 'alex@example.test', 'wrong password!')).statusCode).toBe(401);
    expect((await login(app, 'nobody@example.test', 'wrong password!')).statusCode).toBe(401);
    const ok = await login(app, 'Alex@Example.test', SIGNUP.password);
    expect(ok.statusCode).toBe(200);
    const cookie = cookieFrom(ok);
    expect((await me(app, cookie)).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect((await me(app, cookie)).statusCode).toBe(401);
    for (let i = 0; i < 10; i++) await login(app, 'alex@example.test', 'wrong password!');
    expect((await login(app, 'alex@example.test', SIGNUP.password)).statusCode).toBe(429);
    // Changing the claimed address doesn't reset the count for that email.
    for (let i = 0; i < 25; i++) {
      await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-forwarded-for': `10.0.0.${i}` }, payload: { email: 'alex@example.test', password: 'wrong password!' } });
    }
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-forwarded-for': '10.9.9.9' }, payload: { email: 'alex@example.test', password: SIGNUP.password } })).statusCode).toBe(429);
  });

  it('turns the dev header off in production', async () => {
    const { app } = await prodApp();
    expect((await app.inject({ url: '/api/me', headers: asOwner })).statusCode).toBe(401);
  });

  it('blocks writes from another site', async () => {
    const { app } = await prodApp();
    const cookie = cookieFrom(await signup(app));
    const res = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie, origin: 'https://evil.example', host: 'localhost' }, payload: { name: 'x' } });
    expect(res.statusCode).toBe(403);
    const opaque = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie, origin: 'null', host: 'localhost' }, payload: { name: 'x' } });
    expect(opaque.statusCode).toBe(403);
    const same = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie, origin: 'http://localhost', host: 'localhost' }, payload: { name: 'x' } });
    expect(same.statusCode).toBe(201);
  });

  it('asks for the new policy version before anything else when the policy changes', async () => {
    const { app, db } = await prodApp();
    const cookie = cookieFrom(await signup(app));
    db.prepare(`DELETE FROM policy_acceptances`).run(); // as if a new version was published
    const blocked = await app.inject({ url: '/api/projects', headers: { cookie } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('policy_required');
    expect(((await me(app, cookie)).json() as Me).policyAccepted).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/policy/accept', headers: { cookie }, payload: { version: 'old' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/policy/accept', headers: { cookie }, payload: { version: POLICY_VERSION } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/projects', headers: { cookie } })).statusCode).toBe(200);
  });
});

describe('company invites', () => {
  async function owner() {
    const ctx = await prodApp();
    const cookie = cookieFrom(await signup(ctx.app));
    return { ...ctx, cookie };
  }
  const invite = (app: App, cookie: string, email: string, role: string) => app.inject({ method: 'POST', url: '/api/tenant/invites', headers: { cookie }, payload: { email, role } });
  const tokenOf = (link: string) => link.split('/').pop()!;

  it('invites a new person with a role; no email is sent, the link is shared', async () => {
    const { app, db, cookie } = await owner();
    const inv = await invite(app, cookie, 'sam@example.test', 'reviewer');
    expect(inv.statusCode).toBe(201);
    const { link } = inv.json();
    expect(link).toMatch(/^\/invite\/[\w-]{20,}$/);
    // Only the hash of the token is stored.
    expect(JSON.stringify(db.prepare('SELECT * FROM tenant_invites').all())).not.toContain(tokenOf(link));
    const info = (await app.inject({ url: `/api/auth/invite/${tokenOf(link)}` })).json();
    expect(info).toMatchObject({ companyName: 'Example Holdings', email: 'sam@example.test', role: 'reviewer', existingAccount: false });

    expect((await app.inject({ method: 'POST', url: '/api/auth/accept-invite', payload: { token: tokenOf(link), name: 'Sam', password: 'another long password' } })).statusCode).toBe(400);
    const accepted = await app.inject({ method: 'POST', url: '/api/auth/accept-invite', payload: { token: tokenOf(link), name: 'Sam', password: 'another long password', acceptPolicyVersion: POLICY_VERSION } });
    expect(accepted.statusCode).toBe(200);
    const sam = (await me(app, cookieFrom(accepted))).json() as Me;
    expect(sam).toMatchObject({ role: 'reviewer', tenant: { name: 'Example Holdings' }, policyAccepted: true });
    // The link works once only.
    expect((await app.inject({ url: `/api/auth/invite/${tokenOf(link)}` })).statusCode).toBe(404);
    const members = (await app.inject({ url: '/api/tenant/members', headers: { cookie } })).json() as { email: string; role: string }[];
    expect(members.map((m) => [m.email, m.role])).toEqual([['alex@example.test', 'owner'], ['sam@example.test', 'reviewer']]);
  });

  it('existing users join with their own password, and invites can be withdrawn', async () => {
    const { app, cookie } = await owner();
    // A second company invites Alex, who already has an account.
    const other = cookieFrom(await signup(app, { ...SIGNUP, email: 'kim@example.test', companyName: 'Second Co' }));
    const { link } = (await invite(app, other, 'alex@example.test', 'commenter')).json();
    expect((await app.inject({ url: `/api/auth/invite/${tokenOf(link)}` })).json().existingAccount).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/auth/accept-invite', payload: { token: tokenOf(link), password: 'not my password', acceptPolicyVersion: POLICY_VERSION } })).statusCode).toBe(401);
    const joined = await app.inject({ method: 'POST', url: '/api/auth/accept-invite', payload: { token: tokenOf(link), password: SIGNUP.password, acceptPolicyVersion: POLICY_VERSION } });
    expect(((await me(app, cookieFrom(joined))).json() as Me)).toMatchObject({ role: 'commenter', tenant: { name: 'Second Co' } });

    const second = (await invite(app, cookie, 'lee@example.test', 'read_only')).json();
    expect((await app.inject({ method: 'DELETE', url: `/api/tenant/invites/${second.id}`, headers: { cookie: other } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/tenant/invites/${second.id}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/auth/invite/${tokenOf(second.link)}` })).statusCode).toBe(404);
  });

  it('enforces roles on invites and member changes', async () => {
    const { app, cookie } = await owner();
    const { link } = (await invite(app, cookie, 'ada@example.test', 'admin')).json();
    const admin = cookieFrom(await app.inject({ method: 'POST', url: '/api/auth/accept-invite', payload: { token: tokenOf(link), name: 'Ada', password: 'admins long password', acceptPolicyVersion: POLICY_VERSION } }));
    expect((await invite(app, admin, 'x@example.test', 'owner')).statusCode).toBe(403);
    expect((await invite(app, admin, 'x@example.test', 'reviewer')).statusCode).toBe(201);
    const ownerId = ((await me(app, cookie)).json() as Me).user.id;
    expect((await app.inject({ method: 'PUT', url: `/api/tenant/members/${ownerId}`, headers: { cookie: admin }, payload: { role: 'reviewer' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `/api/tenant/members/${ownerId}`, headers: { cookie }, payload: { role: 'admin' } })).statusCode).toBe(400);
    expect((await invite(app, cookie, 'alex@example.test', 'reviewer')).statusCode).toBe(409);
  });
});
