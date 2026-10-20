import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { OcrParagraph, OcrProvider } from '../interfaces/index.ts';

const run = promisify(execFile);
const TIMEOUT_MS = 120_000;

/**
 * Local OCR with the Tesseract and Poppler command-line tools. Nothing leaves
 * the machine. Each page is rendered and read on its own, so a long scan is
 * processed one page at a time.
 */
export class TesseractCliOcr implements OcrProvider {
  readonly key = 'tesseract-cli';

  constructor(private lang = 'eng') {}

  /** True when both `pdftoppm` and `tesseract` can be run. */
  static async available(): Promise<boolean> {
    try {
      await run('tesseract', ['--version'], { timeout: 10_000 });
      await run('pdftoppm', ['-v'], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  async recognisePage(pdf: Uint8Array, pageNumber: number): Promise<OcrParagraph[]> {
    const dir = await mkdtemp(join(tmpdir(), 'easycontract-ocr-'));
    try {
      const input = join(dir, 'in.pdf');
      await writeFile(input, pdf);
      await run('pdftoppm', ['-f', String(pageNumber), '-l', String(pageNumber), '-r', '300', '-png', '-singlefile', input, join(dir, 'page')], { timeout: TIMEOUT_MS });
      const { stdout } = await run('tesseract', [join(dir, 'page.png'), 'stdout', '-l', this.lang, 'tsv'], { timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
      return parseTsv(stdout);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** Groups Tesseract's word rows into paragraphs, averaging word confidence. */
export function parseTsv(tsv: string): OcrParagraph[] {
  const paras = new Map<string, { words: string[]; conf: number[] }>();
  for (const line of tsv.split('\n').slice(1)) {
    const cols = line.split('\t');
    if (cols.length < 12 || cols[0] !== '5') continue; // level 5 = word
    const text = cols[11]?.trim();
    const conf = Number(cols[10]);
    if (!text || conf < 0) continue;
    const key = `${cols[2]}-${cols[3]}`; // block-paragraph
    const p = paras.get(key) ?? { words: [], conf: [] };
    p.words.push(text);
    p.conf.push(conf);
    paras.set(key, p);
  }
  return [...paras.values()].map((p) => ({ text: p.words.join(' '), confidence: Math.round(p.conf.reduce((a, b) => a + b, 0) / p.conf.length) }));
}
