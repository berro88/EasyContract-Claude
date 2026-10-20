// Sorts extracted blocks into topic cards with keyword rules. A block's own
// wording counts, and so does the heading of the clause it sits under
// ("3.2" sits under the "3 Fees" heading). Nothing here reads the text as
// instructions: it only matches words.

import { TOPICS, type BlockKind, type Topic } from '@easycontract/shared';

interface Rule {
  pattern: RegExp;
  weight: number;
  cue: string; // shown in the Legal view as the reason
}

const r = (pattern: RegExp, weight: number, cue: string): Rule => ({ pattern, weight, cue });

export const TOPIC_RULES: Record<Topic, Rule[]> = {
  parties: [
    r(/\b(is|are) (made|entered into) (by and )?between\b|\bagreement is between\b|\bbetween\b[^.]{0,80}\band\b[^.]{0,80}\(["“]/i, 2, 'names who the agreement is between'),
    r(/\bthe parties\b/i, 1, '"the parties"'),
    r(/\bregistration (number|no\.?)\b|\bregistered (office|address)\b|\bcompany number\b/i, 2, 'registration details'),
    r(/\b(hereinafter|referred to as)\b/i, 1, 'defines a party name'),
  ],
  term_renewal: [
    r(/\b(commence|commencement|start date|effective date)\b/i, 1, 'start date'),
    r(/\b(renew|renewal|renews|renewing|auto-?renew)/i, 2, 'renewal'),
    r(/\b(initial (term|period)|the term\b|duration|expire|expiry|expiration)\b/i, 2, 'term or expiry'),
    r(/\bruns? for\b|\bperiod of \S+ (months?|years?)\b/i, 1, 'how long it runs'),
  ],
  pricing_escalation: [
    r(/\b(fees?|price|prices|pricing|charges?|rates?|tariffs?)\b/i, 1, 'fees or price'),
    r(/\b(escalat\w*|increase[sd]?|adjust(ed|ment)?|indexation|CPI|inflation)\b/i, 2, 'price increases'),
    r(/\bper (month|annum|year|hour|day|unit)\b|\bmonthly fee\b|\bannual fee\b/i, 1, 'a rate per period'),
  ],
  payment: [
    r(/\binvoice[sd]?\b/i, 2, 'invoices'),
    r(/\b(payable|pay|paid|payment)\b/i, 1, 'payment'),
    r(/\b(due (within|on|by)|days of (the )?(date of )?invoice|electronic funds transfer|EFT|bank transfer|debit order)\b/i, 2, 'when or how to pay'),
    r(/\b(late payment|interest on (overdue|late)|overdue amounts?)\b/i, 2, 'late payment'),
  ],
  liability_caps: [
    r(/\bliabilit(y|ies)\b|\bliable\b/i, 1, 'liability'),
    r(/\b(limited to|shall not exceed|will not exceed|cap(ped)?|aggregate liability|maximum liability)\b/i, 2, 'a limit or cap'),
    r(/\b(consequential|indirect|special) (loss|losses|damages?)\b|\bloss of profits?\b/i, 2, 'excluded kinds of loss'),
  ],
  indemnities: [
    r(/\bindemnif\w*|\bindemnit(y|ies)\b/i, 3, 'indemnity'),
    r(/\bhold (\w+ )?harmless\b/i, 3, 'hold harmless'),
    r(/\bdefend\b[^.]{0,40}\bclaims?\b/i, 2, 'defending claims'),
  ],
  insurance: [
    r(/\binsur(ance|ed|e|er|ers)\b/i, 3, 'insurance'),
    r(/\b(cover|policy) of\b|\bminimum cover\b|\bpublic liability\b|\bprofessional indemnity\b/i, 1, 'insurance cover'),
  ],
  termination_notice: [
    r(/\bterminat\w*\b/i, 2, 'termination'),
    r(/\b(cancel\w*|end this agreement|bring this agreement to an end)\b/i, 2, 'ending the agreement'),
    r(/\b(written )?notice\b/i, 1, 'notice'),
  ],
  cure_periods: [
    r(/\b(remedy|remedied|cure|cured|rectify|rectified)\b/i, 2, 'remedying a breach'),
    r(/\bbreach(es|ed)?\b/i, 1, 'breach'),
    r(/\bfails? to (remedy|cure|rectify)\b|\bwithin \S+ (\(\d+\) )?(business |calendar )?days? (of|after) (receiving|receipt of|written notice)/i, 2, 'a time to fix a breach'),
  ],
  confidentiality: [
    r(/\bconfidential(ity)?\b/i, 3, 'confidentiality'),
    r(/\bnon-?disclosure\b|\bnot disclose\b|\bdisclos(e|ure) to (any )?third part/i, 2, 'not disclosing information'),
    r(/\btrade secrets?\b|\bproprietary information\b/i, 2, 'secret information'),
  ],
  intellectual_property: [
    r(/\bintellectual property\b|\bIP rights\b/i, 3, 'intellectual property'),
    r(/\b(copyright|trade ?marks?|patents?|designs? rights?)\b/i, 2, 'copyright, marks or patents'),
    r(/\blicen[cs]e[sd]?\b|\bownership of (the )?(work|deliverables|materials)\b/i, 1, 'licences or ownership'),
  ],
  disputes: [
    r(/\bdisputes?\b/i, 2, 'disputes'),
    r(/\b(arbitrat\w*|mediat\w*|adjudicat\w*|expert determination)\b/i, 2, 'arbitration or mediation'),
    r(/\b(refer(red)? to (senior|the) (management|executives?)|escalat\w* to)\b/i, 1, 'escalation to managers'),
  ],
  governing_law: [
    r(/\bgoverned by\b|\bgoverning law\b|\bconstrued in accordance with\b/i, 3, 'which law governs'),
    r(/\blaws? of (the )?(republic of )?[A-Z]\w+/, 1, '"laws of" a place'),
    r(/\b(jurisdiction|submit to the (exclusive|non-exclusive) )\b/i, 1, 'jurisdiction'),
  ],
  force_majeure: [
    r(/\bforce majeure\b|\bvis major\b/i, 3, 'force majeure'),
    r(/\bbeyond (its|their|the) (reasonable )?control\b|\bact(s)? of god\b/i, 2, 'events beyond control'),
    r(/\b(pandemic|epidemic|natural disaster|flood|fire|riot|war|strike|lockout)\b/i, 1, 'listed disaster events'),
  ],
  assignment: [
    r(/\bassign(ment|ed|s)?\b|\bcede\b|\bcession\b/i, 2, 'assignment or cession'),
    r(/\b(transfer|delegate) (any of )?(its|their|this) (rights|obligations|agreement)\b/i, 2, 'transferring rights'),
    r(/\bsub-?contract\w*\b|\bchange of control\b/i, 1, 'subcontracting or change of control'),
  ],
  service_levels: [
    r(/\bservice levels?\b|\bSLAs?\b/i, 3, 'service levels'),
    r(/\b(uptime|availability|response times?|resolution times?|KPIs?|key performance)\b/i, 2, 'performance targets'),
    r(/\bperformance (standards?|targets?|measures?)\b/i, 1, 'performance standards'),
  ],
  penalties: [
    r(/\bpenalt(y|ies)\b/i, 3, 'penalties'),
    r(/\bliquidated damages\b|\bservice credits?\b/i, 3, 'liquidated damages or service credits'),
    r(/\b(forfeit\w*|fines?)\b/i, 1, 'forfeits or fines'),
  ],
};

const THRESHOLD = 2;
const HEADING_BONUS = 2;

export interface SortableBlock {
  id: string;
  kind: BlockKind;
  clauseNumber: string | null;
  text: string;
}

export interface Classified {
  blockId: string;
  topics: Topic[]; // strongest first
  heading: string | null;
  reasons: Partial<Record<Topic, string[]>>;
}

export function scoreText(text: string): { scores: Map<Topic, number>; cues: Map<Topic, string[]> } {
  const scores = new Map<Topic, number>();
  const cues = new Map<Topic, string[]>();
  for (const topic of TOPICS) {
    for (const rule of TOPIC_RULES[topic]) {
      if (rule.pattern.test(text)) {
        scores.set(topic, (scores.get(topic) ?? 0) + rule.weight);
        cues.set(topic, [...(cues.get(topic) ?? []), rule.cue]);
      }
    }
  }
  return { scores, cues };
}

/** A short block with a top-level number and no full stop reads as a heading ("3 Fees"). */
export function looksLikeHeading(b: SortableBlock): boolean {
  if (b.kind === 'heading') return true;
  if (b.kind !== 'paragraph') return false;
  const words = b.text.split(/\s+/).filter(Boolean);
  const stripped = b.text.replace(/^\s*(?:clause\s+)?\d+(\.\d+)*[.)]?\s*/i, '');
  return words.length <= 6 && !/[.;:]$/.test(stripped.trim()) && !!stripped.trim() && (b.clauseNumber === null || !b.clauseNumber.includes('.'));
}

const topNumber = (n: string | null) => (n ? n.split(/[.(]/)[0] : null);

/**
 * Classifies every block. Headings set the context for the clauses under them
 * but are not topic cards themselves. Tracked deletions are left out: deleted
 * words are not the current wording.
 */
export function classifyBlocks(blocks: SortableBlock[]): Classified[] {
  const out: Classified[] = [];
  let heading: { text: string; top: string | null; topics: Map<Topic, number> } | null = null;

  for (const b of blocks) {
    if (looksLikeHeading(b)) {
      heading = { text: b.text, top: topNumber(b.clauseNumber), topics: scoreText(b.text).scores };
      continue;
    }
    if (b.kind === 'tracked_deletion') continue;

    // A heading only applies to clauses in the same numbered section (or to
    // unnumbered text that follows it).
    const top = topNumber(b.clauseNumber);
    const applies = heading && (heading.top === null || top === null || heading.top === top);
    const { scores, cues } = scoreText(b.text);
    const reasons: Partial<Record<Topic, string[]>> = {};
    for (const [t, c] of cues) reasons[t] = [...c];
    if (applies && heading) {
      for (const [t, s] of heading.topics) {
        if (s <= 0) continue;
        scores.set(t, (scores.get(t) ?? 0) + HEADING_BONUS);
        reasons[t] = [...(reasons[t] ?? []), `sits under the heading "${heading.text.slice(0, 60)}"`];
      }
    }
    const topics = [...scores.entries()]
      .filter(([, s]) => s >= THRESHOLD)
      .sort((a, b2) => b2[1] - a[1] || TOPICS.indexOf(a[0]) - TOPICS.indexOf(b2[0]))
      .map(([t]) => t);
    for (const t of Object.keys(reasons) as Topic[]) if (!topics.includes(t)) delete reasons[t];
    out.push({ blockId: b.id, topics, heading: applies && heading ? heading.text : null, reasons });
  }
  return out;
}
