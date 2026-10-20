import { describe, expect, it } from 'vitest';
import { asOwner, createProject, makeApp, makeDocx, makePdf, upload } from './helpers.ts';

type Block = { id: string; text: string; kind: string; anchor: Record<string, unknown> };

async function blocksFor(app: Awaited<ReturnType<typeof makeApp>>['app'], name: string, bytes: Buffer) {
  const project = await createProject(app);
  const res = await upload(app, project.id, { name, bytes });
  const docId = res.json().document.id as string;
  return { docId, blocks: (await app.inject({ url: `/api/documents/${docId}/blocks`, headers: asOwner })).json().blocks as Block[] };
}

describe('block-to-passage linking', () => {
  it('every PDF block opens exactly its passage in the original file', async () => {
    const { app } = await makeApp();
    const { blocks } = await blocksFor(app, 'c.pdf', await makePdf([
      ['1. Parties', 'Acme Ltd and Beta Ltd agree as follows.', '', '2. Price', 'The price is stated in Schedule 1.'],
      ['3. Term', 'Twelve months from the start date.'],
    ]));
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const b of blocks) {
      const p = (await app.inject({ url: `/api/blocks/${b.id}/passage`, headers: asOwner })).json();
      expect(p.verified).toBe(true);
      expect(p.text).toBe(b.text);
      expect(p.location).toMatch(/^page \d+, characters \d+–\d+$/);
      expect(p.disclaimer).toMatch(/not a formal legal advisory tool/);
    }
  });

  it('every DOCX block, including tracked changes, opens exactly its passage', async () => {
    const { app } = await makeApp();
    const { blocks } = await blocksFor(app, 'c.docx', await makeDocx([
      '1. Parties. Acme Ltd and Beta Ltd agree as follows.',
      { text: '2. Price. The price is ', del: { text: 'R100', id: 1 }, ins: { text: 'R120', id: 2 } },
      '3. Term. Twelve months.',
    ]));
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'paragraph', 'tracked_deletion', 'tracked_insertion', 'paragraph']);
    for (const b of blocks) {
      const p = (await app.inject({ url: `/api/blocks/${b.id}/passage`, headers: asOwner })).json();
      expect(p.verified).toBe(true);
      expect(p.text).toBe(b.text);
    }
  });

  it('block ids are stable for the same anchor and every note links back to its block', async () => {
    const { app } = await makeApp();
    const { blocks } = await blocksFor(app, 'c.docx', await makeDocx(['1. Parties. Acme and Beta.', '2. Term. One year.']));
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
    for (const b of blocks) {
      for (const level of ['plain', 'legal']) {
        const d = (await app.inject({ url: `/api/blocks/${b.id}?level=${level}`, headers: asOwner })).json();
        expect(d.note.sourceBlockId).toBe(b.id);
        expect(d.block.text).toBe(b.text);
        expect(d.disclaimer).toMatch(/Consulting a legal practitioner is always advisable/);
      }
    }
  });
});
