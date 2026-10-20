// Reads change instructions out of an amendment ("Clause 5.1 is deleted and
// replaced with…"), checks which ones the latest base agreement already
// reflects, and works out the effective position by applying the rest.
// New wording is always quoted from the amendment, never composed.

import type {
  AmendmentInstruction, EffectiveClause, ExtractionBlock, InstructionResult, InstructionState,
} from '@easycontract/shared';
import { comparable, normalise, similarity, stripNumber } from './align.ts';

const CLAUSE_REF = String.raw`(?:clause|section|paragraph)\s+(\d+(?:\.\d+)*(?:\([a-z0-9]+\))?)`;
const QUOTED = /["“]([^"”]+)["”]|‘([^’]+)’/g;

const RE = {
  insert: new RegExp(String.raw`\b(?:(?:a\s+)?new|the\s+following)\s+${CLAUSE_REF}\s+(?:is|shall\s+be)\s+(?:hereby\s+)?(?:inserted|added)|\binsert(?:ing)?\s+(?:a\s+)?new\s+${CLAUSE_REF}`, 'i'),
  replaceWhole: new RegExp(String.raw`${CLAUSE_REF}\s+(?:is|shall\s+be)\s+(?:hereby\s+)?(?:deleted\s+(?:in\s+its\s+entirety\s+)?and\s+)?(?:replaced|substituted)\s+(?:with|by)\b`, 'i'),
  replaceWords: /\b(replac\w*|substitut\w*|delet\w*\s+the\s+words?)\b/i,
  delete: new RegExp(String.raw`${CLAUSE_REF}\s+(?:is|shall\s+be)\s+(?:hereby\s+)?deleted(?:\s+in\s+its\s+entirety)?\s*[.;]?\s*$`, 'i'),
  mention: new RegExp(String.raw`${CLAUSE_REF}[^.]*\b(amend\w*|replac\w*|delet\w*|insert\w*|substitut\w*|add\w*)\b|\b(amend\w*|replac\w*|delet\w*|insert\w*|substitut\w*)\b[^.]*${CLAUSE_REF}`, 'i'),
};

const quotes = (text: string) => [...text.matchAll(QUOTED)].map((m) => (m[1] ?? m[2]).trim());
const firstRef = (m: RegExpExecArray | null) => (m ? m.slice(1).find(Boolean) ?? null : null);

/** A block that is new wording for the instruction before it (quoted, or numbered as the target clause). */
function continuation(b: ExtractionBlock | undefined, clauseNumber: string): string | null {
  if (!b || b.kind === 'heading' || RE.mention.test(b.text)) return null;
  const q = quotes(b.text);
  if (q.length === 1 && normalise(q[0]).length >= normalise(b.text).length - 4) return q[0];
  const stripped = stripNumber(b.text, clauseNumber);
  if (b.clauseNumber === clauseNumber || stripped !== b.text) return stripped.trim();
  return null;
}

export function parseInstructions(blocks: ExtractionBlock[]): AmendmentInstruction[] {
  const out: AmendmentInstruction[] = [];
  const list = comparable(blocks);
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    const text = b.text;
    const q = quotes(text);
    const base = { index: out.length + 1, sourceBlockIds: [b.id], sourceText: text, from: null as string | null, to: null as string | null };

    const withNewText = (clauseNumber: string) => {
      // New wording either quoted in this block (after the colon) or in the next block.
      const afterColon = text.includes(':') ? text.slice(text.indexOf(':') + 1).trim() : '';
      const inline = q.length ? q[q.length - 1] : afterColon.length > 3 ? stripNumber(afterColon, clauseNumber) : null;
      if (inline) return { to: inline, ids: [b.id] };
      const next = continuation(list[k + 1], clauseNumber);
      if (next) { k++; return { to: next, ids: [b.id, list[k].id] }; }
      return null;
    };

    let m: RegExpExecArray | null;
    if ((m = RE.insert.exec(text))) {
      const n = firstRef(m)!;
      const nt = withNewText(n);
      out.push(nt ? { ...base, kind: 'insert_clause', clauseNumber: n, to: nt.to, sourceBlockIds: nt.ids } : { ...base, kind: 'unrecognised', clauseNumber: n });
    } else if ((m = RE.replaceWhole.exec(text)) && !(q.length >= 2)) {
      const n = firstRef(m)!;
      const nt = withNewText(n);
      out.push(nt ? { ...base, kind: 'replace_clause', clauseNumber: n, to: nt.to, sourceBlockIds: nt.ids } : { ...base, kind: 'unrecognised', clauseNumber: n });
    } else if ((m = new RegExp(CLAUSE_REF, 'i').exec(text)) && q.length >= 2 && RE.replaceWords.test(text)) {
      out.push({ ...base, kind: 'replace_words', clauseNumber: firstRef(m), from: q[0], to: q[1] });
    } else if ((m = RE.delete.exec(text))) {
      out.push({ ...base, kind: 'delete_clause', clauseNumber: firstRef(m) });
    } else if ((m = RE.mention.exec(text))) {
      out.push({ ...base, kind: 'unrecognised', clauseNumber: firstRef(m) });
    }
  }
  return out;
}

// ---------- Applying ----------

interface WorkingClause extends EffectiveClause {}

const numberParts = (n: string) => n.split(/[.()]/).filter(Boolean).map((p) => (/^\d+$/.test(p) ? Number(p) : p.charCodeAt(0) - 96));
function compareNumbers(a: string, b: string) {
  const pa = numberParts(a);
  const pb = numberParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

export function baseClauses(blocks: ExtractionBlock[]): WorkingClause[] {
  return comparable(blocks).map((b) => ({
    clauseNumber: b.clauseNumber,
    text: stripNumber(b.text, b.clauseNumber),
    baseBlockId: b.id,
    changedBy: [],
    deleted: false,
  }));
}

const find = (clauses: WorkingClause[], n: string | null) => (n ? clauses.find((c) => c.clauseNumber === n && !c.deleted) : undefined);
const SAME = 0.95;

/** Whole-phrase containment: "R1" is not in "R12,000". */
export function containsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
}
const matches = (a: string, b: string) => normalise(a) === normalise(b) || similarity(a, b) >= SAME;

/**
 * Whether the latest base wording already reflects an instruction.
 * `earlierNumbers` are clause numbers from earlier versions of the base, so a
 * deletion counts as incorporated only if the clause used to exist.
 */
function isIncorporated(ins: AmendmentInstruction, latest: WorkingClause[], earlierNumbers: Set<string>): boolean {
  const target = find(latest, ins.clauseNumber);
  switch (ins.kind) {
    case 'replace_clause':
    case 'insert_clause':
      return !!ins.to && (target ? matches(target.text, ins.to) : latest.some((c) => matches(c.text, ins.to!)));
    case 'replace_words':
      return !!target && !!ins.to && !!ins.from && containsPhrase(target.text, ins.to) && !containsPhrase(target.text, ins.from);
    case 'delete_clause':
      return !target && !!ins.clauseNumber && earlierNumbers.has(ins.clauseNumber);
    default:
      return false;
  }
}

export interface AmendmentInput {
  documentId: string;
  title: string;
  authoritative: boolean;
  statusLabel: string;
  blocks: ExtractionBlock[];
}

/**
 * Applies agreed amendments, oldest first, on top of the latest base version.
 * Instructions the base already reflects are marked incorporated and not
 * applied again. Amendments that aren't agreed are reported, never applied.
 */
export function effectivePosition(latestBase: ExtractionBlock[], earlierBaseNumbers: Set<string>, amendments: AmendmentInput[]) {
  const latest = baseClauses(latestBase);
  const clauses: WorkingClause[] = latest.map((c) => ({ ...c, changedBy: [] }));
  const results = amendments.map((a) => {
    const instructions = parseInstructions(a.blocks).map((ins): InstructionResult => {
      const done = (state: InstructionState, explanation: string): InstructionResult => ({ ...ins, state, explanation });
      const ref = ins.clauseNumber ? `clause ${ins.clauseNumber}` : 'a clause';

      if (ins.kind === 'unrecognised') return done('cannot_apply', `We couldn't read this instruction reliably, so it was not applied. Check ${ref} by hand.`);
      if (isIncorporated(ins, latest, earlierBaseNumbers)) return done('incorporated', `The base agreement already reflects this change to ${ref}.`);
      if (!a.authoritative) return done('pending', `Not applied: this amendment's status is "${a.statusLabel}", so it isn't part of the agreed position.`);

      const target = find(clauses, ins.clauseNumber);
      const mark = (c: WorkingClause) => c.changedBy.push({ documentId: a.documentId, title: a.title, instructionIndex: ins.index, sourceBlockIds: ins.sourceBlockIds });
      switch (ins.kind) {
        case 'replace_clause':
          if (!target) return done('cannot_apply', `The base agreement has no ${ref}, so this replacement can't be placed.`);
          target.text = ins.to!;
          mark(target);
          return done('applied', `${ref[0].toUpperCase()}${ref.slice(1)} replaced with the amendment's wording.`);
        case 'replace_words':
          if (!target) return done('cannot_apply', `The base agreement has no ${ref}.`);
          if (!containsPhrase(target.text, ins.from!)) return done('cannot_apply', `The words "${ins.from}" aren't in ${ref} of the base agreement, so this change can't be placed.`);
          target.text = target.text.split(ins.from!).join(ins.to!);
          mark(target);
          return done('applied', `In ${ref}, "${ins.from}" replaced with "${ins.to}".`);
        case 'delete_clause':
          if (!target) return done('cannot_apply', `The base agreement has no ${ref} to delete.`);
          target.deleted = true;
          mark(target);
          return done('applied', `${ref[0].toUpperCase()}${ref.slice(1)} deleted.`);
        case 'insert_clause': {
          if (target) return done('cannot_apply', `The base agreement already has a ${ref} with different wording, so the new one can't be inserted without a clash.`);
          const inserted: WorkingClause = { clauseNumber: ins.clauseNumber, text: ins.to!, baseBlockId: null, changedBy: [], deleted: false };
          mark(inserted);
          const at = clauses.findIndex((c) => c.clauseNumber && ins.clauseNumber && compareNumbers(c.clauseNumber, ins.clauseNumber) > 0);
          clauses.splice(at < 0 ? clauses.length : at, 0, inserted);
          return done('applied', `New ${ref} inserted.`);
        }
      }
    });
    const incorporated = instructions.filter((i) => i.state === 'incorporated').length;
    const incorporation = !instructions.length ? 'nothing_to_incorporate' as const
      : incorporated === instructions.length ? 'incorporated' as const
      : incorporated > 0 ? 'partly_incorporated' as const
      : 'not_incorporated' as const;
    return { amendment: a, instructions, incorporated, incorporation };
  });
  return { clauses, results };
}
