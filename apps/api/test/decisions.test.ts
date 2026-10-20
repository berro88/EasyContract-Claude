import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { POLICY_DISCLAIMER, type FindingDecision, type FindingsResponse } from '@easycontract/shared';
import { asOther, asOwner, createProject, makeApp, makeDocx, multipart, upload, SEED } from './helpers.ts';
import { now } from '../src/db/index.ts';

type App = Awaited<ReturnType<typeof makeApp>>['app'];

const CONTRACT = [
  '1.1 This agreement is made between Acme Ltd and Beta Ltd.',
  '3.1 The monthly fee is R12,000.',
  '3.2 The fee escalates on each anniversary by [ESCALATION %].',
];

async function setup(paragraphs = CONTRACT) {
  const ctx = await makeApp();
  const p = await createProject(ctx.app);
  const docId = (await upload(ctx.app, p.id, { name: 'c.docx', bytes: await makeDocx(paragraphs) })).json().document.id as string;
  return { ...ctx, p, docId };
}

const findings = async (app: App, docId: string, headers = asOwner) =>
  (await app.inject({ url: `/api/documents/${docId}/findings`, headers })).json() as FindingsResponse;
const decide = (app: App, docId: string, key: string, payload: object, headers: Record<string, string> = asOwner) =>
  app.inject({ method: 'PUT', url: `/api/documents/${docId}/findings/${key}/decision`, headers, payload });
async function newVersion(app: App, projectId: string, docId: string, paragraphs: string[]) {
  const body = multipart({ role: 'main_agreement', documentId: docId }, { name: 'c-v2.docx', bytes: await makeDocx(paragraphs) });
  const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/documents`, headers: { ...asOwner, ...body.headers }, payload: body.payload });
  expect(res.statusCode).toBe(201);
}
const blankFinding = (r: FindingsResponse) => r.findings.find((f) => f.title === 'Price increase has a blank')!;

describe('decisions on findings', () => {
  it('survive reruns', async () => {
    const { app, docId } = await setup();
    const f = blankFinding(await findings(app, docId));
    const res = await decide(app, docId, f.key, { decision: 'negotiate', note: 'Ask for a fixed 5% cap.' });
    expect(res.statusCode).toBe(200);
    for (let i = 0; i < 2; i++) {
      const again = blankFinding(await findings(app, docId));
      expect(again.decision).toMatchObject({ decision: 'negotiate', note: 'Ask for a fixed 5% cap.', decidedBy: 'Demo Owner', wordingChanged: false });
    }
  });

  it('carry over to a new version with the same wording', async () => {
    const { app, p, docId } = await setup();
    await decide(app, docId, blankFinding(await findings(app, docId)).key, { decision: 'accepted' });
    await newVersion(app, p.id, docId, [...CONTRACT, '9.1 This agreement is governed by the laws of Exampleland.']);
    expect(blankFinding(await findings(app, docId)).decision).toMatchObject({ decision: 'accepted', wordingChanged: false });
  });

  it('are flagged when the underlying wording changed', async () => {
    const { app, p, docId } = await setup();
    await decide(app, docId, blankFinding(await findings(app, docId)).key, { decision: 'rejected', note: 'Fine as is.' });
    await newVersion(app, p.id, docId, [CONTRACT[0], CONTRACT[1], '3.2 The fee escalates on each anniversary and on each renewal by [RATE TBC].']);
    const f = blankFinding(await findings(app, docId));
    expect(f.decision).toMatchObject({ decision: 'rejected', wordingChanged: true });
    // Deciding again clears the flag.
    await decide(app, docId, f.key, { decision: 'rejected', note: 'Still fine.' });
    expect(blankFinding(await findings(app, docId)).decision?.wordingChanged).toBe(false);
  });

  it('are kept, and listed, when the finding no longer appears', async () => {
    const { app, p, docId } = await setup();
    await decide(app, docId, blankFinding(await findings(app, docId)).key, { decision: 'negotiate', note: 'Fill the rate.' });
    await newVersion(app, p.id, docId, [CONTRACT[0], CONTRACT[1], '3.2 The fee escalates on each anniversary by 5%.']);
    const r = await findings(app, docId);
    expect(blankFinding(r)).toBeUndefined();
    expect(r.orphanedDecisions).toEqual([expect.objectContaining<Partial<FindingDecision>>({ findingTitle: 'Price increase has a blank', decision: 'negotiate', note: 'Fill the rate.' })]);
  });

  it('need reviewer rights, reject bad input, stay in their tenant and keep notes out of the audit log', async () => {
    const { app, db, docId } = await setup();
    const key = blankFinding(await findings(app, docId)).key;
    db.prepare(`INSERT INTO users (id, email, name, created_at) VALUES ('user_ro', 'ro@demo.example', 'Read Only', ?)`).run(now());
    db.prepare(`INSERT INTO tenant_memberships (tenant_id, user_id, role, created_at) VALUES (?, 'user_ro', 'read_only', ?)`).run(SEED.tenantId, now());
    expect((await decide(app, docId, key, { decision: 'accepted' }, { 'x-user-id': 'user_ro' })).statusCode).toBe(403);
    expect((await decide(app, docId, key, { decision: 'accepted' }, asOther)).statusCode).toBe(404);
    expect((await decide(app, docId, key, { decision: 'maybe' })).statusCode).toBe(400);
    expect((await decide(app, docId, 'fk_nope', { decision: 'accepted' })).statusCode).toBe(404);
    expect((await decide(app, docId, key, { decision: 'accepted', note: 'Secret negotiating position XYZ' })).statusCode).toBe(200);
    expect(JSON.stringify(db.prepare('SELECT * FROM audit_events').all())).not.toContain('XYZ');
    // Clearing both removes the decision.
    await decide(app, docId, key, { decision: null, note: '' });
    expect(blankFinding(await findings(app, docId)).decision).toBeNull();
  });
});

describe('exports', () => {
  // Many missing schedules make many findings, so reports run over several pages.
  const LONG = [...CONTRACT, ...Array.from({ length: 30 }, (_, i) => `${i + 4}.1 The requirements for part ${i + 1} are set out in Schedule ${i + 10}.`)];

  async function exported(format: string) {
    const { app, docId } = await setup(LONG);
    await decide(app, docId, blankFinding(await findings(app, docId)).key, { decision: 'negotiate', note: 'Ask for a fixed rate.' });
    const res = await app.inject({ url: `/api/documents/${docId}/report?format=${format}`, headers: asOwner });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    return res.rawPayload;
  }

  it('Word: editable, with the disclaimer in the footer of every page and the decisions included', async () => {
    const zip = await JSZip.loadAsync(await exported('docx'));
    const doc = await zip.file('word/document.xml')!.async('string');
    const footer = await zip.file('word/footer1.xml')!.async('string');
    expect(footer).toContain(POLICY_DISCLAIMER);
    expect(doc).toMatch(/<w:footerReference w:type="default" r:id="rIdFooter"\/>/);
    expect(doc).toContain('Decision: Negotiate');
    expect(doc).toContain('Ask for a fixed rate.');
    expect(doc).toContain('draft, not yet reviewed by a lawyer');
  });

  it('PDF: the disclaimer is on every page', async () => {
    const pdf = await getDocument({ data: new Uint8Array(await exported('pdf')), isEvalSupported: false }).promise;
    expect(pdf.numPages).toBeGreaterThan(1);
    for (let i = 1; i <= pdf.numPages; i++) {
      const text = (await (await pdf.getPage(i)).getTextContent()).items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ');
      expect(text, `page ${i}`).toContain(POLICY_DISCLAIMER);
    }
    await pdf.destroy();
  });

  it('Excel: disclaimer on every sheet; base data typed, every derived figure a live formula', async () => {
    const zip = await JSZip.loadAsync(await exported('xlsx'));
    const sheets = Object.keys(zip.files).filter((n) => n.startsWith('xl/worksheets/sheet'));
    expect(sheets).toHaveLength(2);
    for (const name of sheets) {
      const xml = await zip.file(name)!.async('string');
      expect(xml).toMatch(new RegExp(`<row r="1"><c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">${POLICY_DISCLAIMER}`));
      expect(xml).toContain(`<oddFooter>&amp;C${POLICY_DISCLAIMER}</oddFooter>`);
    }
    const summary = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    // Every count in column B is a formula with no stored number.
    const bCells = [...summary.matchAll(/<c r="B(\d+)"[^>]*>(.*?)<\/c>/g)].filter((m) => Number(m[1]) >= 4);
    expect(bCells.length).toBe(9);
    for (const m of bCells) {
      expect(m[2]).toMatch(/^<f>/);
      expect(m[2]).not.toContain('<v>');
    }
    expect(summary).toContain('<f>SUM(B4:B6)</f>');
    const data = await zip.file('xl/worksheets/sheet2.xml')!.async('string');
    expect(data).not.toContain('<f>');
    expect(data).toContain('Negotiate');
  });

  it('rejects unknown formats and other tenants', async () => {
    const { app, docId } = await setup();
    expect((await app.inject({ url: `/api/documents/${docId}/report?format=exe`, headers: asOwner })).statusCode).toBe(400);
    expect((await app.inject({ url: `/api/documents/${docId}/report?format=pdf`, headers: asOther })).statusCode).toBe(404);
  });
});
