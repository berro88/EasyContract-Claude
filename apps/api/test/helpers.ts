// Test fixtures: synthetic contracts only, generated in code.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db/index.ts';
import { SEED, seed } from '../src/db/seed.ts';
import { FileStorage } from '../src/lib/storage.ts';
import { DeterministicProvider } from '../src/providers/deterministic.ts';
import { DbPlaybookSource } from '../src/library/store.ts';

export { SEED };

export async function makeApp() {
  const dataDir = mkdtempSync(join(tmpdir(), 'easycontract-test-'));
  const config = { ...loadConfig({ DATA_DIR: dataDir }), dbPath: ':memory:' };
  const db = openDb(':memory:');
  seed(db);
  const app = await buildApp({ db, config, storage: new FileStorage(config.storageDir), ai: new DeterministicProvider(), playbooks: new DbPlaybookSource(db) });
  return { app, db, config };
}

export const asOwner = { 'x-user-id': SEED.ownerId };
export const asOther = { 'x-user-id': SEED.otherUserId };

// ---------- DOCX ----------

export type DocxParagraph =
  | string
  | {
      text?: string;
      paraId?: string;
      style?: string;
      num?: { numId: number; ilvl: number };
      ins?: { text: string; id: number; author?: string };
      del?: { text: string; id: number; author?: string };
    };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function makeDocx(paragraphs: DocxParagraph[], opts: { numbering?: boolean } = {}): Promise<Buffer> {
  const body = paragraphs.map((p, i) => {
    const o = typeof p === 'string' ? { text: p } : p;
    const paraId = o.paraId ?? (0x10000000 + i).toString(16).toUpperCase();
    const pPr = [
      o.style ? `<w:pStyle w:val="${o.style}"/>` : '',
      o.num ? `<w:numPr><w:ilvl w:val="${o.num.ilvl}"/><w:numId w:val="${o.num.numId}"/></w:numPr>` : '',
    ].join('');
    const runs = [
      o.text ? `<w:r><w:t xml:space="preserve">${esc(o.text)}</w:t></w:r>` : '',
      o.del ? `<w:del w:id="${o.del.id}" w:author="${o.del.author ?? 'Reviewer'}" w:date="2026-01-02T00:00:00Z"><w:r><w:delText>${esc(o.del.text)}</w:delText></w:r></w:del>` : '',
      o.ins ? `<w:ins w:id="${o.ins.id}" w:author="${o.ins.author ?? 'Reviewer'}" w:date="2026-01-02T00:00:00Z"><w:r><w:t xml:space="preserve">${esc(o.ins.text)}</w:t></w:r></w:ins>` : '',
    ].join('');
    return `<w:p w14:paraId="${paraId}">${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs}</w:p>`;
  }).join('');

  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>${body}</w:body></w:document>`);
  if (opts.numbering) {
    zip.file('word/numbering.xml',
      `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:abstractNum w:abstractNumId="0">
          <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
          <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl>
          <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%3)"/></w:lvl>
        </w:abstractNum>
        <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
        <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
      </w:numbering>`);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

// ---------- PDF ----------

/** One array of lines per page. An empty string leaves a blank line (a paragraph break). */
export async function makePdf(pages: string[][]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = pdf.addPage([595, 842]);
    let y = 800;
    for (const line of lines) {
      if (line) page.drawText(line, { x: 50, y, size: 11, font });
      y -= 16;
    }
  }
  return Buffer.from(await pdf.save());
}

/** A PDF whose pages carry only shapes: what a scan looks like to a text extractor. */
export async function makeImageOnlyPdf(pageCount = 2): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = pdf.addPage([595, 842]);
    page.drawRectangle({ x: 40, y: 40, width: 515, height: 762, borderWidth: 1 });
  }
  return Buffer.from(await pdf.save());
}

// ---------- Multipart ----------

export function multipart(fields: Record<string, string>, file?: { name: string; bytes: Buffer }) {
  const boundary = '----easycontract' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    chunks.push(file.bytes, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export async function createProject(app: Awaited<ReturnType<typeof makeApp>>['app'], headers = asOwner, name = 'Test project') {
  const res = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name } });
  if (res.statusCode !== 201) throw new Error(`create project failed: ${res.body}`);
  return res.json() as { id: string };
}

export async function upload(
  app: Awaited<ReturnType<typeof makeApp>>['app'],
  projectId: string,
  file: { name: string; bytes: Buffer },
  role = 'main_agreement',
  headers: Record<string, string> = asOwner,
) {
  const body = multipart({ role }, file);
  return app.inject({ method: 'POST', url: `/api/projects/${projectId}/documents`, headers: { ...headers, ...body.headers }, payload: body.payload });
}
