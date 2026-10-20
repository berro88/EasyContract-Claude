import { describe, expect, it } from 'vitest';
import { extractDocx } from '../src/extraction/docx.ts';
import { extractPdf } from '../src/extraction/pdf.ts';
import { typedClauseNumber } from '../src/extraction/common.ts';
import { makeDocx, makePdf } from './helpers.ts';

describe('DOCX extraction', () => {
  it('turns Word auto-numbering into real clause numbers', async () => {
    const bytes = await makeDocx([
      { text: 'Definitions', num: { numId: 1, ilvl: 0 } },
      { text: 'In this agreement, words have these meanings.', num: { numId: 1, ilvl: 1 } },
      { text: 'Payment', num: { numId: 1, ilvl: 0 } },
      { text: 'The Client pays monthly.', num: { numId: 1, ilvl: 1 } },
      { text: 'Invoices are due in 30 days.', num: { numId: 1, ilvl: 1 } },
      { text: 'by bank transfer;', num: { numId: 1, ilvl: 2 } },
      { text: 'in the agreed currency.', num: { numId: 1, ilvl: 2 } },
      { text: 'A bullet, not a clause', num: { numId: 2, ilvl: 0 } },
      { text: 'Termination', num: { numId: 1, ilvl: 0 } },
      { text: 'Either party may end this agreement on notice.', num: { numId: 1, ilvl: 1 } },
    ], { numbering: true });
    const { blocks } = await extractDocx(bytes);
    expect(blocks.map((b) => b.clauseNumber)).toEqual(['1', '1.1', '2', '2.1', '2.2', '2.2(a)', '2.2(b)', null, '3', '3.1']);
  });

  it('keeps tracked insertions and deletions as separate blocks', async () => {
    const bytes = await makeDocx([
      { paraId: '0A0B0C0D', text: 'The fee is ', del: { text: 'R10,000', id: 7, author: 'Alex' }, ins: { text: 'R12,000', id: 8, author: 'Sam' } },
    ]);
    const { blocks } = await extractDocx(bytes);
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ['paragraph', 'The fee is'],
      ['tracked_deletion', 'R10,000'],
      ['tracked_insertion', 'R12,000'],
    ]);
    for (const b of blocks) expect(b.anchor).toMatchObject({ format: 'docx', part: 'word/document.xml', paragraphId: '0A0B0C0D' });
    expect(blocks[1].anchor).toMatchObject({ revisionId: '7', author: 'Alex' });
    expect(blocks[2].anchor).toMatchObject({ revisionId: '8', author: 'Sam' });
  });

  it('marks headings and reads typed clause numbers', async () => {
    const { blocks } = await extractDocx(await makeDocx([
      { text: 'Service Agreement', style: 'Heading1' },
      '4.2 The Supplier must keep records for five years.',
    ]));
    expect(blocks[0].kind).toBe('heading');
    expect(blocks[1].clauseNumber).toBe('4.2');
  });
});

describe('PDF extraction', () => {
  it('splits pages into paragraphs anchored by page and character span', async () => {
    const bytes = await makePdf([
      ['1. Parties', 'This agreement is between Acme Ltd and Beta Ltd,', 'both registered companies.', '', 'Signed on the date below.'],
      ['2. Term', 'This agreement runs for twelve months from the start date.'],
    ]);
    const { blocks, pageCount } = await extractPdf(bytes);
    expect(pageCount).toBe(2);
    expect(blocks.map((b) => [b.clauseNumber, b.anchor.format === 'pdf' && b.anchor.page])).toEqual([
      ['1', 1], [null, 1], ['2', 2],
    ]);
    expect(blocks[0].text).toContain('Acme Ltd');
    expect(blocks[0].text).toContain('both registered companies.');
  });
});

describe('typedClauseNumber', () => {
  it.each([
    ['12.3 Payment terms', '12.3'],
    ['Clause 7 Notices', '7'],
    ['3) Insurance', '3'],
    ['The 30 days start today', null],
    ['2026 was a good year', null],
  ])('%s -> %s', (text, expected) => expect(typedClauseNumber(text)).toBe(expected));
});
