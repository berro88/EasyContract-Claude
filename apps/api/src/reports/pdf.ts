import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { type ReportDoc, TONE_COLOURS } from './model.ts';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const FOOTER_SPACE = 48;

const hex = (h: string) => rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);

/** The standard PDF fonts only cover Latin text; swap anything else for a safe stand-in. */
function safeText(font: PDFFont, text: string): string {
  const map: Record<string, string> = { '→': '->', '←': '<-', '≤': '<=', '≥': '>=', '✓': 'v', '⟨': '<', '⟩': '>' };
  let out = '';
  for (const ch of text.replace(/\t/g, '    ')) {
    const c = map[ch] ?? ch;
    try { font.widthOfTextAtSize(c, 10); out += c; } catch { out += '?'; }
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of safeText(font, text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
      if (line) lines.push(line);
      // A single word wider than the line is split by characters.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      line = w;
    }
    lines.push(line);
  }
  return lines;
}

/** A PDF report. The disclaimer is drawn in the footer of every page. */
export async function renderPdf(doc: ReportDoc): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  pdf.setProducer('EasyContract');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const width = A4[0] - MARGIN * 2;

  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - MARGIN;
  const ensure = (h: number) => {
    if (y - h < MARGIN + FOOTER_SPACE) { page = pdf.addPage(A4); y = A4[1] - MARGIN; }
  };
  const write = (text: string, o: { font?: PDFFont; size?: number; colour?: string; indent?: number; gapBefore?: number; gapAfter?: number; bar?: string; fill?: string } = {}) => {
    const font = o.font ?? regular;
    const size = o.size ?? 10.5;
    const indent = o.indent ?? 0;
    const lh = size * 1.35;
    y -= o.gapBefore ?? 0;
    const lines = wrap(font, text, size, width - indent - (o.fill ? 12 : 0));
    for (const [i, l] of lines.entries()) {
      ensure(lh + (i === 0 ? 4 : 0));
      if (o.fill) page.drawRectangle({ x: MARGIN, y: y - lh + 2, width, height: lh, color: hex(o.fill) });
      if (o.bar) page.drawRectangle({ x: MARGIN + indent - 8, y: y - lh + 2, width: 2.5, height: lh, color: hex(o.bar) });
      page.drawText(l, { x: MARGIN + indent + (o.fill ? 6 : 0), y: y - size, size, font, color: hex(o.colour ?? '1C2330') });
      y -= lh;
    }
    y -= o.gapAfter ?? 4;
  };

  write(doc.title, { font: bold, size: 20, gapAfter: 6 });
  for (const m of doc.meta) write(m, { size: 9.5, colour: '555555', gapAfter: 1 });
  write(doc.disclaimer, { font: bold, size: 9.5, colour: '4A3300', fill: 'FFF4D6', gapBefore: 8, gapAfter: 10 });

  for (const b of doc.blocks) {
    switch (b.type) {
      case 'heading': write(b.text, { font: bold, size: b.level === 1 ? 16 : b.level === 2 ? 13 : 11, gapBefore: b.level === 1 ? 14 : 10, gapAfter: 4 }); break;
      case 'paragraph': write(b.text, { font: b.bold ? bold : regular, colour: b.muted ? '666666' : undefined }); break;
      case 'quote': write(`${b.label ? `${b.label}  ` : ''}${b.text}`, { font: italic, size: 10, indent: 14, bar: '2557D6', colour: '333333' }); break;
      case 'label': write(b.text.toUpperCase(), { font: bold, size: 8.5, colour: TONE_COLOURS[b.tone], gapBefore: 10, gapAfter: 1 }); break;
      case 'bullets': for (const item of b.items) write(`•  ${item}`, { indent: 10, gapAfter: 2 }); break;
      case 'warning': write(`Warning: ${b.text}`, { font: bold, size: 10, colour: '6B1010', fill: 'FDE8E8' }); break;
      case 'rule': ensure(12); page.drawLine({ start: { x: MARGIN, y: y - 4 }, end: { x: A4[0] - MARGIN, y: y - 4 }, thickness: 0.5, color: hex('CCCCCC') }); y -= 12; break;
    }
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const lines = wrap(regular, doc.disclaimer, 8, width);
    lines.forEach((l, j) => p.drawText(l, { x: MARGIN, y: MARGIN - 4 - j * 10, size: 8, font: regular, color: hex('444444') }));
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: A4[0] - MARGIN - 60, y: MARGIN - 4 - lines.length * 10, size: 8, font: regular, color: hex('777777') });
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 8 }, end: { x: A4[0] - MARGIN, y: MARGIN + 8 }, thickness: 0.5, color: hex('CCCCCC') });
  });
  return Buffer.from(await pdf.save());
}
