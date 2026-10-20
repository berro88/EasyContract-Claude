import { describe, expect, it } from 'vitest';
import { asOwner, createProject, makeApp, makeDocx, makeImageOnlyPdf, makePdf, multipart, upload } from './helpers.ts';

describe('quality checks', () => {
  it('reports an image-only (scanned) PDF as unreadable instead of succeeding', async () => {
    const { app, db } = await makeApp();
    const project = await createProject(app);
    const res = await upload(app, project.id, { name: 'scan.pdf', bytes: await makeImageOnlyPdf(3) });
    expect(res.statusCode).toBe(201);
    const { document, blockCount } = res.json();
    expect(document.latestVersion.status).toBe('unreadable');
    expect(document.latestVersion.qualityMessage).toMatch(/couldn't read this/i);
    expect(blockCount).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM extraction_blocks').get()).toEqual({ n: 0 });
  });

  it('reports a near-empty PDF as unreadable', async () => {
    const { app } = await makeApp();
    const project = await createProject(app);
    const res = await upload(app, project.id, { name: 'thin.pdf', bytes: await makePdf([['Page 1'], ['Page 2'], ['3']]) });
    expect(res.json().document.latestVersion.status).toBe('unreadable');
  });

  it('reports an empty Word file as unreadable', async () => {
    const { app } = await makeApp();
    const project = await createProject(app);
    const res = await upload(app, project.id, { name: 'empty.docx', bytes: await makeDocx(['', ' ']) });
    expect(res.json().document.latestVersion.qualityMessage).toMatch(/couldn't read this/i);
  });

  it('accepts a normal contract as ready', async () => {
    const { app } = await makeApp();
    const project = await createProject(app);
    const res = await upload(app, project.id, {
      name: 'ok.docx',
      bytes: await makeDocx(['1. Parties. This agreement is between Acme Ltd and Beta Ltd.', '2. Term. It runs for twelve months.']),
    });
    expect(res.json().document.latestVersion.status).toBe('ready');
    expect(res.json().blockCount).toBe(2);
  });

  it.each([
    ['notes.txt', Buffer.from('hello'), /Only PDF and Word/],
    ['fake.pdf', Buffer.from('not a pdf at all'), /not a PDF/],
    ['fake.docx', Buffer.from('not a zip'), /not a Word document/],
    ['old.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), /\.doc/],
  ])('rejects %s by content, not name', async (name, bytes, message) => {
    const { app, db } = await makeApp();
    const project = await createProject(app);
    const res = await upload(app, project.id, { name, bytes });
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toMatch(message);
    expect(db.prepare('SELECT COUNT(*) AS n FROM documents').get()).toEqual({ n: 0 });
  });

  it('rejects files over the size limit', async () => {
    const { app } = await makeApp();
    const project = await createProject(app);
    const tooBig = Buffer.alloc(21 * 1024 * 1024, 0x20);
    const res = await upload(app, project.id, { name: 'big.pdf', bytes: tooBig });
    expect(res.statusCode).toBe(413);
  });

  it('requires a document role', async () => {
    const { app } = await makeApp();
    const project = await createProject(app);
    const body = multipart({}, { name: 'x.docx', bytes: await makeDocx(['1. Parties. Acme and Beta agree.']) });
    const res = await app.inject({ method: 'POST', url: `/api/projects/${project.id}/documents`, headers: { ...asOwner, ...body.headers }, payload: body.payload });
    expect(res.statusCode).toBe(400);
  });
});
