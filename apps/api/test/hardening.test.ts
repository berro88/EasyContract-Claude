import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import JSZip from 'jszip';
import type { ExtractionBlock, FindingsResponse } from '@easycontract/shared';
import { asOwner, createProject, makeApp, makeDocx, makeImageOnlyPdf, upload } from './helpers.ts';
import type { OcrProvider } from '../src/interfaces/index.ts';
import { parseTsv } from '../src/ocr/tesseract.ts';
import { loadConfig } from '../src/config.ts';

describe('security headers and the preview password', () => {
  it('sends protective headers on every response', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ url: '/api/projects', headers: asOwner });
    expect(res.headers).toMatchObject({
      'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
    });
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
  });

  it('puts the whole site behind one password when PREVIEW_PASSWORD is set', async () => {
    const { app } = await makeApp({ config: { previewPassword: 'open sesame preview' } });
    const none = await app.inject({ url: '/api/projects', headers: asOwner });
    expect(none.statusCode).toBe(401);
    expect(none.headers['www-authenticate']).toMatch(/^Basic realm="EasyContract preview"/);
    const wrong = await app.inject({ url: '/api/projects', headers: { ...asOwner, authorization: `Basic ${Buffer.from('x:nope').toString('base64')}` } });
    expect(wrong.statusCode).toBe(401);
    const right = await app.inject({ url: '/api/projects', headers: { ...asOwner, authorization: `Basic ${Buffer.from('anyone:open sesame preview').toString('base64')}` } });
    expect(right.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200); // for the host's health check
  });

  it('reads secrets only from the environment, and is production-safe by default there', () => {
    const prod = loadConfig({ NODE_ENV: 'production', PREVIEW_PASSWORD: '  s3cret  ', DATA_DIR: '/tmp/x' });
    expect(prod).toMatchObject({ devAuth: false, secureCookies: true, previewPassword: 's3cret', host: '0.0.0.0' });
    expect(loadConfig({ DATA_DIR: '/tmp/x' }).previewPassword).toBeNull();
    // The example env file names settings but holds no secret values.
    const example = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    expect(example).not.toMatch(/PREVIEW_PASSWORD=\S/);
  });
});

describe('logs', () => {
  it('never contain contract text, even when something goes wrong', async () => {
    let log = '';
    const logStream = new Writable({ write(chunk, _enc, cb) { log += chunk.toString(); cb(); } });
    const { app } = await makeApp({ logStream });
    const p = await createProject(app);
    const SECRET = 'Zebra-Quartz confidential rebate of R777,777';
    await upload(app, p.id, { name: 'secret.docx', bytes: await makeDocx([`1. Fees. ${SECRET} applies to all orders this year.`, '2. Term. One year.']) });
    await upload(app, p.id, { name: 'broken.pdf', bytes: Buffer.from(`%PDF-1.4 ${SECRET}`) });
    await app.inject({ method: 'POST', url: '/api/projects', headers: asOwner, payload: { name: SECRET } });
    expect(log.length).toBeGreaterThan(0);
    expect(log).toContain('"statusCode"');
    expect(log).not.toContain('Zebra-Quartz');
    expect(log).not.toContain('777,777');
  });
});

describe('old Word (.doc) files', () => {
  it('are read locally, anchored by paragraph, and passages re-open from the original', async () => {
    const { app } = await makeApp();
    const p = await createProject(app);
    const res = await upload(app, p.id, { name: 'legacy.doc', bytes: readFileSync(new URL('./fixtures/synthetic-legacy.doc', import.meta.url)) });
    expect(res.statusCode).toBe(201);
    expect(res.json().document.latestVersion).toMatchObject({ status: 'ready', mimeType: 'application/msword' });
    const { blocks } = (await app.inject({ url: `/api/documents/${res.json().document.id}/blocks`, headers: asOwner })).json() as { blocks: ExtractionBlock[] };
    const clauses = blocks.filter((b) => b.clauseNumber);
    expect(clauses.map((b) => b.clauseNumber)).toEqual(['1', '2', '3']);
    expect(clauses[1].text).toContain('R9,500');
    expect(clauses[1].anchor).toMatchObject({ format: 'doc' });
    for (const b of clauses) {
      const passage = (await app.inject({ url: `/api/blocks/${b.id}/passage`, headers: asOwner })).json();
      expect(passage).toMatchObject({ verified: true, text: b.text });
    }
  });
});

describe('optional local OCR for scans', () => {
  /** Stands in for Tesseract: returns fixed paragraphs for each page and records the calls. */
  const fakeOcr = (pages: Record<number, { text: string; confidence: number }[]>) => {
    const calls: number[] = [];
    const ocr: OcrProvider = { key: 'fake', recognisePage: async (_pdf, page) => { calls.push(page); return pages[page] ?? []; } };
    return { ocr, calls };
  };

  it('reads a scan one page at a time, keeps a confidence per passage, and warns on screen and in exports', async () => {
    const { ocr, calls } = fakeOcr({
      1: [{ text: '1. Parties. This agreement is made between Example Supplier (Pty) Ltd and Sample Client Ltd.', confidence: 93 }],
      2: [{ text: '2. Fees. The Client shall pay a monthly fee of R12,000.', confidence: 61 }, { text: '3. Term. Twelve months from the start date.', confidence: 88 }],
    });
    const { app } = await makeApp({ ocr });
    const p = await createProject(app);
    const res = await upload(app, p.id, { name: 'scan.pdf', bytes: await makeImageOnlyPdf(2) });
    expect(calls).toEqual([1, 2]);
    const version = res.json().document.latestVersion;
    expect(version.status).toBe('ready');
    expect(version.qualityMessage).toMatch(/Read from a scan.*check the wording/);

    const docId = res.json().document.id;
    const { blocks } = (await app.inject({ url: `/api/documents/${docId}/blocks`, headers: asOwner })).json() as { blocks: ExtractionBlock[] };
    expect(blocks.map((b) => [b.clauseNumber, b.flags, b.anchor.format === 'pdf' && b.anchor.ocrConfidence])).toEqual([
      ['1', ['read_from_scan'], 93], ['2', ['read_from_scan'], 61], ['3', ['read_from_scan'], 88],
    ]);
    const passage = (await app.inject({ url: `/api/blocks/${blocks[1].id}/passage`, headers: asOwner })).json();
    expect(passage).toMatchObject({ fromScan: true, verified: false, confidence: 61, text: blocks[1].text });

    const report = await app.inject({ url: `/api/documents/${docId}/report?format=docx`, headers: asOwner });
    const xml = await (await JSZip.loadAsync(report.rawPayload)).file('word/document.xml')!.async('string');
    expect(xml).toContain('Read from a scan');
    const findings = (await app.inject({ url: `/api/documents/${docId}/findings`, headers: asOwner })).json() as FindingsResponse;
    expect(findings.findings.length).toBeGreaterThan(0);
  });

  it('still reports "couldn\'t read this" if OCR finds too little', async () => {
    const { ocr } = fakeOcr({ 1: [{ text: 'smudge', confidence: 12 }] });
    const { app } = await makeApp({ ocr });
    const p = await createProject(app);
    const res = await upload(app, p.id, { name: 'scan.pdf', bytes: await makeImageOnlyPdf(1) });
    expect(res.json().document.latestVersion).toMatchObject({ status: 'unreadable' });
  });

  it('groups Tesseract output into paragraphs with an average confidence', () => {
    const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
    const row = (block: number, par: number, conf: number, text: string) => `5\t1\t${block}\t${par}\t1\t1\t0\t0\t10\t10\t${conf}\t${text}`;
    const tsv = [header, '1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t', row(1, 1, 90, 'The'), row(1, 1, 80, 'fee'), row(1, 2, 70, 'Next'), row(2, 1, -1, '')].join('\n');
    expect(parseTsv(tsv)).toEqual([{ text: 'The fee', confidence: 85 }, { text: 'Next', confidence: 70 }]);
  });
});
