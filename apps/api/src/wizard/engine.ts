import type { CompanyProfile, ContractType, DraftSection, ExtractionBlock } from '@easycontract/shared';
import type { PlaybookPosition } from '../interfaces/index.ts';
import type { LibraryClause } from '@easycontract/shared';
import { type Answers, TYPES, visibleQuestions } from './templates.ts';

/** New answers, pre-filled from the company profile. */
export function prefill(type: ContractType, profile: CompanyProfile): Answers {
  const a: Answers = {};
  for (const q of TYPES[type].questions) {
    if (!q.prefill) continue;
    // The registered legal name falls back to the trading name.
    const value = q.prefill === 'legalName' ? profile.legalName || profile.name : profile[q.prefill];
    if (value) a[q.id] = value;
  }
  return a;
}

/** Keeps only known questions, as trimmed text of a sensible length. */
export function cleanAnswers(type: ContractType, raw: unknown): Answers {
  const out: Answers = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const q of TYPES[type].questions) {
    const v = (raw as Record<string, unknown>)[q.id];
    if (typeof v !== 'string') continue;
    const t = v.slice(0, q.kind === 'textarea' ? 4000 : 500);
    if (q.options && t && !q.options.some((o) => o.value === t)) continue;
    if (t.trim()) out[q.id] = t;
  }
  return out;
}

export function missingEssentials(type: ContractType, a: Answers) {
  return visibleQuestions(type, a).filter((q) => q.essential && !a[q.id]?.trim()).map((q) => ({ questionId: q.id, label: q.label }));
}

export interface Sources {
  playbook: { name: string; version: number; positions: PlaybookPosition[] } | null;
  library: (topic: NonNullable<DraftSection['topic']>) => LibraryClause | null;
}

/**
 * Builds the clauses. For each topic the company's own wording wins: the
 * active playbook's preferred wording first, then the clause library, then
 * the built-in template.
 */
export function assemble(type: ContractType, a: Answers, sources: Sources): DraftSection[] {
  return TYPES[type].build(a).map((s, i) => {
    let text = s.text;
    let source: DraftSection['source'] = { kind: 'template', label: 'Template wording: a general starting point to adapt and have reviewed' };
    let explanation = s.explanation;
    const pos = s.topic ? sources.playbook?.positions.find((p) => p.topic === s.topic && p.preferredText) : undefined;
    const lib = s.topic && !pos ? sources.library(s.topic) : null;
    if (pos && sources.playbook) {
      text = pos.preferredText!;
      source = { kind: 'playbook', label: `Preferred wording from your playbook (${sources.playbook.name}, version ${sources.playbook.version})` };
      explanation = `${s.explanation} Your playbook's wording is used here instead of the template, so check it still fits your answers.`;
    } else if (lib && !lib.isExample) {
      text = lib.latest.text;
      source = { kind: 'library', label: `From your clause library: ${lib.title} (version ${lib.latest.version})` };
      explanation = `${s.explanation} Your library wording is used here instead of the template, so check it still fits your answers.`;
    }
    return { id: `s${i + 1}`, number: String(i + 1), topic: s.topic, heading: s.heading, text, explanation, source, protective: s.protective ?? null, loophole: s.loophole ?? null };
  });
}

/** Presents the draft to the review checks as if it were an uploaded document. */
export function toBlocks(sections: DraftSection[], versionId: string): ExtractionBlock[] {
  return sections.flatMap((s, i) => [
    { id: `${s.id}-h`, versionId, seq: i * 2, kind: 'heading' as const, clauseNumber: s.number, text: s.heading, anchor: { format: 'docx' as const, part: 'draft', paragraphId: `${s.id}-h`, paragraphIdSource: 'position' as const }, flags: [] },
    { id: s.id, versionId, seq: i * 2 + 1, kind: 'paragraph' as const, clauseNumber: s.number, text: s.text, anchor: { format: 'docx' as const, part: 'draft', paragraphId: s.id, paragraphIdSource: 'position' as const }, flags: [] },
  ]);
}
