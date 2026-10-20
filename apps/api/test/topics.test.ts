import { describe, expect, it } from 'vitest';
import { TOPICS, type ClauseExplanation, type TopicsResponse } from '@easycontract/shared';
import { classifyBlocks } from '../src/analysis/topics.ts';
import { explainClause } from '../src/analysis/explanations.ts';
import { asOwner, createProject, makeApp, makeDocx, makePdf, upload, type DocxParagraph } from './helpers.ts';
import { SECTIONS } from './synthetic-agreement.ts';

type App = Awaited<ReturnType<typeof makeApp>>['app'];

async function topicsFor(app: App, name: string, bytes: Buffer) {
  const project = await createProject(app);
  const docId = (await upload(app, project.id, { name, bytes })).json().document.id as string;
  const topics = (await app.inject({ url: `/api/documents/${docId}/topics`, headers: asOwner })).json() as TopicsResponse;
  const { blocks } = (await app.inject({ url: `/api/documents/${docId}/blocks`, headers: asOwner })).json() as { blocks: { id: string; text: string }[] };
  return { docId, topics, blocks };
}

function numberedDocx() {
  const paras: DocxParagraph[] = [{ text: 'Synthetic Master Services Agreement', style: 'Heading1' }];
  for (const s of SECTIONS) {
    paras.push({ text: s.heading, num: { numId: 1, ilvl: 0 } });
    for (const c of s.clauses) paras.push({ text: c, num: { numId: 1, ilvl: 1 } });
  }
  return makeDocx(paras, { numbering: true });
}

function typedPdf() {
  // Typed numbers, a few sections per page.
  const pages: string[][] = [];
  let page: string[] = [];
  SECTIONS.forEach((s, i) => {
    page.push(`${i + 1}. ${s.heading}`);
    s.clauses.forEach((c, j) => page.push(`${i + 1}.${j + 1} ${c.length > 95 ? c.slice(0, 95) : c}`, ...(c.length > 95 ? [c.slice(95)] : [])));
    page.push('');
    if (page.length > 40) { pages.push(page); page = []; }
  });
  if (page.length) pages.push(page);
  return makePdf(pages);
}

/** Topic -> texts of the blocks sorted into it. */
const textsByTopic = (topics: TopicsResponse, blocks: { id: string; text: string }[]) =>
  Object.fromEntries(topics.cards.map((c) => [c.topic, c.blocks.map((b) => blocks.find((x) => x.id === b.blockId)!.text)]));

describe('topic sorting', () => {
  it('sorts every section of a numbered Word agreement into its topic card', async () => {
    const { app } = await makeApp();
    const { topics, blocks } = await topicsFor(app, 'msa.docx', await numberedDocx());
    const byTopic = textsByTopic(topics, blocks);
    for (const s of SECTIONS) {
      for (const clause of s.clauses) expect(byTopic[s.topic] ?? [], `${s.topic}: ${clause}`).toContain(clause);
    }
    expect(topics.notFound).toEqual([]);
    // Headings set context but are not clauses themselves.
    const all = topics.cards.flatMap((c) => c.blocks.map((b) => b.excerpt));
    expect(all).not.toContain('Fees');
  });

  it('sorts the same agreement as a PDF with typed clause numbers', async () => {
    const { app } = await makeApp();
    const { topics } = await topicsFor(app, 'msa.pdf', await typedPdf());
    for (const s of SECTIONS) {
      const card = topics.cards.find((c) => c.topic === s.topic);
      expect(card, s.topic).toBeDefined();
      const numbers = card!.blocks.map((b) => b.clauseNumber);
      const sectionNo = String(SECTIONS.indexOf(s) + 1);
      expect(numbers.some((n) => n?.startsWith(`${sectionNo}.`)), `${s.topic} has clause ${sectionNo}.x`).toBe(true);
      // The card shows the number separately, so the excerpt doesn't repeat it.
      for (const b of card!.blocks) if (b.clauseNumber) expect(b.excerpt.startsWith(b.clauseNumber)).toBe(false);
    }
  });

  it('sorts clauses by their own wording when there are no headings', () => {
    const blocks = [
      'The Supplier indemnifies the Client against all third-party claims.',
      'This agreement is governed by the laws of Exampleland.',
      'Either party may terminate on 30 days written notice.',
      'The parties had lunch together on Tuesday.',
    ].map((text, i) => ({ id: `b${i}`, kind: 'paragraph' as const, clauseNumber: null, text }));
    const c = classifyBlocks(blocks);
    expect(c.map((x) => x.topics[0] ?? null)).toEqual(['indemnities', 'governing_law', 'termination_notice', null]);
  });

  it('lists missing topics as not found instead of hiding them', async () => {
    const { app } = await makeApp();
    const { topics } = await topicsFor(app, 'short.docx', await makeDocx([
      '1. Parties. This agreement is made between Acme Ltd ("Acme") and Beta Ltd ("Beta").',
      '2. Fees. Beta shall pay a monthly fee of R1,000.',
    ]));
    expect(topics.cards.map((c) => c.topic)).toEqual(['parties', 'pricing_escalation']);
    expect(topics.notFound).toEqual(TOPICS.filter((t) => !['parties', 'pricing_escalation'].includes(t)));
  });

  it('leaves tracked deletions out of the current wording', async () => {
    const { app } = await makeApp();
    const { topics, blocks } = await topicsFor(app, 'tc.docx', await makeDocx([
      { text: 'This agreement is governed by the laws of ', del: { text: 'Oldland', id: 1 }, ins: { text: 'Newland', id: 2 } },
    ]));
    const texts = topics.cards.flatMap((c) => c.blocks.map((b) => blocks.find((x) => x.id === b.blockId)!.text));
    expect(texts).not.toContain('Oldland');
  });
});

describe('explanations', () => {
  it('every explanation links to its source block and quotes only text that is in it', async () => {
    const { app } = await makeApp();
    const { topics, blocks } = await topicsFor(app, 'msa.docx', await numberedDocx());
    const ids = new Set(topics.cards.flatMap((c) => c.blocks.map((b) => b.blockId)));
    expect(ids.size).toBe(SECTIONS.flatMap((x) => x.clauses).length);
    for (const id of ids) {
      const source = blocks.find((b) => b.id === id)!.text;
      for (const level of ['plain', 'legal'] as const) {
        const res = (await app.inject({ url: `/api/blocks/${id}?level=${level}`, headers: asOwner })).json() as { explanations: ClauseExplanation[]; disclaimer: string };
        expect(res.explanations.length).toBeGreaterThan(0);
        expect(res.disclaimer).toMatch(/not a formal legal advisory tool/);
        for (const e of res.explanations) {
          expect(e.sourceBlockId).toBe(id);
          expect(e.level).toBe(level);
          for (const f of e.facts) {
            expect(f.sourceBlockId).toBe(id);
            expect(source).toContain(f.quote);
          }
          // No number appears in an explanation unless it is in the source clause.
          const prose = [e.whatItMeans, e.whoItFavours, ...e.whatToCheck].join(' ');
          for (const n of prose.match(/\d[\d,.]*/g) ?? []) expect(source, `"${n}" in ${e.topic}`).toContain(n);
        }
      }
    }
  });

  it('the Legal view says why a clause was sorted and gives a fuller checklist', () => {
    const text = 'The Supplier may not assign or cede this agreement without consent.';
    const plain = explainClause({ blockId: 'b1', text, topic: 'assignment', level: 'plain', reasons: ['assignment or cession'] });
    const legal = explainClause({ blockId: 'b1', text, topic: 'assignment', level: 'legal', reasons: ['assignment or cession'] });
    expect(plain.reasons).toBeUndefined();
    expect(legal.reasons).toEqual(['assignment or cession']);
    expect(legal.whatToCheck.length).toBeGreaterThanOrEqual(plain.whatToCheck.length);
    expect(legal.whatItMeans).not.toBe(plain.whatItMeans);
  });

  it('quotes periods, amounts, percentages and placeholders exactly', () => {
    const text = 'The fee of R12,000 escalates by [ESCALATION %] or 5% each year, payable within 30 days.';
    const e = explainClause({ blockId: 'b', text, topic: 'pricing_escalation', level: 'plain' });
    expect(e.facts.map((f) => [f.kind, f.quote])).toEqual([
      ['period', '30 days'],
      ['amount', 'R12,000'],
      ['percentage', '5%'],
      ['placeholder', '[ESCALATION %]'],
    ]);
    expect(e.whatToCheck[0]).toMatch(/blank or placeholder/);
  });

  it('says who a clause favours only from its wording, and admits when it is unclear', () => {
    const e = (text: string) => explainClause({ blockId: 'b', text, topic: 'termination_notice', level: 'plain' }).whoItFavours;
    expect(e('The Supplier may terminate on notice.')).toMatch(/favours Supplier/);
    expect(e('The Client must give 30 days notice.')).toMatch(/duty on Client/);
    expect(e('Either party may terminate on notice.')).toMatch(/both sides/);
    expect(e('Termination happens on notice.')).toMatch(/Not clear/);
    expect(e('The Supplier may not terminate early.')).toMatch(/duty on Supplier/);
  });
});
