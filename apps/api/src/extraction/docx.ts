import JSZip from 'jszip';
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import type { BlockKind } from '@easycontract/shared';
import { type ExtractionResult, type RawBlock, UnsupportedFileError, assessQuality, typedClauseNumber } from './common.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const DOCUMENT_PART = 'word/document.xml';
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

const elements = (node: { childNodes: ArrayLike<unknown> }): XmlElement[] =>
  Array.from(node.childNodes as ArrayLike<XmlElement>).filter((n) => n.nodeType === 1);
const child = (el: XmlElement, name: string) => elements(el).find((c) => c.namespaceURI === W && c.localName === name);
const wAttr = (el: XmlElement | undefined, name: string) => el?.getAttributeNS(W, name) || null;

function parseXml(xml: string) {
  // xmldom does not resolve external entities, so XXE is not possible here.
  return new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml');
}

// ---------- Numbering ----------

interface Level {
  numFmt: string;
  lvlText: string;
  start: number;
}

interface Numbering {
  /** numId -> abstractNumId */
  nums: Map<string, { abstractId: string; startOverrides: Map<number, number> }>;
  /** abstractNumId -> levels by ilvl */
  abstracts: Map<string, Map<number, Level>>;
}

function parseNumbering(xml: string | null): Numbering {
  const out: Numbering = { nums: new Map(), abstracts: new Map() };
  if (!xml) return out;
  const root = parseXml(xml).documentElement;
  if (!root) return out;
  for (const el of elements(root)) {
    if (el.localName === 'abstractNum') {
      const levels = new Map<number, Level>();
      for (const lvl of elements(el).filter((c) => c.localName === 'lvl')) {
        levels.set(Number(wAttr(lvl, 'ilvl') ?? 0), {
          numFmt: wAttr(child(lvl, 'numFmt'), 'val') ?? 'decimal',
          lvlText: wAttr(child(lvl, 'lvlText'), 'val') ?? '',
          start: Number(wAttr(child(lvl, 'start'), 'val') ?? 1),
        });
      }
      out.abstracts.set(wAttr(el, 'abstractNumId') ?? '', levels);
    } else if (el.localName === 'num') {
      const startOverrides = new Map<number, number>();
      for (const o of elements(el).filter((c) => c.localName === 'lvlOverride')) {
        const s = wAttr(child(o, 'startOverride'), 'val');
        if (s !== null) startOverrides.set(Number(wAttr(o, 'ilvl') ?? 0), Number(s));
      }
      out.nums.set(wAttr(el, 'numId') ?? '', {
        abstractId: wAttr(child(el, 'abstractNumId'), 'val') ?? '',
        startOverrides,
      });
    }
  }
  return out;
}

/** styleId -> { numPr from the style chain, heading-ness } */
function parseStyles(xml: string | null) {
  const styles = new Map<string, { basedOn: string | null; numId: string | null; ilvl: number | null; name: string }>();
  if (!xml) return styles;
  const root = parseXml(xml).documentElement;
  if (!root) return styles;
  for (const el of elements(root).filter((c) => c.localName === 'style')) {
    const numPr = child(el, 'pPr') && child(child(el, 'pPr')!, 'numPr');
    styles.set(wAttr(el, 'styleId') ?? '', {
      basedOn: wAttr(child(el, 'basedOn'), 'val'),
      numId: wAttr(numPr && child(numPr, 'numId'), 'val'),
      ilvl: numPr && child(numPr, 'ilvl') ? Number(wAttr(child(numPr, 'ilvl'), 'val')) : null,
      name: wAttr(child(el, 'name'), 'val') ?? '',
    });
  }
  return styles;
}

function toRoman(n: number): string {
  const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

function toLetters(n: number): string {
  // Word repeats the letter after z: a..z, aa..zz.
  const letter = String.fromCharCode(97 + ((n - 1) % 26));
  return letter.repeat(Math.floor((n - 1) / 26) + 1);
}

function formatNumber(n: number, fmt: string): string | null {
  switch (fmt) {
    case 'decimal': case 'decimalZero': return fmt === 'decimalZero' && n < 10 ? `0${n}` : String(n);
    case 'lowerLetter': return toLetters(n);
    case 'upperLetter': return toLetters(n).toUpperCase();
    case 'lowerRoman': return toRoman(n);
    case 'upperRoman': return toRoman(n).toUpperCase();
    case 'bullet': case 'none': return null;
    default: return String(n);
  }
}

/** Turns Word's auto-numbering into the clause numbers people see on the page. */
class NumberingCounter {
  private counters = new Map<string, number[]>();
  private seenNums = new Set<string>();
  /** Last full label per level, so "(a)" under "3.1" becomes "3.1(a)". */
  private labels = new Map<string, string[]>();

  constructor(private numbering: Numbering) {}

  next(numId: string, ilvl: number): string | null {
    const num = this.numbering.nums.get(numId);
    if (!num) return null;
    const levels = this.numbering.abstracts.get(num.abstractId);
    const level = levels?.get(ilvl);
    if (!levels || !level) return null;

    const key = num.abstractId;
    const counts = this.counters.get(key) ?? [];
    const startFor = (l: number) => num.startOverrides.get(l) ?? levels.get(l)?.start ?? 1;
    if (!this.seenNums.has(numId)) {
      this.seenNums.add(numId);
      if (num.startOverrides.size) for (const [l] of num.startOverrides) counts[l] = startFor(l) - 1;
    }
    for (let l = 0; l < ilvl; l++) if (counts[l] === undefined) counts[l] = startFor(l);
    counts[ilvl] = (counts[ilvl] ?? startFor(ilvl) - 1) + 1;
    counts.length = ilvl + 1; // deeper levels restart
    this.counters.set(key, counts);

    if (level.numFmt === 'bullet' || level.numFmt === 'none') return null;
    let text = level.lvlText.replace(/%(\d)/g, (_, d) => {
      const l = Number(d) - 1;
      return formatNumber(counts[l] ?? startFor(l), levels.get(l)?.numFmt ?? 'decimal') ?? '';
    });
    text = text.trim().replace(/\.$/, '');
    if (!text) return null;

    const labels = this.labels.get(key) ?? [];
    // If this level's text doesn't include its parents ("(a)"), prefix the parent's label.
    if (ilvl > 0 && !/%1/.test(level.lvlText) && labels[ilvl - 1]) text = `${labels[ilvl - 1]}${text}`;
    labels[ilvl] = text;
    labels.length = ilvl + 1;
    this.labels.set(key, labels);
    return text;
  }
}

// ---------- Paragraph text ----------

interface Segment {
  type: 'normal' | 'ins' | 'del';
  text: string;
  revisionId?: string;
  author?: string;
  date?: string;
}

function runText(run: XmlElement, deleted: boolean): string {
  let s = '';
  for (const c of elements(run)) {
    if (c.namespaceURI !== W) continue;
    if (c.localName === (deleted ? 'delText' : 't')) s += c.textContent ?? '';
    else if (c.localName === 'tab') s += '\t';
    else if (c.localName === 'br' || c.localName === 'cr') s += '\n';
    else if (c.localName === 'noBreakHyphen') s += '-';
  }
  return s;
}

function collectSegments(el: XmlElement, segments: Segment[], mode: Segment | null) {
  for (const c of elements(el)) {
    if (c.namespaceURI !== W) continue;
    switch (c.localName) {
      case 'r': {
        const text = runText(c, mode?.type === 'del');
        if (!text) break;
        if (mode) mode.text += text;
        else {
          const last = segments[segments.length - 1];
          if (last?.type === 'normal') last.text += text;
          else segments.push({ type: 'normal', text });
        }
        break;
      }
      case 'ins':
      case 'del': {
        const seg: Segment = {
          type: c.localName,
          text: '',
          revisionId: wAttr(c, 'id') ?? undefined,
          author: wAttr(c, 'author') ?? undefined,
          date: wAttr(c, 'date') ?? undefined,
        };
        collectSegments(c, segments, seg);
        if (seg.text) segments.push(seg);
        break;
      }
      case 'hyperlink': case 'smartTag': case 'fldSimple': case 'customXml': case 'sdtContent':
        collectSegments(c, segments, mode);
        break;
      case 'sdt': {
        const content = child(c, 'sdtContent');
        if (content) collectSegments(content, segments, mode);
        break;
      }
    }
  }
}

// ---------- Main ----------

export async function extractDocx(bytes: Uint8Array): Promise<ExtractionResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new UnsupportedFileError('This file is not a valid Word (.docx) document.');
  }
  const docFile = zip.file(DOCUMENT_PART);
  if (!docFile) throw new UnsupportedFileError('This file is not a valid Word (.docx) document.');

  let total = 0;
  zip.forEach((_, f) => {
    total += (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  });
  if (total > MAX_UNCOMPRESSED_BYTES) throw new UnsupportedFileError('This Word file is too large once unpacked.');

  const read = async (name: string) => (zip.file(name) ? zip.file(name)!.async('string') : null);
  const counter = new NumberingCounter(parseNumbering(await read('word/numbering.xml')));
  const styles = parseStyles(await read('word/styles.xml'));
  const body = parseXml(await docFile.async('string')).getElementsByTagNameNS(W, 'body')[0];

  const blocks: RawBlock[] = [];
  let position = 0;

  const styleNumbering = (styleId: string | null) => {
    for (let id = styleId, guard = 0; id && guard < 20; guard++) {
      const s = styles.get(id);
      if (!s) break;
      if (s.numId) return { numId: s.numId, ilvl: s.ilvl ?? 0 };
      id = s.basedOn;
    }
    return null;
  };

  const handleParagraph = (p: XmlElement, inTable: boolean) => {
    position++;
    const paraIdAttr = p.getAttributeNS(W14, 'paraId');
    const paragraphId = paraIdAttr || `p${position}`;
    const paragraphIdSource = paraIdAttr ? ('paraId' as const) : ('position' as const);

    const pPr = child(p, 'pPr');
    const styleId = wAttr(pPr && child(pPr, 'pStyle'), 'val');
    const styleName = (styleId && styles.get(styleId)?.name) || styleId || '';
    const numPr = pPr && child(pPr, 'numPr');
    let numbering = numPr
      ? { numId: wAttr(child(numPr, 'numId'), 'val') ?? '0', ilvl: Number(wAttr(child(numPr, 'ilvl'), 'val') ?? 0) }
      : styleNumbering(styleId);
    if (numbering?.numId === '0') numbering = null;

    const segments: Segment[] = [];
    collectSegments(p, segments, null);
    const mainText = segments.filter((s) => s.type === 'normal').map((s) => s.text).join('');
    const hasAnyText = segments.some((s) => s.text.trim());
    // Empty paragraphs still advance numbering in Word, so count them first.
    const autoNumber = numbering ? counter.next(numbering.numId, numbering.ilvl) : null;
    if (!hasAnyText) return;

    const clauseNumber = autoNumber ?? typedClauseNumber(mainText);
    const isHeading = /^(heading|title)/i.test(styleName);
    const kind: BlockKind = inTable ? 'table_cell' : isHeading ? 'heading' : 'paragraph';
    const base = { format: 'docx' as const, part: DOCUMENT_PART, paragraphId, paragraphIdSource };

    if (mainText.trim()) blocks.push({ kind, clauseNumber, text: mainText.trim(), anchor: base });
    for (const s of segments) {
      if (s.type === 'normal' || !s.text.trim()) continue;
      blocks.push({
        kind: s.type === 'ins' ? 'tracked_insertion' : 'tracked_deletion',
        clauseNumber,
        text: s.text.trim(),
        anchor: { ...base, revisionId: s.revisionId, author: s.author, date: s.date },
      });
    }
  };

  const walk = (el: XmlElement, inTable: boolean) => {
    for (const c of elements(el)) {
      if (c.namespaceURI !== W) continue;
      if (c.localName === 'p') handleParagraph(c, inTable);
      else if (c.localName === 'tbl') walk(c, true);
      else if (['tr', 'tc', 'sdt', 'sdtContent', 'customXml'].includes(c.localName ?? '')) walk(c, inTable);
    }
  };
  if (body) walk(body, false);

  // Word records its own page count; otherwise estimate ~3,000 characters a page.
  const appPages = Number(/<Pages>(\d+)<\/Pages>/.exec((await read('docProps/app.xml')) ?? '')?.[1]);
  const chars = blocks.reduce((n, b) => n + b.text.length, 0);
  const pageCount = appPages > 0 ? appPages : Math.max(1, Math.ceil(chars / 3000));

  return { format: 'docx', pageCount, blocks, unreadable: assessQuality(blocks, 'docx', null) };
}
