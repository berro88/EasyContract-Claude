import { describe, expect, it } from 'vitest';
import type { FindingsResponse, LibraryClause, PlaybookSeries, PlaybookVersion } from '@easycontract/shared';
import { asOther, asOwner, createProject, makeApp, makeDocx, upload, SEED } from './helpers.ts';
import { now } from '../src/db/index.ts';

type App = Awaited<ReturnType<typeof makeApp>>['app'];

const post = (app: App, url: string, payload: object = {}, headers: Record<string, string> = asOwner) => app.inject({ method: 'POST', url, headers, payload });
const get = async <T>(app: App, url: string, headers = asOwner) => (await app.inject({ url, headers })).json() as T;

describe('clause library', () => {
  it('versions clauses: editing adds a version and keeps the old one unchanged', async () => {
    const { app } = await makeApp();
    const created = (await post(app, '/api/library/clauses', { topic: 'payment', title: 'Payment terms', text: 'Invoices are payable within 30 days.', guidance: 'Our standard.' })).json();
    expect(created).toMatchObject({ versionCount: 1, latest: { version: 1, text: 'Invoices are payable within 30 days.' } });
    const updated = (await post(app, `/api/library/clauses/${created.id}/versions`, { text: 'Invoices are payable within 21 days.', guidance: 'Shortened.' })).json();
    expect(updated).toMatchObject({ versionCount: 2, latest: { version: 2, text: 'Invoices are payable within 21 days.' } });
    expect(updated.versions.map((v: { version: number; text: string }) => [v.version, v.text])).toEqual([
      [2, 'Invoices are payable within 21 days.'],
      [1, 'Invoices are payable within 30 days.'],
    ]);
  });

  it('only owners and admins edit; other tenants see nothing', async () => {
    const { app, db } = await makeApp();
    db.prepare(`INSERT INTO users (id, email, name, created_at) VALUES ('user_rev', 'rev@demo.example', 'Reviewer', ?)`).run(now());
    db.prepare(`INSERT INTO tenant_memberships (tenant_id, user_id, role, created_at) VALUES (?, 'user_rev', 'reviewer', ?)`).run(SEED.tenantId, now());
    expect((await post(app, '/api/library/clauses', { topic: 'payment', title: 'X', text: 'Y' }, { 'x-user-id': 'user_rev' })).statusCode).toBe(403);
    const c = (await post(app, '/api/library/clauses', { topic: 'payment', title: 'X', text: 'Y' })).json();
    expect((await app.inject({ url: `/api/library/clauses/${c.id}`, headers: asOther })).statusCode).toBe(404);
    expect((await post(app, `/api/library/clauses/${c.id}/versions`, { text: 'Z' }, asOther)).statusCode).toBe(404);
    expect(await get<LibraryClause[]>(app, '/api/library/clauses', asOther)).toEqual([]);
    expect((await post(app, '/api/library/clauses', { topic: 'nonsense', title: 'X', text: 'Y' })).statusCode).toBe(400);
  });

  it('seeds clearly labelled example content that is not active', async () => {
    const { app } = await makeApp();
    const clauses = await get<LibraryClause[]>(app, '/api/library/clauses');
    expect(clauses.length).toBeGreaterThan(0);
    for (const c of clauses) {
      expect(c.isExample).toBe(true);
      expect(c.title).toMatch(/^EXAMPLE/);
      expect(c.latest.guidance).toMatch(/not legal advice/);
    }
    const playbooks = await get<PlaybookSeries[]>(app, '/api/playbooks');
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0]).toMatchObject({ isExample: true, versions: [{ version: 1, isActive: false }] });
    expect(playbooks[0].name).toMatch(/^EXAMPLE .*not legal advice/);
  });
});

const POSITIONS = [
  {
    topic: 'payment',
    preferredText: 'Invoices are payable within 30 days of receipt.',
    fallbackText: 'Invoices are payable within 45 days of receipt.',
    redLine: 'Never accept "payable on demand".',
  },
  { topic: 'governing_law', preferredText: 'This agreement is governed by the laws of Exampleland.', fallbackText: '', redLine: '' },
];

describe('playbooks', () => {
  it('versions playbooks: editing creates the next version, keeps the old positions, and moves the active flag', async () => {
    const { app } = await makeApp();
    const v1 = (await post(app, '/api/playbooks', { name: 'Supplier contracts', positions: POSITIONS })).json() as PlaybookVersion;
    expect(v1).toMatchObject({ version: 1, isActive: false, positions: [{ topic: 'payment' }, { topic: 'governing_law' }] });
    await post(app, `/api/playbooks/${v1.id}/activate`);
    const v2 = (await post(app, `/api/playbooks/${v1.id}/versions`, { positions: [{ ...POSITIONS[0], preferredText: 'Invoices are payable within 14 days of receipt.' }] })).json() as PlaybookVersion;
    expect(v2).toMatchObject({ version: 2, isActive: true, name: 'Supplier contracts' });
    expect(v2.positions).toHaveLength(1);
    const old = await get<PlaybookVersion>(app, `/api/playbooks/${v1.id}`);
    expect(old).toMatchObject({ isActive: false, positions: [{ preferredText: POSITIONS[0].preferredText }, { topic: 'governing_law' }] });

    // Only one active version at a time, across all playbooks.
    await post(app, `/api/playbooks/${v1.id}/activate`);
    const series = (await get<PlaybookSeries[]>(app, '/api/playbooks')).flatMap((s) => s.versions);
    expect(series.filter((v) => v.isActive).map((v) => v.id)).toEqual([v1.id]);

    expect((await post(app, '/api/playbooks', { name: 'Supplier contracts', positions: POSITIONS })).statusCode).toBe(409);
    expect((await post(app, '/api/playbooks', { name: 'Empty', positions: [{ topic: 'payment' }] })).statusCode).toBe(400);
    expect((await post(app, `/api/playbooks/${v1.id}/activate`, {}, asOther)).statusCode).toBe(404);
  });
});

describe('playbook-driven findings', () => {
  async function run(paragraphs: string[], activate = true) {
    const { app } = await makeApp();
    const pb = (await post(app, '/api/playbooks', { name: 'Supplier contracts', positions: POSITIONS })).json() as PlaybookVersion;
    if (activate) await post(app, `/api/playbooks/${pb.id}/activate`);
    const p = await createProject(app);
    const docId = (await upload(app, p.id, { name: 'c.docx', bytes: await makeDocx(paragraphs) })).json().document.id;
    const res = await get<FindingsResponse>(app, `/api/documents/${docId}/findings`);
    return res.findings.filter((f) => f.rule === 'playbook_deviation');
  }
  const LAW = '9.1 This agreement is governed by the laws of Exampleland.';

  it('green when a clause matches the preferred wording', async () => {
    const found = await run(['4.1 Invoices are payable within 30 days of receipt.', LAW]);
    expect(found.map((f) => [f.severity, f.title])).toEqual([
      ['green', 'Matches your preferred wording on payment'],
      ['green', 'Matches your preferred wording on governing law'],
    ]);
    expect(found[0].reference).toMatchObject({ label: 'Preferred wording in your playbook (Supplier contracts, version 1)', text: POSITIONS[0].preferredText });
    expect(found[0].passages[0].clauseNumber).toBe('4.1');
  });

  it('amber when it matches the fallback', async () => {
    const found = await run(['4.1 Invoices are payable within 45 days of receipt.', LAW]);
    expect(found.find((f) => f.title.includes('payment'))).toMatchObject({ severity: 'amber', title: 'Uses your fallback position on payment' });
  });

  it('red when it crosses the red line', async () => {
    const found = await run(['4.1 All invoices are payable on demand.', LAW]);
    const f = found.find((x) => x.title.includes('payment'))!;
    expect(f).toMatchObject({ severity: 'red', title: "Crosses your playbook's red line on payment" });
    expect(f.plain).toContain('"payable on demand"');
    expect(found.filter((x) => x.title.includes('payment'))).toHaveLength(1);
  });

  it('amber when the wording differs from both, or the topic is missing', async () => {
    const found = await run(['4.1 The Client shall settle each invoice at the end of the following quarter by cheque.']);
    expect(found.map((f) => [f.severity, f.title])).toEqual([
      ['amber', 'Differs from your playbook on payment'],
      ['amber', 'Playbook expects a clause on governing law'],
    ]);
  });

  it('nothing when no playbook is active', async () => {
    expect(await run(['4.1 All invoices are payable on demand.', LAW], false)).toEqual([]);
  });
});
