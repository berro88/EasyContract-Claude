import { describe, expect, it } from 'vitest';
import { asOther, asOwner, createProject, makeApp, makeDocx, SEED, upload } from './helpers.ts';
import { newId, now } from '../src/db/index.ts';

async function setup() {
  const ctx = await makeApp();
  const project = await createProject(ctx.app);
  const res = await upload(ctx.app, project.id, { name: 'c.docx', bytes: await makeDocx(['1. Parties. Acme Ltd and Beta Ltd agree.', '2. Term. One year.']) });
  const docId = res.json().document.id as string;
  const { blocks } = (await ctx.app.inject({ url: `/api/documents/${docId}/blocks`, headers: asOwner })).json();
  return { ...ctx, project, docId, blockId: blocks[0].id as string };
}

describe('tenant isolation', () => {
  it("returns 404 for every route touching another tenant's data", async () => {
    const { app, project, docId, blockId } = await setup();
    const urls = [
      `/api/projects/${project.id}`,
      `/api/documents/${docId}`,
      `/api/documents/${docId}/blocks`,
      `/api/documents/${docId}/file`,
      `/api/blocks/${blockId}`,
      `/api/blocks/${blockId}/passage`,
    ];
    for (const url of urls) {
      const res = await app.inject({ url, headers: asOther });
      expect(res.statusCode, url).toBe(404);
      expect(res.body).not.toContain('Acme');
    }
    const up = await upload(app, project.id, { name: 'x.docx', bytes: await makeDocx(['1. Parties. Someone else.']) }, 'other', asOther);
    expect(up.statusCode).toBe(404);
    const list = (await app.inject({ url: '/api/projects', headers: asOther })).json();
    expect(list).toEqual([]);
  });

  it('audits denied access in the requester\'s tenant without leaking text', async () => {
    const { app, db, docId } = await setup();
    await app.inject({ url: `/api/documents/${docId}/blocks`, headers: asOther });
    const rows = db.prepare(`SELECT * FROM audit_events WHERE action = 'access.denied'`).all() as { tenant_id: string; outcome: string; metadata_json: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(SEED.otherTenantId);
    expect(rows[0].outcome).toBe('denied');
    const everything = JSON.stringify(db.prepare('SELECT * FROM audit_events').all());
    expect(everything).not.toContain('Acme');
  });

  it('rejects requests without a known user', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ url: '/api/projects' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/projects', headers: { 'x-user-id': 'nobody' } })).statusCode).toBe(401);
  });

  it('enforces roles through the access policy and audits the denial', async () => {
    const { app, db, project } = await setup();
    db.prepare(`INSERT INTO users (id, email, name, created_at) VALUES ('user_ro', 'ro@demo.example', 'Read Only', ?)`).run(now());
    db.prepare(`INSERT INTO tenant_memberships (tenant_id, user_id, role, created_at) VALUES (?, 'user_ro', 'read_only', ?)`).run(SEED.tenantId, now());
    const ro = { 'x-user-id': 'user_ro' };
    expect((await app.inject({ url: `/api/projects/${project.id}`, headers: ro })).statusCode).toBe(200);
    const up = await upload(app, project.id, { name: 'x.docx', bytes: await makeDocx(['1. Parties. Acme and Beta.']) }, 'other', ro);
    expect(up.statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/projects', headers: ro, payload: { name: 'nope' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/tenant/profile', headers: ro, payload: { name: 'X' } })).statusCode).toBe(403);
    const denied = db.prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE action = 'access.denied' AND user_id = 'user_ro'`).get();
    expect(denied).toEqual({ n: 3 });

    // A project grant can raise a read-only member to reviewer on one project.
    db.prepare(`INSERT INTO project_grants (id, tenant_id, project_id, user_id, role, accepted_at, created_at) VALUES (?, ?, ?, 'user_ro', 'reviewer', ?, ?)`)
      .run(newId('grt'), SEED.tenantId, project.id, now(), now());
    const up2 = await upload(app, project.id, { name: 'x.docx', bytes: await makeDocx(['1. Parties. Acme and Beta.']) }, 'other', ro);
    expect(up2.statusCode).toBe(201);
  });
});

describe('audit and usage', () => {
  it('records project create, upload and pages processed; stores files under {tenant}/{sha256}', async () => {
    const { db, docId } = await setup();
    const actions = (db.prepare(`SELECT action, outcome FROM audit_events WHERE tenant_id = ?`).all(SEED.tenantId) as { action: string }[]).map((r) => r.action);
    expect(actions).toEqual(['project.create', 'document.upload']);
    const usage = db.prepare(`SELECT kind, quantity FROM usage_events WHERE tenant_id = ?`).all(SEED.tenantId);
    expect(usage).toEqual([{ kind: 'pages_processed', quantity: 1 }]);
    const v = db.prepare(`SELECT storage_key, sha256 FROM document_versions WHERE document_id = ?`).get(docId) as { storage_key: string; sha256: string };
    expect(v.storage_key).toBe(`${SEED.tenantId}/${v.sha256}`);
  });
});
