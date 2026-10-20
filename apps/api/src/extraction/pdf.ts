import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { type ExtractionResult, type RawBlock, UnsupportedFileError, assessQuality, typedClauseNumber } from './common.ts';

const MAX_PAGES = 500;
// pdfjs needs its bundled font metrics to read text drawn in the standard PDF fonts.
const STANDARD_FONTS = join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';
const PDF_OPTIONS = { isEvalSupported: false, disableFontFace: true, useSystemFonts: false, standardFontDataUrl: STANDARD_FONTS };

interface Line {
  start: number; // offset into page text
  end: number;
  y: number;
  height: number;
}

interface TextItemLike {
  str: string;
  hasEOL: boolean;
  transform: number[];
  height: number;
}

/**
 * Builds one string per page from the PDF's text layer, then splits it into
 * paragraph blocks. Each block's anchor is a character span into that page
 * string, so `pageText.slice(charStart, charEnd) === block.text` always holds.
 */
export async function extractPdf(bytes: Uint8Array): Promise<ExtractionResult> {
  let pdf;
  try {
    pdf = await getDocument({
      data: new Uint8Array(bytes), // pdfjs takes ownership of the buffer
      ...PDF_OPTIONS,
    }).promise;
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === 'PasswordException') throw new UnsupportedFileError('This PDF is password-protected. Remove the password and upload it again.');
    throw new UnsupportedFileError('This file is not a valid PDF.');
  }

  try {
    if (pdf.numPages > MAX_PAGES) throw new UnsupportedFileError(`This PDF has ${pdf.numPages} pages; the limit is ${MAX_PAGES}.`);
    const blocks: RawBlock[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const { text, lines } = pageTextAndLines(content.items as TextItemLike[]);
      for (const block of paragraphs(text, lines, pageNumber)) blocks.push(block);
      page.cleanup();
    }
    return { format: 'pdf', pageCount: pdf.numPages, blocks, unreadable: assessQuality(blocks, 'pdf', pdf.numPages) };
  } finally {
    await pdf.destroy();
  }
}

export function pageTextAndLines(items: TextItemLike[]): { text: string; lines: Line[] } {
  let text = '';
  const lines: Line[] = [];
  let current: Line | null = null;

  const endLine = () => {
    if (current) {
      current.end = text.length;
      lines.push(current);
      current = null;
    }
  };

  for (const item of items) {
    if (typeof item.str !== 'string') continue; // marked-content markers
    const y = item.transform?.[5] ?? 0;
    // A jump in baseline without an explicit end-of-line still means a new line.
    if (current && item.str && Math.abs(y - current.y) > Math.max(current.height, 1) * 0.5) {
      endLine();
      text += '\n';
    }
    if (item.str) {
      if (!current) current = { start: text.length, end: text.length, y, height: item.height || 10 };
      text += item.str;
    }
    if (item.hasEOL) {
      endLine();
      text += '\n';
    }
  }
  endLine();
  return { text, lines };
}

function paragraphs(text: string, lines: Line[], page: number): RawBlock[] {
  const out: RawBlock[] = [];
  // Normal line spacing is the lower quartile of gaps: paragraph breaks are the larger ones.
  const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y).filter((g) => g > 0).sort((a, b) => a - b);
  const typicalGap = gaps.length ? gaps[Math.floor(gaps.length / 4)] : 0;

  let group: Line[] = [];
  const flush = () => {
    if (!group.length) return;
    let start = group[0].start;
    let end = group[group.length - 1].end;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    const blockText = text.slice(start, end);
    if (blockText) {
      out.push({
        kind: 'paragraph',
        clauseNumber: typedClauseNumber(blockText),
        text: blockText,
        anchor: { format: 'pdf', page, charStart: start, charEnd: end },
      });
    }
    group = [];
  };

  lines.forEach((line, i) => {
    const lineText = text.slice(line.start, line.end);
    if (!lineText.trim()) {
      flush();
      return;
    }
    const prev = lines[i - 1];
    const bigGap = prev && typicalGap > 0 && prev.y - line.y > typicalGap * 1.4;
    const newColumnOrPage = prev && line.y > prev.y; // moved back up the page
    if (group.length && (bigGap || newColumnOrPage || typedClauseNumber(lineText))) flush();
    group.push(line);
  });
  flush();
  return out;
}

/** Re-reads a page's text exactly as extraction saw it, for opening a passage. */
export async function readPdfPageText(bytes: Uint8Array, pageNumber: number): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(bytes), ...PDF_OPTIONS }).promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    return pageTextAndLines(content.items as TextItemLike[]).text;
  } finally {
    await pdf.destroy();
  }
}
