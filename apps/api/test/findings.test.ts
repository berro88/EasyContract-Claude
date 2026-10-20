import { describe, expect, it } from 'vitest';
import type { ExtractionBlock, Finding, FindingsResponse } from '@easycontract/shared';
import { asOther, asOwner, createProject, makeApp, makeDocx, upload } from './helpers.ts';
import { SECTIONS } from './synthetic-agreement.ts';

type App = Awaited<ReturnType<typeof makeApp>>['app'];

async function findingsFor(paragraphs: string[], opts: { role?: string; others?: { name: string; paragraphs: string[]; role: string }[] } = {}) {
  const { app } = await makeApp();
  const p = await createProject(app);
  for (const o of opts.others ?? []) await upload(app, p.id, { name: o.name, bytes: await makeDocx(o.paragraphs) }, o.role);
  const res = await upload(app, p.id, { name: 'contract.docx', bytes: await makeDocx(paragraphs) }, opts.role ?? 'main_agreement');
  const docId = res.json().document.id as string;
  const body = (await app.inject({ url: `/api/documents/${docId}/findings`, headers: asOwner })).json() as FindingsResponse;
  const { blocks } = (await app.inject({ url: `/api/documents/${docId}/blocks`, headers: asOwner })).json() as { blocks: ExtractionBlock[] };
  checkInvariants(body.findings, blocks);
  return { app, docId, body, blocks, of: (rule: Finding['rule']) => body.findings.filter((f) => f.rule === rule) };
}

/** Holds for every finding: real passages, and no number that isn't in the document. */
function checkInvariants(findings: Finding[], blocks: ExtractionBlock[]) {
  const ids = new Set(blocks.map((b) => b.id));
  const source = blocks.map((b) => `${b.text} ${b.clauseNumber ?? ''}`).join('\n');
  for (const f of findings) {
    for (const p of f.passages) expect(ids.has(p.blockId), `${f.title}: passage exists`).toBe(true);
    if (f.severity !== 'green' && f.rule !== 'missing_essentials') expect(f.passages.some((p) => p.role === 'primary'), f.title).toBe(true);
    const prose = [f.title, f.plain, f.legal, f.cannotWorkOut ?? ''].join(' ');
    for (const n of prose.match(/\d+(?:[.,]\d+)*/g) ?? []) expect(source, `"${n}" in "${f.title}"`).toContain(n);
  }
}

const CAP = '5.1 Each party\'s aggregate liability shall not exceed the fees paid in the 12 months before the claim.';

describe('liability cap and indemnities', () => {
  it('red: an indemnity that applies notwithstanding the cap', async () => {
    const { of } = await findingsFor([CAP, '6.1 Notwithstanding clause 5.1, the Supplier indemnifies the Client against all third-party claims.']);
    const [f] = of('liability_cap_bypass');
    expect(f.severity).toBe('red');
    expect(f.passages.map((p) => [p.clauseNumber, p.role])).toEqual([['6.1', 'primary'], ['5.1', 'related']]);
    expect(f.cannotWorkOut).toMatch(/cannot be worked out/);
    expect(f.legal).toMatch(/notwithstanding clause 5.1, so the cap does not bound/);
  });

  it('red: an indemnity stated to be unlimited', async () => {
    const { of } = await findingsFor([CAP, '6.1 The Supplier indemnifies the Client without limit against third-party claims.']);
    const [f] = of('liability_cap_bypass');
    expect(f.severity).toBe('red');
    expect(f.legal).toMatch(/unlimited, so the cap in clause 5.1 does not bound liability under it/);
  });

  it('red: a cap that carves out indemnities', async () => {
    const { of } = await findingsFor([
      '5.1 Each party\'s aggregate liability shall not exceed the fees paid in the 12 months, except for liability under any indemnity.',
      '6.1 The Supplier indemnifies the Client against third-party claims.',
    ]);
    expect(of('liability_cap_bypass')).toMatchObject([{ severity: 'red', title: 'The liability cap does not cover indemnities' }]);
  });

  it('amber: unclear whether the cap covers the indemnity, and the cap amount cannot be worked out', async () => {
    const { of } = await findingsFor([CAP, '6.1 The Supplier indemnifies the Client against third-party claims.']);
    const [f] = of('liability_cap_bypass');
    expect(f.severity).toBe('amber');
    expect(f.cannotWorkOut).toMatch(/cap amount can't be worked out/);
  });

  it('green: the indemnity is subject to the cap', async () => {
    const { of } = await findingsFor([CAP, '6.1 Subject to clause 5.1, the Supplier indemnifies the Client against third-party claims.']);
    expect(of('liability_cap_bypass')).toMatchObject([{ severity: 'green' }]);
  });

  it('amber: an indemnity with no cap anywhere', async () => {
    const { of } = await findingsFor(['6.1 The Supplier indemnifies the Client against third-party claims.']);
    expect(of('liability_cap_bypass')).toMatchObject([{ severity: 'amber', title: 'Indemnity with no liability cap' }]);
  });
});

describe('escalation', () => {
  it('red: an escalation formula with an unfilled placeholder says the price cannot be worked out', async () => {
    const { of } = await findingsFor(['3.1 The monthly fee is R12,000.', '3.2 The fee escalates on each anniversary by [ESCALATION %].']);
    const [f] = of('escalation_unworkable');
    expect(f).toMatchObject({ severity: 'red', passages: [{ clauseNumber: '3.2', role: 'primary' }] });
    expect(f.plain).toContain('"[ESCALATION %]"');
    expect(f.cannotWorkOut).toMatch(/cannot be worked out because the value is left blank in clause 3.2/);
  });

  it('amber: escalation tied to an index with no rate in the document', async () => {
    const { of } = await findingsFor(['3.2 The fee increases annually in line with CPI.']);
    expect(of('escalation_unworkable')).toMatchObject([{ severity: 'amber' }]);
    expect(of('escalation_unworkable')[0].cannotWorkOut).toMatch(/"CPI" figures that aren't in the document/);
  });

  it('no finding when the increase is fully stated', async () => {
    const { of } = await findingsFor(['3.2 The fee increases by 6% on each anniversary.']);
    expect(of('escalation_unworkable')).toEqual([]);
  });
});

describe('overlapping fuel and annual escalation', () => {
  it('amber: a fuel surcharge and an annual increase that does not exclude fuel', async () => {
    const { of } = await findingsFor([
      '4.1 The rates increase annually by 6% on each anniversary.',
      '4.2 A fuel surcharge applies monthly when the diesel price rises.',
    ]);
    const [f] = of('overlapping_escalation');
    expect(f.severity).toBe('amber');
    expect(f.passages.map((p) => p.clauseNumber).sort()).toEqual(['4.1', '4.2']);
  });

  it('green: the annual increase excludes fuel', async () => {
    const { of } = await findingsFor([
      '4.1 The rates, excluding fuel, increase annually by 6% on each anniversary.',
      '4.2 A fuel surcharge applies monthly when the diesel price rises.',
    ]);
    expect(of('overlapping_escalation')).toMatchObject([{ severity: 'green' }]);
  });

  it('no finding with only one mechanism', async () => {
    const { of } = await findingsFor(['4.1 The rates increase annually by 6% on each anniversary.']);
    expect(of('overlapping_escalation')).toEqual([]);
  });
});

describe('termination and cure periods', () => {
  const CURE = '9.1 If a party breaches this agreement, it has 14 days after written notice to remedy the breach.';

  it('red: immediate termination for breach conflicts with a cure period', async () => {
    const { of } = await findingsFor([CURE, '10.1 The Client may terminate this agreement immediately if the Supplier commits any breach.']);
    const [f] = of('termination_cure_conflict');
    expect(f.severity).toBe('red');
    expect(f.plain).toContain('14 days');
    expect(f.passages.map((p) => p.clauseNumber)).toEqual(['10.1', '9.1']);
  });

  it('red: termination notice shorter than the cure period', async () => {
    const { of } = await findingsFor([
      '9.1 A party in breach has 30 days after written notice to remedy the breach.',
      '10.1 Either party may terminate for breach on 7 days written notice.',
    ]);
    expect(of('termination_cure_conflict')).toMatchObject([{ severity: 'red', title: 'Termination notice is shorter than the time to fix a breach' }]);
  });

  it('amber: different cure periods in different clauses', async () => {
    const { of } = await findingsFor([CURE, '12.1 Any payment default must be remedied within 30 days of a reminder.']);
    expect(of('termination_cure_conflict')).toMatchObject([{ severity: 'amber', title: 'Different times to fix a breach' }]);
  });

  it('no finding when termination waits for the cure period', async () => {
    const { of } = await findingsFor([CURE, '10.1 A party may terminate if the other party breaches this agreement and fails to remedy it within 14 days.']);
    expect(of('termination_cure_conflict')).toEqual([]);
  });
});

describe('documents referred to but not provided', () => {
  it('amber: a schedule that is not in the document or the project', async () => {
    const { of } = await findingsFor(['3.1 The fees are set out in Schedule 2.', '7.1 The services are described in Schedule 1.', 'Schedule 1 - Services', 'Cleaning of the premises.']);
    const found = of('missing_reference');
    expect(found.map((f) => f.title)).toEqual(['"Schedule 2" is referred to but not provided']);
    expect(found[0].passages[0].clauseNumber).toBe('3.1');
  });

  it('amber: a principal agreement that was not provided; none once it is in the project', async () => {
    const paragraphs = ['2.1 The Subcontractor must comply with the Principal Agreement as it applies to the Services.'];
    expect((await findingsFor(paragraphs)).of('missing_reference')).toMatchObject([{ severity: 'amber', title: '"Principal Agreement" is referred to but not provided' }]);
    const withPrincipal = await findingsFor(paragraphs, { others: [{ name: 'principal-agreement.docx', paragraphs: ['1. Parties. This principal agreement is made between Acme Ltd and Beta Ltd.', '2. Services. Beta Ltd provides the services described below.'], role: 'other' }] });
    expect(withPrincipal.of('missing_reference')).toEqual([]);
  });
});

describe('missing essentials', () => {
  it('flags what a contract lacks, red for parties and price', async () => {
    const { of } = await findingsFor(['1.1 The Supplier will clean the premises every week.']);
    const titles = of('missing_essentials').map((f) => [f.severity, f.title]);
    expect(titles).toEqual(expect.arrayContaining([
      ['red', 'Not stated: who the parties are'],
      ['red', 'Not stated: the price'],
      ['amber', 'Not stated: which law governs it'],
    ]));
  });

  it('green when every essential is present, linking to each', async () => {
    const paragraphs = SECTIONS.flatMap((s, i) => s.clauses.map((c, j) => `${i + 1}.${j + 1} ${c}`));
    const { of } = await findingsFor(paragraphs);
    const [f] = of('missing_essentials');
    expect(f).toMatchObject({ severity: 'green', title: 'Essential terms found' });
    expect(f.passages.length).toBeGreaterThanOrEqual(6);
  });

  it('is not run on amendments or letters', async () => {
    const { of, body } = await findingsFor(['Clause 3.1 is amended by replacing "R1" with "R2".'], { role: 'amendment' });
    expect(of('missing_essentials')).toEqual([]);
    expect(body.rulesChecked.map((r) => r.rule)).not.toContain('missing_essentials');
  });
});

describe('findings endpoint', () => {
  it('sorts by severity, keeps ids stable across runs, and is tenant-isolated', async () => {
    const { app, docId, body } = await findingsFor([
      '1.1 This agreement is made between Acme Ltd and Beta Ltd.',
      CAP,
      '6.1 Notwithstanding clause 5.1, the Supplier indemnifies the Client against all third-party claims.',
      '3.2 The fee escalates on each anniversary by [ESCALATION %].',
    ]);
    const order = { red: 0, amber: 1, green: 2 };
    const sev = body.findings.map((f) => order[f.severity]);
    expect(sev).toEqual([...sev].sort((a, b) => a - b));
    expect(body.summary.red).toBeGreaterThanOrEqual(2);
    const again = (await app.inject({ url: `/api/documents/${docId}/findings`, headers: asOwner })).json() as FindingsResponse;
    expect(again.findings.map((f) => f.id)).toEqual(body.findings.map((f) => f.id));
    expect((await app.inject({ url: `/api/documents/${docId}/findings`, headers: asOther })).statusCode).toBe(404);
  });
});

