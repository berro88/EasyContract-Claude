// Matches clauses between two documents by what they say, not by their
// numbers, so a clause renumbered from 4.2 to 5.2 still pairs up. Then
// produces a word-level redline for each matched pair.

import type { ClauseSide, CompareRow, CompareRowStatus, DiffOp, ExtractionBlock } from '@easycontract/shared';

/** Same wording, ignoring spacing and case. */
export const normalise = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Wording without a leading typed clause number ("5.1 The fee…" → "The fee…"). */
export function stripNumber(text: string, clauseNumber: string | null): string {
  if (!clauseNumber) return text;
  const escaped = clauseNumber.replace(/[.()]/g, '\\$&');
  return text.replace(new RegExp(`^\\s*(?:(?:clause|section|article)\\s+)?${escaped}[.)]?\\s+`, 'i'), '');
}

const words = (s: string) => normalise(s).replace(/[^\p{L}\p{N}%\s]/gu, ' ').split(/\s+/).filter(Boolean);

/** Dice similarity over word counts: 1 is identical wording, 0 is nothing shared. */
export function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.length && !wb.length) return 1;
  if (!wa.length || !wb.length) return 0;
  const counts = new Map<string, number>();
  for (const w of wa) counts.set(w, (counts.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of wb) {
    const n = counts.get(w) ?? 0;
    if (n > 0) { shared++; counts.set(w, n - 1); }
  }
  return (2 * shared) / (wa.length + wb.length);
}

const MAX_DIFF_TOKENS = 1500;

/** Word-level diff (longest common subsequence), keeping spaces with words. */
export function wordDiff(a: string, b: string): DiffOp[] {
  const ta = a.split(/(\s+)/).filter(Boolean);
  const tb = b.split(/(\s+)/).filter(Boolean);
  if (ta.length > MAX_DIFF_TOKENS || tb.length > MAX_DIFF_TOKENS) {
    return [{ op: 'remove', text: a }, { op: 'add', text: b }];
  }
  const n = ta.length;
  const m = tb.length;
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = ta[i] === tb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  const push = (op: DiffOp['op'], text: string) => {
    const last = ops[ops.length - 1];
    if (last?.op === op) last.text += text;
    else ops.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ta[i] === tb[j]) { push('same', ta[i]); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) push('remove', ta[i++]);
    else push('add', tb[j++]);
  }
  while (i < n) push('remove', ta[i++]);
  while (j < m) push('add', tb[j++]);
  return ops;
}

/** Blocks that hold current wording: tracked changes are reported separately. */
export const comparable = (blocks: ExtractionBlock[]) =>
  blocks.filter((b) => b.kind === 'paragraph' || b.kind === 'heading' || b.kind === 'table_cell');

export const hasTrackedChanges = (blocks: ExtractionBlock[]) =>
  blocks.some((b) => b.kind === 'tracked_insertion' || b.kind === 'tracked_deletion');

const MATCH_THRESHOLD = 0.5;

const side = (b: ExtractionBlock): ClauseSide => ({ blockId: b.id, clauseNumber: b.clauseNumber, text: b.text });

/**
 * Pairs each right-hand clause with the most similar left-hand clause.
 * Strongest matches are taken first; ties go to the closest position.
 */
export function alignBlocks(left: ExtractionBlock[], right: ExtractionBlock[]): CompareRow[] {
  const candidates: { i: number; j: number; sim: number }[] = [];
  left.forEach((l, i) => {
    const lt = stripNumber(l.text, l.clauseNumber);
    right.forEach((r, j) => {
      const sim = similarity(lt, stripNumber(r.text, r.clauseNumber));
      if (sim >= MATCH_THRESHOLD) candidates.push({ i, j, sim });
    });
  });
  const relPos = (i: number, j: number) => Math.abs(i / Math.max(left.length, 1) - j / Math.max(right.length, 1));
  candidates.sort((a, b) => b.sim - a.sim || relPos(a.i, a.j) - relPos(b.i, b.j));

  const leftFor = new Map<number, { i: number; sim: number }>();
  const usedLeft = new Set<number>();
  for (const c of candidates) {
    if (usedLeft.has(c.i) || leftFor.has(c.j)) continue;
    usedLeft.add(c.i);
    leftFor.set(c.j, { i: c.i, sim: c.sim });
  }

  const rows: CompareRow[] = [];
  const emitted = new Set<number>();
  const emitRemovedBefore = (limit: number) => {
    for (let i = 0; i < limit; i++) {
      if (!usedLeft.has(i) && !emitted.has(i)) {
        emitted.add(i);
        rows.push({ status: 'removed', renumbered: false, left: side(left[i]), right: null, similarity: null, diff: null });
      }
    }
  };

  right.forEach((r, j) => {
    const match = leftFor.get(j);
    if (!match) {
      rows.push({ status: 'added', renumbered: false, left: null, right: side(r), similarity: null, diff: null });
      return;
    }
    emitRemovedBefore(match.i);
    const l = left[match.i];
    const lt = stripNumber(l.text, l.clauseNumber);
    const rt = stripNumber(r.text, r.clauseNumber);
    const renumbered = (l.clauseNumber ?? '') !== (r.clauseNumber ?? '');
    const same = normalise(lt) === normalise(rt);
    const status: CompareRowStatus = same ? (renumbered ? 'renumbered' : 'unchanged') : 'changed';
    rows.push({ status, renumbered, left: side(l), right: side(r), similarity: Math.round(match.sim * 100) / 100, diff: same ? null : wordDiff(lt, rt) });
  });
  emitRemovedBefore(left.length);
  return rows;
}

export function summarise(rows: CompareRow[]): Record<CompareRowStatus, number> {
  const out: Record<CompareRowStatus, number> = { unchanged: 0, changed: 0, renumbered: 0, added: 0, removed: 0 };
  for (const r of rows) out[r.status]++;
  return out;
}
