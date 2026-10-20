// Matches a letter that has no clause numbers (for example a price increase
// letter) to the agreement and clause it is about. Uses party names,
// references, dates, topic, headings and wording. Explains every match, and
// every failure, in plain English.

import { TOPIC_LABELS, type ExtractionBlock, type Topic } from '@easycontract/shared';
import { comparable, similarity } from './align.ts';
import { classifyBlocks } from './topics.ts';
import { companyNames, definedTerms } from './parties.ts';

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE = String.raw`(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTHS})\s+\d{4}|(?:${MONTHS})\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{4}-\d{2}-\d{2})`;
const AGREEMENT_DATED = new RegExp(String.raw`\b(?:agreement|contract)\b[^.]{0,40}?\bdated\s+(${DATE})`, 'gi');
const REFERENCE = /\b(?:[A-Z]{2,}[-/]\d[\w/-]*|[A-Z]{2,}\d{2,}[\w/-]*)\b/g;
const GENERIC_TERMS = new Set(['Agreement', 'Services', 'Schedule', 'Effective Date', 'Start Date']);

export interface Candidate {
  documentId: string;
  title: string;
  blocks: ExtractionBlock[];
}

export interface LetterMatch {
  status: 'matched' | 'uncertain' | 'not_matched';
  agreement: { documentId: string; title: string } | null;
  clause: { blockId: string; clauseNumber: string | null; text: string } | null;
  reasons: string[];
  problems: string[];
}

const textOf = (blocks: ExtractionBlock[]) => comparable(blocks).map((b) => b.text).join('\n');
const lower = (s: string) => s.toLowerCase();
const normDate = (s: string) => s.replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, '').replace(/\s+/g, ' ').toLowerCase();

export function matchLetter(letter: ExtractionBlock[], candidates: Candidate[]): LetterMatch {
  const letterText = textOf(letter);
  const reasons: string[] = [];
  const problems: string[] = [];

  if (!candidates.length) {
    return { status: 'not_matched', agreement: null, clause: null, reasons, problems: ["There's no main agreement, signed copy or amendment in this project to match the letter against."] };
  }

  const letterCompanies = companyNames(letterText);
  const letterRefs = [...new Set(letterText.match(REFERENCE) ?? [])];
  const letterDates = [...letterText.matchAll(AGREEMENT_DATED)].map((m) => m[1]);

  const scored = candidates.map((c) => {
    const text = textOf(c.blocks);
    const why: string[] = [];
    const against: string[] = [];
    let score = 0;
    const parties = [...definedTerms(comparable(c.blocks).slice(0, 15).map((b) => b.text))];
    for (const name of companyNames(text)) {
      if (lower(letterText).includes(lower(name))) { score += 3; why.push(`The letter names ${name}, a party to "${c.title}".`); }
    }
    for (const term of parties) {
      if (GENERIC_TERMS.has(term) || term.length < 4 || companyNames(term).length) continue;
      if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(letterText)) { score += 0.5; }
    }
    for (const ref of letterRefs) {
      if (text.includes(ref)) { score += 4; why.push(`The letter quotes reference ${ref}, which appears in "${c.title}".`); }
    }
    for (const d of letterDates) {
      if (normDate(text).includes(normDate(d))) { score += 3; why.push(`The letter refers to an agreement dated ${d}, and "${c.title}" carries that date.`); }
      else against.push(`The letter refers to an agreement dated ${d}, but "${c.title}" doesn't mention that date.`);
    }
    return { c, score, why, against };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  if (best.score < 3) {
    for (const name of letterCompanies) {
      if (!candidates.some((c) => lower(textOf(c.blocks)).includes(lower(name)))) {
        problems.push(`The letter names ${name}, which isn't a party in any agreement in this project.`);
      }
    }
    for (const ref of letterRefs) {
      if (!candidates.some((c) => textOf(c.blocks).includes(ref))) problems.push(`The letter quotes reference ${ref}, which doesn't appear in any agreement in this project.`);
    }
    for (const s of scored) problems.push(...s.against);
    if (!problems.length) problems.push("The letter doesn't name a party, reference or date that links it to any agreement in this project.");
    return { status: 'not_matched', agreement: null, clause: null, reasons, problems: [...new Set(problems)] };
  }

  reasons.push(...best.why);
  problems.push(...best.against);
  let status: LetterMatch['status'] = 'matched';
  if (second && second.score === best.score) {
    status = 'uncertain';
    problems.push(`"${best.c.title}" and "${second.c.title}" match the letter equally well. Check which agreement it belongs to.`);
  }
  if (best.against.length) status = 'uncertain';

  // Which clause: same topic as the letter, then the closest wording and heading.
  const letterTopics = new Set<Topic>(classifyBlocks(comparable(letter)).flatMap((c) => c.topics));
  const agreementBlocks = comparable(best.c.blocks);
  const classified = classifyBlocks(agreementBlocks);
  let clause: LetterMatch['clause'] = null;
  if (!letterTopics.size) {
    status = 'uncertain';
    problems.push("We couldn't tell which kind of clause the letter is about, so no clause was matched.");
  } else {
    const options = classified
      .filter((c) => c.topics.some((t) => letterTopics.has(t)))
      .map((c) => {
        const b = agreementBlocks.find((x) => x.id === c.blockId)!;
        const headingBonus = c.heading && similarity(c.heading, letterText) > 0 ? 0.1 : 0;
        const topicOverlap = c.topics.filter((t) => letterTopics.has(t)).length * 0.05;
        return { b, c, score: similarity(b.text, letterText) + headingBonus + topicOverlap };
      })
      .sort((a, b) => b.score - a.score);
    const topicNames = [...letterTopics].map((t) => TOPIC_LABELS[t].toLowerCase()).join(', ');
    if (!options.length) {
      status = 'uncertain';
      problems.push(`The letter is about ${topicNames}, but "${best.c.title}" has no clause on that topic.`);
    } else {
      const pick = options[0];
      clause = { blockId: pick.b.id, clauseNumber: pick.b.clauseNumber, text: pick.b.text };
      const where = pick.b.clauseNumber ? `clause ${pick.b.clauseNumber}` : 'the clause';
      reasons.push(`The letter is about ${topicNames}; ${where}${pick.c.heading ? ` (under "${pick.c.heading}")` : ''} is the closest ${topicNames} clause in wording.`);
      if (options[1] && Math.abs(options[1].score - pick.score) < 0.02) {
        status = 'uncertain';
        const other = options[1].b.clauseNumber ? `clause ${options[1].b.clauseNumber}` : 'another clause';
        problems.push(`${where[0].toUpperCase()}${where.slice(1)} and ${other} fit equally well. Check which one the letter changes.`);
      }
    }
  }
  return { status, agreement: { documentId: best.c.documentId, title: best.c.title }, clause, reasons, problems };
}
