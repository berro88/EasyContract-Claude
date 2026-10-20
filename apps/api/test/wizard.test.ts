import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { CONTRACT_TYPES, POLICY_DISCLAIMER, type ContractType, type ContractTypeInfo, type DraftPreview, type PlaybookSeries } from '@easycontract/shared';
import { asOther, asOwner, makeApp, SEED } from './helpers.ts';
import { now } from '../src/db/index.ts';
import { EXAMPLE_POSITIONS } from '../src/library/store.ts';

type App = Awaited<ReturnType<typeof makeApp>>['app'];

const PROFILE = { name: 'Demo Company', legalName: 'Demo Company (Pty) Ltd', registrationNumber: '2020/123456/07', address: '1 Example Street', country: 'Exampleland', industry: '', contactEmail: '' };

/** A full set of plausible answers for a type, including the follow-up questions. */
function answersFor(info: ContractTypeInfo): Record<string, string> {
  const special: Record<string, string> = {
    otherName: 'Sample Client Ltd', fee: 'R12,000 per month', price: 'R50 per unit', rent: 'R20,000 per month', salary: 'R25,000 per month',
    escalation: 'fixed', escalationPercent: '6', liabilityCap: 'fees12', lateInterestRate: '2% per month', deposit: 'R40,000',
    governingLaw: 'Exampleland', purpose: 'to discuss a possible supply agreement', paymentDay: '1', mutual: 'yes',
  };
  const out: Record<string, string> = {};
  for (const q of info.questions) {
    out[q.id] = special[q.id] ?? (q.kind === 'number' ? '30' : q.kind === 'date' ? '2026-11-01' : q.kind === 'yesno' ? 'yes' : q.options ? q.options[0].value : `Test ${q.id}`);
  }
  return out;
}

async function setup() {
  const ctx = await makeApp();
  await ctx.app.inject({ method: 'PUT', url: '/api/tenant/profile', headers: asOwner, payload: PROFILE });
  return ctx;
}

const create = async (app: App, type: ContractType, headers = asOwner) => app.inject({ method: 'POST', url: '/api/drafts', headers, payload: { type } });
const preview = async (app: App, id: string) => (await app.inject({ url: `/api/drafts/${id}/preview`, headers: asOwner })).json() as DraftPreview;

describe('contract wizard', () => {
  it('lists the six contract types with plain-English questions', async () => {
    const { app } = await setup();
    const types = (await app.inject({ url: '/api/wizard/types', headers: asOwner })).json() as ContractTypeInfo[];
    expect(types.map((t) => t.id)).toEqual([...CONTRACT_TYPES]);
    for (const t of types) expect(t.questions.length).toBeGreaterThan(5);
  });

  for (const type of CONTRACT_TYPES) {
    it(`builds a complete ${type} with explanations, exports it, and never calls it vetted`, async () => {
      const { app } = await setup();
      const created = (await create(app, type)).json();
      // Pre-filled from the company profile.
      expect(created.answers.ourName).toBe(PROFILE.legalName);
      const answers = { ...answersFor(created.type), ...created.answers }; // keep what was pre-filled
      const saved = await app.inject({ method: 'PUT', url: `/api/drafts/${created.draft.id}`, headers: asOwner, payload: { answers } });
      expect(saved.statusCode).toBe(200);

      const p = await preview(app, created.draft.id);
      expect(p.missing).toEqual([]);
      expect(p.sections.length).toBeGreaterThanOrEqual(6);
      for (const s of p.sections) {
        expect(s.text).not.toContain('[NOT PROVIDED');
        expect(s.explanation.length).toBeGreaterThan(10);
        expect(s.source.kind).toBe('template');
      }
      expect(p.sections.map((s) => s.text).join(' ')).toContain(PROFILE.legalName);
      expect(JSON.stringify(p)).not.toMatch(/vetted/i);

      const docx = await app.inject({ url: `/api/drafts/${created.draft.id}/export?format=docx`, headers: asOwner });
      expect(docx.headers['content-disposition']).toMatch(/filename="[\w.]+(-[\w.]+)*\.docx"/);
      const zip = await JSZip.loadAsync(docx.rawPayload);
      const body = await zip.file('word/document.xml')!.async('string');
      expect(await zip.file('word/footer1.xml')!.async('string')).toContain(POLICY_DISCLAIMER);
      expect(body).toContain('Drafting notes (remove before sending)');
      expect(body).not.toMatch(/vetted/i);

      const pdfRes = await app.inject({ url: `/api/drafts/${created.draft.id}/export?format=pdf`, headers: asOwner });
      const pdf = await getDocument({ data: new Uint8Array(pdfRes.rawPayload), isEvalSupported: false }).promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        const text = (await (await pdf.getPage(i)).getTextContent()).items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ');
        expect(text).toContain(POLICY_DISCLAIMER);
        expect(text).not.toMatch(/vetted/i);
      }
      await pdf.destroy();
    });
  }

  it('flags missing essentials and marks them in the wording instead of guessing', async () => {
    const { app } = await setup();
    const id = (await create(app, 'service_agreement')).json().draft.id;
    const p = await preview(app, id);
    const missing = p.missing.map((m) => m.questionId);
    expect(missing).toEqual(expect.arrayContaining(['ourRole', 'otherName', 'services', 'startDate', 'termMonths', 'fee', 'paymentDays', 'liabilityCap', 'terminationNoticeDays', 'cureDays']));
    expect(missing).not.toContain('ourName'); // pre-filled
    const fees = p.sections.find((s) => s.heading === 'Fees')!;
    expect(fees.text).toContain('[NOT PROVIDED: The fee');
    // The same risk analysis as a review runs on the draft.
    expect(p.findings.rulesChecked.length).toBeGreaterThan(3);
  });

  it('runs the review risk checks on the draft', async () => {
    const { app } = await setup();
    const created = (await create(app, 'service_agreement')).json();
    const answers = { ...answersFor(created.type), escalation: 'index', escalationIndex: 'CPI' };
    await app.inject({ method: 'PUT', url: `/api/drafts/${created.draft.id}`, headers: asOwner, payload: { answers } });
    const p = await preview(app, created.draft.id);
    const f = p.findings.findings.find((x) => x.rule === 'escalation_unworkable');
    expect(f).toMatchObject({ severity: 'amber' });
    const fees = p.sections.find((s) => s.heading === 'Fees')!;
    expect(f!.passages[0]).toMatchObject({ blockId: fees.id, clauseNumber: fees.number });
    expect(f!.plain).toContain(`Clause ${fees.number} `);
    expect(p.sections.find((s) => s.heading === 'Fees')!.loophole).toMatch(/maximum/);
  });

  it('assembles clauses from the active playbook first, then the clause library', async () => {
    const { app } = await setup();
    await app.inject({ method: 'POST', url: '/api/library/clauses', headers: asOwner, payload: { topic: 'confidentiality', title: 'Our NDA wording', text: 'Each party keeps the other party\'s information secret for five years.' } });
    const pb = ((await app.inject({ url: '/api/playbooks', headers: asOwner })).json() as PlaybookSeries[])[0];
    await app.inject({ method: 'POST', url: `/api/playbooks/${pb.versions[0].id}/activate`, headers: asOwner, payload: {} });
    const created = (await create(app, 'service_agreement')).json();
    await app.inject({ method: 'PUT', url: `/api/drafts/${created.draft.id}`, headers: asOwner, payload: { answers: answersFor(created.type) } });
    const p = await preview(app, created.draft.id);
    const payment = p.sections.find((s) => s.topic === 'payment')!;
    expect(payment.source.kind).toBe('playbook');
    expect(payment.text).toBe(EXAMPLE_POSITIONS.find((x) => x.topic === 'payment')!.preferredText);
    expect(payment.source.label).toMatch(/EXAMPLE playbook/);
    const conf = p.sections.find((s) => s.topic === 'confidentiality')!;
    expect(conf).toMatchObject({ source: { kind: 'library' }, text: "Each party keeps the other party's information secret for five years." });
    // Example library clauses are never used as if they were the company's own wording.
    expect(p.sections.filter((s) => s.source.kind === 'library').every((s) => !s.source.label.includes('EXAMPLE'))).toBe(true);
  });

  it('keeps drafts inside the company and needs edit rights to create them', async () => {
    const { app, db } = await setup();
    const id = (await create(app, 'nda')).json().draft.id;
    expect((await app.inject({ url: `/api/drafts/${id}`, headers: asOther })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/drafts/${id}/export?format=pdf`, headers: asOther })).statusCode).toBe(404);
    db.prepare(`INSERT INTO users (id, email, name, created_at) VALUES ('user_ro', 'ro@demo.example', 'Read Only', ?)`).run(now());
    db.prepare(`INSERT INTO tenant_memberships (tenant_id, user_id, role, created_at) VALUES (?, 'user_ro', 'read_only', ?)`).run(SEED.tenantId, now());
    expect((await create(app, 'nda', { 'x-user-id': 'user_ro' })).statusCode).toBe(403);
    expect((await create(app, 'nonsense' as ContractType)).statusCode).toBe(400);
  });
});
