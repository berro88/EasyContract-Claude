import { describe, expect, it } from 'vitest';
import type { CompareResponse, EffectivePositionResponse, LetterMatchResponse, ProposedSignedResponse } from '@easycontract/shared';
import { asOther, asOwner, createProject, makeApp, makeDocx, makeImageOnlyPdf, makePdf, multipart, upload, type DocxParagraph } from './helpers.ts';

type App = Awaited<ReturnType<typeof makeApp>>['app'];

async function add(app: App, projectId: string, name: string, bytes: Buffer, role: string, fields: Record<string, string> = {}) {
  const body = multipart({ role, ...fields }, { name, bytes });
  const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/documents`, headers: { ...asOwner, ...body.headers }, payload: body.payload });
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json().document.id as string;
}

const setStatus = (app: App, docId: string, negotiationStatus: string, headers = asOwner) =>
  app.inject({ method: 'PUT', url: `/api/documents/${docId}/status`, headers, payload: { negotiationStatus } });

const get = async <T>(app: App, url: string, headers = asOwner) => {
  const res = await app.inject({ url, headers });
  return { status: res.statusCode, body: res.json() as T };
};

/** A numbered agreement from [heading, clauses[]] sections. */
function agreement(sections: [string, string[]][]) {
  const paras: DocxParagraph[] = [];
  for (const [h, clauses] of sections) {
    paras.push({ text: h, num: { numId: 1, ilvl: 0 } });
    for (const c of clauses) paras.push({ text: c, num: { numId: 1, ilvl: 1 } });
  }
  return makeDocx(paras, { numbering: true });
}

const BASE: [string, string[]][] = [
  ['Parties', ['This agreement is made between Example Supplier (Pty) Ltd ("Supplier") and Sample Client Ltd ("Client").']],
  ['Fees', ['The Client shall pay a monthly fee of R12,000.', 'Invoices are payable within 30 days.']],
  ['Term', ['This agreement runs for 12 months from the Effective Date.']],
  ['Termination', ['Either party may terminate on 60 days written notice.']],
];

describe('version vs version', () => {
  it('matches renumbered clauses by content and redlines the changed words', async () => {
    const { app } = await makeApp();
    const p = await createProject(app);
    const docId = await add(app, p.id, 'msa-v1.docx', await agreement(BASE), 'main_agreement');
    // v2 adds a Definitions section first, so every later clause is renumbered; one fee changes.
    const v2: [string, string[]][] = [
      BASE[0],
      ['Definitions', ['In this agreement, "Services" means the cleaning services described in Schedule 1.']],
      ['Fees', ['The Client shall pay a monthly fee of R13,500.', 'Invoices are payable within 30 days.']],
      BASE[2],
      BASE[3],
    ];
    await add(app, p.id, 'msa-v2.docx', await agreement(v2), 'main_agreement', { documentId: docId });
    const { body: doc } = await get<{ versions: { id: string; versionNumber: number }[] }>(app, `/api/documents/${docId}`);
    const v1 = doc.versions.find((v) => v.versionNumber === 1)!.id;
    const v2id = doc.versions.find((v) => v.versionNumber === 2)!.id;

    const { body } = await get<CompareResponse>(app, `/api/compare?left=${docId}&leftVersion=${v1}&right=${docId}&rightVersion=${v2id}`);
    const byRight = (n: string) => body.rows.find((r) => r.right?.clauseNumber === n)!;

    expect(byRight('3.1')).toMatchObject({ status: 'changed', renumbered: true, left: { clauseNumber: '2.1' } });
    expect(byRight('3.1').diff).toEqual(expect.arrayContaining([{ op: 'remove', text: 'R12,000.' }, { op: 'add', text: 'R13,500.' }]));
    expect(byRight('3.2')).toMatchObject({ status: 'renumbered', left: { clauseNumber: '2.2' } });
    expect(byRight('4.1')).toMatchObject({ status: 'renumbered', left: { clauseNumber: '3.1' } });
    expect(byRight('5.1')).toMatchObject({ status: 'renumbered', left: { clauseNumber: '4.1' } });
    expect(byRight('2.1')).toMatchObject({ status: 'added', left: null });
    expect(byRight('1.1').status).toBe('unchanged');
    expect(body.summary.removed).toBe(0);
  });

  it('flags a named party changed to a term the new wording never defines', async () => {
    const { app } = await makeApp();
    const p = await createProject(app);
    const a = await add(app, p.id, 'a.docx', await makeDocx([
      '1. Parties. This agreement is made between Example Supplier (Pty) Ltd and Sample Client Ltd.',
      '2. Fees. The monthly fee is payable by Sample Client Ltd within 30 days.',
    ]), 'main_agreement');
    const b = await add(app, p.id, 'b.docx', await makeDocx([
      '1. Parties. This agreement is made between Example Supplier (Pty) Ltd and Sample Client Ltd.',
      '2. Fees. The monthly fee is payable by the Client within 30 days.',
    ]), 'main_agreement');
    const { body } = await get<CompareResponse>(app, `/api/compare?left=${a}&right=${b}`);
    expect(body.partyChanges).toHaveLength(1);
    expect(body.partyChanges[0]).toMatchObject({ from: 'Sample Client Ltd', to: 'Client' });
    expect(body.partyChanges[0].message).toMatch(/never defines "Client"/);

    // Defining the term ("Client") in the new version removes the concern.
    const c = await add(app, p.id, 'c.docx', await makeDocx([
      '1. Parties. This agreement is made between Example Supplier (Pty) Ltd and Sample Client Ltd ("Client").',
      '2. Fees. The monthly fee is payable by the Client within 30 days.',
    ]), 'main_agreement');
    expect((await get<CompareResponse>(app, `/api/compare?left=${a}&right=${c}`)).body.partyChanges).toEqual([]);
  });
});

describe('base agreement plus amendments', () => {
  const AMENDMENT = [
    'First Amendment to the Services Agreement',
    'Clause 2.1 is amended by replacing "R12,000" with "R13,500".',
    'Clause 3.1 is deleted and replaced with the following:',
    '"This agreement runs for 24 months from the Effective Date."',
    'A new clause 4.2 is inserted: "The Client may terminate immediately if the Supplier becomes insolvent."',
  ];

  async function setup() {
    const { app, db } = await makeApp();
    const p = await createProject(app);
    const base = await add(app, p.id, 'msa.docx', await agreement(BASE), 'main_agreement');
    await setStatus(app, base, 'signed');
    const amendment = await add(app, p.id, 'amendment-1.docx', await makeDocx(AMENDMENT), 'amendment');
    return { app, db, p, base, amendment };
  }

  it('applies agreed amendments to show the effective position, quoting the amendment', async () => {
    const { app, p, base, amendment } = await setup();
    await setStatus(app, amendment, 'signed');
    const { body } = await get<EffectivePositionResponse>(app, `/api/projects/${p.id}/effective?base=${base}`);
    const clause = (n: string) => body.clauses.find((c) => c.clauseNumber === n)!;
    expect(clause('2.1').text).toBe('The Client shall pay a monthly fee of R13,500.');
    expect(clause('3.1').text).toBe('This agreement runs for 24 months from the Effective Date.');
    expect(clause('4.2').text).toBe('The Client may terminate immediately if the Supplier becomes insolvent.');
    expect(clause('4.2').baseBlockId).toBeNull();
    expect(body.clauses.map((c) => c.clauseNumber).indexOf('4.2')).toBe(body.clauses.map((c) => c.clauseNumber).indexOf('4.1') + 1);
    for (const n of ['2.1', '3.1', '4.2']) expect(clause(n).changedBy[0]).toMatchObject({ documentId: amendment });
    expect(body.amendments[0]).toMatchObject({ incorporation: 'not_incorporated', instructionCount: 3, incorporatedCount: 0, negotiationStatus: 'signed' });
    expect(body.baseWarning).toBeNull();
  });

  it('tracks a partly incorporated amendment and only applies what is missing', async () => {
    const { app, p, base, amendment } = await setup();
    await setStatus(app, amendment, 'signed');
    // A consolidated v2 of the base that already includes the fee and term changes, but not the new clause.
    const consolidated: [string, string[]][] = [
      BASE[0],
      ['Fees', ['The Client shall pay a monthly fee of R13,500.', 'Invoices are payable within 30 days.']],
      ['Term', ['This agreement runs for 24 months from the Effective Date.']],
      BASE[3],
    ];
    await add(app, p.id, 'msa-consolidated.docx', await agreement(consolidated), 'main_agreement', { documentId: base });

    const { body } = await get<EffectivePositionResponse>(app, `/api/projects/${p.id}/effective?base=${base}`);
    const a = body.amendments[0];
    expect(a).toMatchObject({ incorporation: 'partly_incorporated', incorporatedCount: 2, instructionCount: 3 });
    expect(a.instructions.map((i) => [i.kind, i.clauseNumber, i.state])).toEqual([
      ['replace_words', '2.1', 'incorporated'],
      ['replace_clause', '3.1', 'incorporated'],
      ['insert_clause', '4.2', 'applied'],
    ]);
    // Incorporated changes aren't applied twice; the missing one is applied.
    const clause = (n: string) => body.clauses.find((c) => c.clauseNumber === n)!;
    expect(clause('2.1')).toMatchObject({ text: 'The Client shall pay a monthly fee of R13,500.', changedBy: [] });
    expect(clause('4.2').changedBy).toHaveLength(1);
  });

  it('keeps amendments that are not agreed out of the effective position', async () => {
    const { app, p, base } = await setup(); // amendment status left as "unknown"
    const { body } = await get<EffectivePositionResponse>(app, `/api/projects/${p.id}/effective?base=${base}`);
    expect(body.clauses.find((c) => c.clauseNumber === '2.1')!.text).toBe('The Client shall pay a monthly fee of R12,000.');
    expect(body.clauses.some((c) => c.clauseNumber === '4.2')).toBe(false);
    expect(body.amendments[0].instructions.every((i) => i.state === 'pending')).toBe(true);
    expect(body.amendments[0].instructions[0].explanation).toMatch(/isn't part of the agreed position/);
  });

  it('explains instructions it cannot apply', async () => {
    const { app } = await makeApp();
    const p = await createProject(app);
    const base = await add(app, p.id, 'msa.docx', await agreement(BASE), 'main_agreement');
    const amendment = await add(app, p.id, 'a.docx', await makeDocx([
      'Clause 9.4 is deleted.',
      'Clause 2.1 is amended by replacing "R99,999" with "R1".',
      'Clause 2 is amended in the manner discussed at the meeting.',
    ]), 'amendment');
    await setStatus(app, amendment, 'agreed');
    const { body } = await get<EffectivePositionResponse>(app, `/api/projects/${p.id}/effective?base=${base}`);
    expect(body.amendments[0].instructions.map((i) => [i.kind, i.state])).toEqual([
      ['delete_clause', 'cannot_apply'], ['replace_words', 'cannot_apply'], ['unrecognised', 'cannot_apply'],
    ]);
    expect(body.amendments[0].instructions[1].explanation).toMatch(/"R99,999" aren't in clause 2.1/);
    expect(body.baseWarning).toMatch(/Nobody has confirmed/);
  });

  it('says when an amendment could not be read instead of skipping it quietly', async () => {
    const { app, p, base } = await setup();
    await add(app, p.id, 'scanned-amendment.pdf', await makeImageOnlyPdf(1), 'amendment');
    const { body } = await get<EffectivePositionResponse>(app, `/api/projects/${p.id}/effective?base=${base}`);
    expect(body.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/couldn't read "scanned-amendment".*left out of the effective position/)]));
    expect(body.amendments).toHaveLength(1);
  });

  it('negotiation status is separate from incorporation and needs edit rights', async () => {
    const { app, db, p, base, amendment } = await setup();
    let { body } = await get<EffectivePositionResponse>(app, `/api/projects/${p.id}/effective?base=${base}`);
    expect(body.amendments[0]).toMatchObject({ negotiationStatus: 'unknown', incorporation: 'not_incorporated' });
    await setStatus(app, amendment, 'agreed');
    ({ body } = await get<EffectivePositionResponse>(app, `/api/projects/${p.id}/effective?base=${base}`));
    expect(body.amendments[0]).toMatchObject({ negotiationStatus: 'agreed', incorporation: 'not_incorporated' });
    expect((await setStatus(app, amendment, 'final')).statusCode).toBe(400);
    expect((await setStatus(app, amendment, 'signed', asOther)).statusCode).toBe(404);
    const audits = db.prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE action = 'document.status_update'`).get();
    expect(audits).toEqual({ n: 2 }); // base signed in setup, amendment agreed here; rejected attempts aren't status changes
  });
});

describe('proposed vs signed', () => {
  it('a file called FINAL is not treated as agreed; wording is kept in separate fields', async () => {
    const { app } = await makeApp();
    const p = await createProject(app);
    const proposal = await add(app, p.id, 'Services Agreement FINAL v3.docx', await makeDocx([
      '1. Fees. The Client shall pay a monthly fee of R15,000.',
      '2. Term. This agreement runs for 36 months.',
      '3. Exclusivity. The Client will use no other supplier.',
    ]), 'other');
    const signed = await add(app, p.id, 'scan-of-signed.docx', await makeDocx([
      '1. Fees. The Client shall pay a monthly fee of R12,000.',
      '2. Term. This agreement runs for 36 months.',
      '3. Liability. Liability is capped at the fees paid in 12 months.',
    ]), 'other');

    // Neither has a status a person set, so we refuse to guess, whatever the file name says.
    const refused = await get<{ error: string }>(app, `/api/proposed-vs-signed?a=${proposal}&b=${signed}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/"final" don't count/);

    await setStatus(app, signed, 'signed');
    const { body } = await get<ProposedSignedResponse>(app, `/api/proposed-vs-signed?a=${proposal}&b=${signed}`);
    expect(body.agreed.documentId).toBe(signed);
    expect(body.proposed.documentId).toBe(proposal);
    const row = (prefix: string) => body.rows.find((r) => (r.proposed ?? r.agreed)!.text.startsWith(prefix))!;
    expect(row('1. Fees')).toMatchObject({ status: 'changed_before_signing' });
    expect(row('1. Fees').agreed!.text).toContain('R12,000');
    expect(row('1. Fees').proposed!.text).toContain('R15,000');
    expect(row('2. Term').status).toBe('same');
    expect(row('3. Exclusivity')).toMatchObject({ status: 'proposed_only', agreed: null });
    expect(row('3. Liability')).toMatchObject({ status: 'signed_only', proposed: null });
    // No proposed-only wording ever appears on the agreed side.
    expect(JSON.stringify(body.rows.map((r) => r.agreed))).not.toContain('R15,000');
    expect(JSON.stringify(body.rows.map((r) => r.agreed))).not.toContain('Exclusivity');
  });

  it('a proposal never enters the effective position', async () => {
    const { app } = await makeApp();
    const p = await createProject(app);
    const base = await add(app, p.id, 'msa.docx', await agreement(BASE), 'signed_copy');
    await add(app, p.id, 'proposal FINAL.docx', await makeDocx(['Clause 2.1 is amended by replacing "R12,000" with "R20,000".']), 'proposal');
    const { body } = await get<EffectivePositionResponse>(app, `/api/projects/${p.id}/effective?base=${base}`);
    expect(body.amendments).toEqual([]);
    expect(JSON.stringify(body.clauses)).not.toContain('R20,000');
  });
});

describe('letter matching', () => {
  async function setup() {
    const { app } = await makeApp();
    const p = await createProject(app);
    const alpha = await add(app, p.id, 'alpha.docx', await agreement([
      ['Parties', ['This agreement (reference MSA-2025-014) dated 1 March 2025 is made between Example Supplier (Pty) Ltd ("Supplier") and Alpha Foods Ltd ("Client").']],
      ['Fees', ['The Client shall pay a monthly fee of R12,000.', 'The fee escalates annually by 6%.']],
      ['Confidentiality', ['Each party must keep confidential information secret.']],
    ]), 'main_agreement');
    const beta = await add(app, p.id, 'beta.docx', await agreement([
      ['Parties', ['This agreement dated 5 May 2024 is made between Example Supplier (Pty) Ltd ("Supplier") and Beta Logistics Ltd ("Client").']],
      ['Charges', ['The Client shall pay a monthly fee of R30,000.']],
      ['Termination', ['Either party may terminate on 90 days written notice.']],
    ]), 'main_agreement');
    return { app, p, alpha, beta };
  }

  it('matches an increase letter with no clause numbers to the right agreement and clause', async () => {
    const { app, p, alpha } = await setup();
    const letter = await add(app, p.id, 'increase.pdf', await makePdf([[
      'Dear Alpha Foods Ltd,', '',
      'Re: our services agreement dated 1 March 2025 (ref MSA-2025-014).', '',
      'Your monthly fee will increase from next month in line with the annual escalation.', '',
      'Yours faithfully, Example Supplier (Pty) Ltd',
    ]]), 'increase_letter');
    const { body } = await get<LetterMatchResponse>(app, `/api/documents/${letter}/letter-match`);
    expect(body.status).toBe('matched');
    expect(body.agreement?.documentId).toBe(alpha);
    expect(body.clause?.clauseNumber).toMatch(/^2\./);
    expect(body.reasons.join(' ')).toMatch(/Alpha Foods Ltd/);
    expect(body.reasons.join(' ')).toMatch(/MSA-2025-014/);
    expect(body.reasons.join(' ')).toMatch(/1 March 2025/);
  });

  it('explains in plain English why a letter could not be matched', async () => {
    const { app, p } = await setup();
    const letter = await add(app, p.id, 'other.pdf', await makePdf([[
      'Dear Gamma Retail Ltd,', '', 'Re: contract ref GR-77-2023.', '', 'Your monthly fee will increase from next month.',
    ]]), 'increase_letter');
    const { body } = await get<LetterMatchResponse>(app, `/api/documents/${letter}/letter-match`);
    expect(body.status).toBe('not_matched');
    expect(body.agreement).toBeNull();
    expect(body.problems).toEqual(expect.arrayContaining([
      expect.stringMatching(/names Gamma Retail Ltd, which isn't a party in any agreement/),
      expect.stringMatching(/reference GR-77-2023, which doesn't appear/),
    ]));
  });

  it('says when the date in the letter does not fit the agreement', async () => {
    const { app, p, beta } = await setup();
    const letter = await add(app, p.id, 'beta-letter.pdf', await makePdf([[
      'Dear Beta Logistics Ltd,', '', 'Under the agreement dated 9 September 2021, your monthly fee will increase.',
    ]]), 'increase_letter');
    const { body } = await get<LetterMatchResponse>(app, `/api/documents/${letter}/letter-match`);
    expect(body.agreement?.documentId).toBe(beta);
    expect(body.status).toBe('uncertain');
    expect(body.problems.join(' ')).toMatch(/dated 9 September 2021, but "beta" doesn't mention that date/);
  });
});

describe('isolation', () => {
  it('comparison routes return 404 for another tenant', async () => {
    const { app } = await makeApp();
    const p = await createProject(app);
    const a = await add(app, p.id, 'a.docx', await makeDocx(['1. Fees. R1.']), 'main_agreement');
    const b = await add(app, p.id, 'b.docx', await makeDocx(['1. Fees. R2.']), 'main_agreement');
    for (const url of [`/api/compare?left=${a}&right=${b}`, `/api/proposed-vs-signed?a=${a}&b=${b}`, `/api/projects/${p.id}/effective?base=${a}`, `/api/documents/${a}/letter-match`]) {
      expect((await app.inject({ url, headers: asOther })).statusCode, url).toBe(404);
    }
    expect((await upload(app, p.id, { name: 'x.docx', bytes: await makeDocx(['1. Fees. R3.']) }, 'other', asOther)).statusCode).toBe(404);
  });
});
