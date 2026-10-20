import { createHash } from 'node:crypto';
import type { BlockAnchor, BlockFlag, BlockKind } from '@easycontract/shared';

/** A block before it gets its database ids. */
export interface RawBlock {
  kind: BlockKind;
  clauseNumber: string | null;
  text: string;
  anchor: BlockAnchor;
}

export interface ExtractionResult {
  format: 'pdf' | 'docx';
  pageCount: number | null;
  blocks: RawBlock[];
  /** Set when the file opened but we could not read usable text from it. */
  unreadable: string | null;
}

export class UnsupportedFileError extends Error {}

// A typed clause number at the start of a line: "12", "12.3", "12.3.1", optionally
// followed by "." or ")". Requires whitespace after so "2025 revenue" in prose still
// needs a following space and a short number to match.
const TYPED_CLAUSE = /^\s*(?:(?:clause|section|article)\s+)?(\d{1,3}(?:\.\d{1,3}){0,4})[.)]?\s+\S/i;

export function typedClauseNumber(text: string): string | null {
  const m = TYPED_CLAUSE.exec(text);
  return m ? m[1] : null;
}

// Phrases that try to steer an AI or trigger an action. Matching text is kept
// verbatim as document content and flagged; it never changes what we do.
const INSTRUCTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(instructions?|prompts?|rules|guidelines)\b/i,
  /\bsystem prompt\b/i,
  /\byou are (now )?(an? )?(ai|assistant|chatbot|language model|llm)\b/i,
  /\bas an ai\b/i,
  /<\/?\s*(system|assistant|user|instructions?)\s*>/i,
  /\b(send|e-?mail|forward|upload|post|exfiltrate)\b[^.\n]{0,40}\b(this|all|every|the)\b[^.\n]{0,20}\b(documents?|contracts?|data|files?|records?)\b[^.\n]{0,30}\b(to|at)\b/i,
  /\b(call|invoke|run|execute|use)\b[^.\n]{0,20}\b(the )?(tool|function|command|shell|api)\b/i,
  /\b(fetch|visit|open|download|curl)\b[^.\n]{0,20}https?:\/\//i,
  /\b(mark|report|rate|classify)\b[^.\n]{0,40}\b(as )?(low[- ]risk|no risk|safe|approved|compliant)\b/i,
];

export function detectFlags(text: string): BlockFlag[] {
  return INSTRUCTION_PATTERNS.some((p) => p.test(text)) ? ['embedded_instruction'] : [];
}

const nonSpaceLength = (s: string) => s.replace(/\s+/g, '').length;
const MIN_CHARS_PER_PAGE = 40;
const MIN_LETTER_RATIO = 0.4;

/**
 * Decides whether extracted text is good enough to work with. Returns a
 * plain-English reason when it isn't, so we never report a false success.
 */
export function assessQuality(blocks: RawBlock[], format: 'pdf' | 'docx', pageCount: number | null): string | null {
  const all = blocks.map((b) => b.text).join('\n');
  const chars = nonSpaceLength(all);
  const pages = format === 'pdf' ? Math.max(pageCount ?? 1, 1) : 1;

  if (chars === 0) {
    return format === 'pdf'
      ? "We couldn't read this document. It looks like a scanned or image-only PDF with no text layer. Try the original Word or digital PDF file."
      : "We couldn't read this document. The Word file contains no text.";
  }
  if (chars / pages < MIN_CHARS_PER_PAGE) {
    return format === 'pdf'
      ? `We couldn't read this document properly. Only ${chars} characters of text were found across ${pages} page(s), so it is probably a scan. Try the original Word or digital PDF file.`
      : `We couldn't read this document properly. It contains only ${chars} characters of text.`;
  }
  const letters = (all.match(/\p{L}/gu) ?? []).length;
  if (letters / chars < MIN_LETTER_RATIO) {
    return "We couldn't read this document properly. The text came out garbled, which usually means the PDF uses an unusual font encoding. Try the original Word file.";
  }
  return null;
}

/** Deterministic id: the same anchor in the same version always gets the same id. */
export function stableBlockId(versionId: string, anchorKey: string): string {
  return 'blk_' + createHash('sha256').update(`${versionId}|${anchorKey}`).digest('hex').slice(0, 24);
}

export function anchorKey(anchor: BlockAnchor, kind: BlockKind, occurrence: number): string {
  if (anchor.format === 'pdf') return `pdf|${anchor.page}|${anchor.charStart}|${anchor.charEnd}`;
  return `docx|${anchor.part}|${anchor.paragraphId}|${kind}|${anchor.revisionId ?? ''}|${occurrence}`;
}
