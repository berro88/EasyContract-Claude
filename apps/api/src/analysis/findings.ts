// Rule-based risk findings. Every finding points at the passages it is based
// on and quotes them; none of them calculates an amount the document doesn't
// state. When a figure can't be worked out, the finding says so.

import { createHash } from 'node:crypto';
import {
  FINDING_RULES, FINDING_RULE_LABELS, TOPIC_LABELS, type DocumentRole, type ExtractionBlock, type Finding, type FindingPassage,
  type FindingRule, type FindingsResponse, type Severity, type Topic,
} from '@easycontract/shared';
import { comparable, stripNumber } from './align.ts';
import { classifyBlocks, looksLikeHeading } from './topics.ts';

export interface FindingsInput {
  versionId: string;
  role: DocumentRole;
  title: string;
  blocks: ExtractionBlock[];
  /** Other readable documents in the same project. */
  projectDocuments: { title: string; role: DocumentRole }[];
}

interface Ctx {
  blocks: ExtractionBlock[]; // current wording only, headings excluded
  all: ExtractionBlock[]; // including headings
  topics: Map<string, Topic[]>;
  input: FindingsInput;
}

const EXCERPT = 200;
const excerpt = (b: ExtractionBlock) => {
  const t = stripNumber(b.text, b.clauseNumber).replace(/\s+/g, ' ');
  return t.length > EXCERPT ? `${t.slice(0, EXCERPT).trimEnd()}…` : t;
};
const ref = (b: ExtractionBlock) => (b.clauseNumber ? `clause ${b.clauseNumber}` : `the passage "${excerpt(b).slice(0, 50)}…"`);
const Ref = (b: ExtractionBlock) => { const r = ref(b); return r[0].toUpperCase() + r.slice(1); };
const passage = (b: ExtractionBlock, role: FindingPassage['role'] = 'primary'): FindingPassage => ({ blockId: b.id, clauseNumber: b.clauseNumber, excerpt: excerpt(b), role });

function finding(rule: FindingRule, severity: Severity, f: Omit<Finding, 'id' | 'key' | 'wordingHash' | 'rule' | 'severity'>): Finding {
  const key = `${rule}|${severity}|${f.passages.filter((p) => p.role === 'primary').map((p) => p.blockId).sort().join(',')}|${f.title}`;
  // key and wordingHash are filled in by runFindings, which has the full passage text.
  return { id: 'fnd_' + createHash('sha256').update(key).digest('hex').slice(0, 20), key: '', wordingHash: '', rule, severity, ...f };
}

const inTopic = (ctx: Ctx, t: Topic) => ctx.blocks.filter((b) => ctx.topics.get(b.id)?.includes(t));

// ---------- Periods ----------

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fourteen: 14, fifteen: 15,
  twenty: 20, thirty: 30, sixty: 60, ninety: 90,
};
const PERIOD = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|fifteen|twenty|thirty|sixty|ninety)(?:\s*\(\d+\))?\s+((?:business|calendar|working|clear)\s+)?(days?|weeks?|months?)\b/gi;

interface Period { n: number; unit: string; quote: string }

function periods(text: string): Period[] {
  return [...text.matchAll(PERIOD)].map((m) => ({
    n: /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()],
    unit: `${(m[2] ?? '').trim().toLowerCase() || 'calendar'} ${m[3].toLowerCase().replace(/s$/, '')}`,
    quote: m[0],
  }));
}

// ---------- Rule 1: liability cap bypassed by an indemnity ----------

const CAP = /\b(limited to|shall not exceed|will not exceed|not exceed|cap(ped)?|aggregate liability|maximum liability)\b/i;
const NUMBERED_REF = /\b(?:clause|section)\s+(\d+(?:\.\d+)*)/gi;
const CURRENCY_AMOUNT = /(?:\b(?:ZAR|USD|EUR|GBP|R)\s?|[$€£]\s?)\d/;

function liabilityRule(ctx: Ctx): Finding[] {
  const caps = inTopic(ctx, 'liability_caps').filter((b) => CAP.test(b.text));
  const indemnities = inTopic(ctx, 'indemnities');
  const out: Finding[] = [];

  const capNote = (cap: ExtractionBlock) =>
    CURRENCY_AMOUNT.test(cap.text) ? null
      : `The cap in ${ref(cap)} is not a stated amount. It depends on figures (such as fees paid) that aren't in the document, so the cap amount can't be worked out here.`;

  // A cap that carves out indemnities, wherever the indemnity sits.
  for (const cap of caps) {
    if (/\b(except|save for|other than|excluding|does not apply to|shall not apply to)\b[^.]{0,80}\bindemnit/i.test(cap.text)) {
      out.push(finding('liability_cap_bypass', 'red', {
        title: 'The liability cap does not cover indemnities',
        plain: `${Ref(cap)} limits liability, but says it doesn't apply to indemnities. Money owed under an indemnity could be unlimited.`,
        legal: `${Ref(cap)} carves indemnities out of the limitation of liability, so indemnified losses are uncapped as drafted.`,
        cannotWorkOut: capNote(cap),
        passages: [passage(cap), ...indemnities.map((i) => passage(i, 'related'))],
      }));
      return out;
    }
  }

  for (const ind of indemnities) {
    const capNumbers = new Set(caps.map((c) => c.clauseNumber).filter(Boolean));
    const refs = [...ind.text.matchAll(NUMBERED_REF)].map((m) => m[1]);
    const notwithstanding = /\bnotwithstanding\b/i.test(ind.text) && (refs.some((r) => capNumbers.has(r)) || /\b(limitation|cap|liability)\b/i.test(ind.text) || /anything (else )?(in|to the contrary)/i.test(ind.text));
    const unlimited = /\b(unlimited|uncapped|without (any )?limit(ation)?)\b/i.test(ind.text);
    const subjectToCap = /\bsubject to\b/i.test(ind.text) && (refs.some((r) => capNumbers.has(r)) || /\b(limitation|cap)\b/i.test(ind.text));

    if (notwithstanding || unlimited) {
      out.push(finding('liability_cap_bypass', 'red', {
        title: 'An indemnity gets around the liability cap',
        plain: `${Ref(ind)} is an indemnity that applies regardless of the liability limit${caps.length ? ` in ${caps.map(ref).join(' and ')}` : ''}. The amount owed under it could be unlimited.`,
        legal: notwithstanding
          ? `${Ref(ind)} is expressed to apply notwithstanding ${caps.length ? caps.map(ref).join(' and ') : 'any limitation'}, so the cap does not bound liability under the indemnity.`
          : `${Ref(ind)} is expressed to be unlimited, so ${caps.length ? `the cap in ${caps.map(ref).join(' and ')} does not bound liability under it` : 'no limit applies to it'}.`,
        cannotWorkOut: 'The maximum amount payable under this indemnity is not stated, so it cannot be worked out from the document.',
        passages: [passage(ind), ...caps.map((c) => passage(c, 'related'))],
      }));
    } else if (subjectToCap && caps.length) {
      out.push(finding('liability_cap_bypass', 'green', {
        title: 'The indemnity is subject to the liability cap',
        plain: `${Ref(ind)} says it is subject to the liability limit.`,
        legal: `${Ref(ind)} is expressly subject to the limitation of liability.`,
        cannotWorkOut: capNote(caps[0]),
        passages: [passage(ind), ...caps.map((c) => passage(c, 'related'))],
      }));
    } else if (caps.length) {
      out.push(finding('liability_cap_bypass', 'amber', {
        title: "Unclear whether the cap covers the indemnity",
        plain: `${Ref(ind)} is an indemnity, and ${caps.map(ref).join(' and ')} limits liability, but neither says whether the limit applies to the indemnity.`,
        legal: `The relationship between the indemnity in ${ref(ind)} and the limitation in ${caps.map(ref).join(' and ')} is not stated; the indemnity may be construed as falling outside the cap.`,
        cannotWorkOut: capNote(caps[0]),
        passages: [passage(ind), ...caps.map((c) => passage(c, 'related'))],
      }));
    } else {
      out.push(finding('liability_cap_bypass', 'amber', {
        title: 'Indemnity with no liability cap',
        plain: `${Ref(ind)} is an indemnity, and the document has no clause limiting liability. The amount owed under it isn't limited.`,
        legal: `${Ref(ind)} contains an indemnity and no limitation of liability was found in the document.`,
        cannotWorkOut: 'No limit is stated, so the maximum exposure cannot be worked out from the document.',
        passages: [passage(ind)],
      }));
    }
  }
  return out;
}

// ---------- Rule 2: escalation that can't be worked out ----------

const ESCALATION = /\b(escalat\w*|increase[sd]?|adjust(?:ed|ment)?|indexation|index(?:ed)?|CPI|CPIX|PPI|inflation)\b/i;
const PLACEHOLDER = /\[[^\]\n]{1,60}\]|_{3,}|\.{5,}|<[^>\n]{1,40}>|\b(TBC|TBA|TBD)\b|\bto be (agreed|confirmed|determined|advised)\b/gi;
const INDEX = /\b(CPI|CPIX|PPI|consumer price index|producer price index|inflation|index)\b/i;
const PERCENT = /\d+(?:[.,]\d+)?\s?(?:%|per ?cent)/i;

function escalationRule(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  const candidates = ctx.blocks.filter((b) => ESCALATION.test(b.text) && (ctx.topics.get(b.id)?.includes('pricing_escalation') || /\b(fees?|price|charges?|rates?)\b/i.test(b.text)));
  for (const b of candidates) {
    const blanks = [...b.text.matchAll(PLACEHOLDER)].map((m) => m[0]);
    if (blanks.length) {
      out.push(finding('escalation_unworkable', 'red', {
        title: 'Price increase has a blank',
        plain: `${Ref(b)} sets how the price goes up, but part of it is still blank (${blanks.map((x) => `"${x}"`).join(', ')}).`,
        legal: `The escalation mechanism in ${ref(b)} is incomplete: it contains unfilled placeholder(s) ${blanks.map((x) => `"${x}"`).join(', ')}.`,
        cannotWorkOut: `The increased price cannot be worked out because the ${blanks.length > 1 ? 'values are' : 'value is'} left blank in ${ref(b)}.`,
        passages: [passage(b)],
      }));
    } else if (INDEX.test(b.text) && !PERCENT.test(b.text)) {
      const index = b.text.match(INDEX)![0];
      out.push(finding('escalation_unworkable', 'amber', {
        title: 'Price increase depends on an outside index',
        plain: `${Ref(b)} links price increases to "${index}", which isn't part of the document. Check which index, which date it is measured on, and whether there is a maximum.`,
        legal: `${Ref(b)} indexes the price to "${index}". The index series, base date and any cap or floor should be confirmed; the resulting price is not determinable from the document.`,
        cannotWorkOut: `Future prices depend on "${index}" figures that aren't in the document, so they cannot be worked out here.`,
        passages: [passage(b)],
      }));
    }
  }
  return out;
}

// ---------- Rule 3: overlapping fuel and annual escalation ----------

const FUEL = /\b(fuel|diesel|petrol|energy|electricity)\b[^.]{0,60}\b(surcharge|adjust\w*|escalat\w*|increase\w*|levy|recover\w*|pass(?:ed)? (?:on|through))\b|\b(surcharge|adjust\w*|escalat\w*|increase\w*|levy)\b[^.]{0,60}\b(fuel|diesel|petrol)\b/i;
const ANNUAL = /\b(annual(ly)?|each year|every year|per annum|anniversary|yearly|CPI|CPIX|inflation)\b/i;
const EXCLUDES_FUEL = /\b(excluding|exclusive of|other than|except(?: for)?|does not apply to|not including)\b[^.]{0,40}\b(fuel|diesel|petrol)\b/i;

function overlappingEscalationRule(ctx: Ctx): Finding[] {
  // A clause that *excludes* fuel isn't a fuel adjustment.
  const isFuel = (b: ExtractionBlock) => FUEL.test(b.text) && !EXCLUDES_FUEL.test(b.text);
  const fuel = ctx.blocks.filter(isFuel);
  const annual = ctx.blocks.filter((b) => ESCALATION.test(b.text) && ANNUAL.test(b.text) && !isFuel(b));
  if (!fuel.length || !annual.length) return [];
  if (annual.every((b) => EXCLUDES_FUEL.test(b.text))) {
    return [finding('overlapping_escalation', 'green', {
      title: 'Fuel and annual increases are kept apart',
      plain: `${annual.map(Ref).join(' and ')} increases the price each year but excludes fuel, which ${fuel.map(ref).join(' and ')} adjusts separately.`,
      legal: `The general escalation in ${annual.map(ref).join(' and ')} expressly excludes fuel, avoiding double recovery with ${fuel.map(ref).join(' and ')}.`,
      cannotWorkOut: null,
      passages: [...annual.map((b) => passage(b)), ...fuel.map((b) => passage(b, 'related'))],
    })];
  }
  return [finding('overlapping_escalation', 'amber', {
    title: 'Fuel costs may be increased twice',
    plain: `${fuel.map(Ref).join(' and ')} adjusts the price for fuel, and ${annual.map(ref).join(' and ')} increases the price each year. Nothing says the yearly increase leaves fuel out, so fuel costs could go up under both.`,
    legal: `A fuel adjustment (${fuel.map(ref).join(', ')}) and a general annual escalation (${annual.map(ref).join(', ')}) both apply, with no express exclusion of the fuel component from the general escalation: risk of double recovery.`,
    cannotWorkOut: 'The combined effect of both increases cannot be worked out from the document.',
    passages: [...fuel.map((b) => passage(b)), ...annual.map((b) => passage(b))],
  })];
}

// ---------- Rule 4: termination and cure periods ----------

const CURE = /\b(remedy|remedied|cure|cured|rectify|rectified|make good)\b/i;
const BREACH = /\b(breach\w*|default\w*|fails? to perform)\b/i;
const IMMEDIATE = /\b(immediately|with immediate effect|forthwith|without notice)\b/i;

function terminationCureRule(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  const cureBlocks = ctx.blocks
    .filter((b) => CURE.test(b.text) && BREACH.test(b.text))
    .map((b) => ({ b, periods: periods(b.text) }))
    .filter((x) => x.periods.length);
  const termBlocks = ctx.blocks.filter((b) => /\bterminat\w*|\bcancel\w*/i.test(b.text) && BREACH.test(b.text));

  for (const t of termBlocks) {
    const ownCure = CURE.test(t.text) && periods(t.text).length > 0;
    const others = cureBlocks.filter((c) => c.b.id !== t.id);
    if (!others.length || ownCure) continue;
    const cure = others[0];
    if (IMMEDIATE.test(t.text) && !/\bfails? to (remedy|cure|rectify)\b/i.test(t.text)) {
      out.push(finding('termination_cure_conflict', 'red', {
        title: 'Immediate termination clashes with the time to fix a breach',
        plain: `${Ref(t)} lets a party end the agreement immediately for a breach, but ${ref(cure.b)} gives ${cure.periods[0].quote} to fix a breach first. It's unclear which one wins.`,
        legal: `${Ref(t)} permits immediate termination for breach without reference to the cure period of ${cure.periods[0].quote} in ${ref(cure.b)}; the provisions conflict and the order of precedence is not stated.`,
        cannotWorkOut: null,
        passages: [passage(t), passage(cure.b)],
      }));
      continue;
    }
    const notice = periods(t.text)[0];
    const longer = notice && cure.periods.find((p) => p.unit === notice.unit && p.n > notice.n);
    if (notice && longer) {
      out.push(finding('termination_cure_conflict', 'red', {
        title: 'Termination notice is shorter than the time to fix a breach',
        plain: `${Ref(t)} allows ending the agreement for a breach on ${notice.quote}' notice, but ${ref(cure.b)} gives ${longer.quote} to fix the breach. The agreement could end before the time to fix it runs out.`,
        legal: `The termination notice period for breach in ${ref(t)} (${notice.quote}) is shorter than the cure period in ${ref(cure.b)} (${longer.quote}); the cure right may be defeated.`,
        cannotWorkOut: null,
        passages: [passage(t), passage(cure.b)],
      }));
    }
  }

  // Different cure periods in different clauses.
  const distinct = new Map<string, { b: ExtractionBlock; p: Period }>();
  for (const c of cureBlocks) for (const p of c.periods) if (!distinct.has(`${p.n} ${p.unit}`)) distinct.set(`${p.n} ${p.unit}`, { b: c.b, p });
  const list = [...distinct.values()];
  if (list.length > 1 && new Set(list.map((x) => x.b.id)).size > 1) {
    out.push(finding('termination_cure_conflict', 'amber', {
      title: 'Different times to fix a breach',
      plain: `The document gives different periods to fix a breach: ${list.map((x) => `${x.p.quote} in ${ref(x.b)}`).join(', ')}. Check which applies when.`,
      legal: `Inconsistent cure periods: ${list.map((x) => `${x.p.quote} (${ref(x.b)})`).join('; ')}. Their respective scope should be reconciled.`,
      cannotWorkOut: null,
      passages: [...new Map(list.map((x) => [x.b.id, passage(x.b)])).values()],
    }));
  }
  return out;
}

// ---------- Rule 5: referenced documents not provided ----------

const SCHEDULE_REF = /\b(Schedule|Annexure|Annex|Appendix|Exhibit|Attachment)\s+([A-Z]|\d{1,2})\b/g;
const OTHER_AGREEMENT = /\b(?:the\s+)?(Principal|Master|Main|Head|Framework|Original|Underlying|Parent|Prime)\s+(Agreement|Contract)\b/g;

function referenceRule(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  // File titles often use dashes or underscores: "principal-agreement".
  const norm = (t: string) => t.toLowerCase().replace(/[-_.]+/g, ' ');
  const otherTitles = ctx.input.projectDocuments.map((d) => norm(d.title));
  const ownTitle = norm(ctx.input.title);
  const headingTexts = ctx.all.filter((b) => looksLikeHeading(b) || /^(schedule|annexure|annex|appendix|exhibit|attachment)\s+\S+\s*[:.\-–]?\s*\S*/i.test(b.text.trim()) && b.text.trim().split(/\s+/).length <= 8)
    .map((b) => b.text.trim().toLowerCase());

  const refs = new Map<string, ExtractionBlock[]>();
  for (const b of ctx.blocks) {
    for (const m of b.text.matchAll(SCHEDULE_REF)) {
      const name = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`;
      // A short line that *is* the schedule heading isn't a reference to it.
      if (b.text.trim().toLowerCase().startsWith(name.toLowerCase()) && b.text.trim().split(/\s+/).length <= 8) continue;
      refs.set(name, [...(refs.get(name) ?? []), b]);
    }
    for (const m of b.text.matchAll(OTHER_AGREEMENT)) {
      const name = `${m[1]} ${m[2]}`;
      refs.set(name, [...(refs.get(name) ?? []), b]);
    }
  }

  for (const [name, blocks] of refs) {
    const lower = name.toLowerCase();
    const isAgreement = /agreement|contract/i.test(name);
    const inDocument = headingTexts.some((h) => h.startsWith(lower));
    const inProject = otherTitles.some((t) => t.includes(lower) || (isAgreement && t.includes(lower.split(' ')[0])))
      || (isAgreement && ['amendment', 'addendum', 'increase_letter'].includes(ctx.input.role) && ctx.input.projectDocuments.some((d) => ['main_agreement', 'signed_copy'].includes(d.role)));
    const isSelf = isAgreement && ownTitle.includes(lower.split(' ')[0]);
    if (inDocument || inProject || isSelf) continue;
    out.push(finding('missing_reference', 'amber', {
      title: `"${name}" is referred to but not provided`,
      plain: `${blocks.map(Ref).join(', ')} ${blocks.length > 1 ? 'refer' : 'refers'} to "${name}", which isn't in this document or anywhere else in the project. Terms in it may affect this contract.`,
      legal: `${blocks.map(Ref).join(', ')} incorporate${blocks.length > 1 ? '' : 's'} or refer${blocks.length > 1 ? '' : 's'} to "${name}", which has not been provided; its terms could not be reviewed.`,
      cannotWorkOut: null,
      passages: blocks.map((b) => passage(b)),
    }));
  }
  return out;
}

// ---------- Rule 6: missing essentials ----------

const ESSENTIALS: { label: string; topics: Topic[]; severity: Severity }[] = [
  { label: 'who the parties are', topics: ['parties'], severity: 'red' },
  { label: 'the price', topics: ['pricing_escalation'], severity: 'red' },
  { label: 'when and how payment is made', topics: ['payment'], severity: 'amber' },
  { label: 'how long the agreement lasts', topics: ['term_renewal'], severity: 'amber' },
  { label: 'how it can be ended', topics: ['termination_notice'], severity: 'amber' },
  { label: 'which law governs it', topics: ['governing_law'], severity: 'amber' },
  { label: 'a limit on liability', topics: ['liability_caps'], severity: 'amber' },
];
const FULL_CONTRACT_ROLES: DocumentRole[] = ['main_agreement', 'signed_copy', 'proposal'];

function essentialsRule(ctx: Ctx): Finding[] {
  if (!FULL_CONTRACT_ROLES.includes(ctx.input.role)) return [];
  const out: Finding[] = [];
  const found: ExtractionBlock[] = [];
  for (const e of ESSENTIALS) {
    const blocks = e.topics.flatMap((t) => inTopic(ctx, t));
    if (blocks.length) { found.push(blocks[0]); continue; }
    out.push(finding('missing_essentials', e.severity, {
      title: `Not stated: ${e.label}`,
      plain: `We couldn't find a clause about ${e.label} (${e.topics.map((t) => TOPIC_LABELS[t]).join(', ')}). If it's not in the contract, it may be unclear or left to the law that applies.`,
      legal: `No provision on ${e.topics.map((t) => TOPIC_LABELS[t].toLowerCase()).join('/')} was identified. Confirm whether it is dealt with elsewhere (e.g. a schedule or another document).`,
      cannotWorkOut: null,
      passages: [],
    }));
  }
  if (!out.length) {
    out.push(finding('missing_essentials', 'green', {
      title: 'Essential terms found',
      plain: 'The document has clauses on the parties, price, payment, duration, ending it, governing law and limiting liability.',
      legal: 'Clauses addressing parties, price, payment, term, termination, governing law and limitation of liability were each identified.',
      cannotWorkOut: null,
      passages: [...new Map(found.map((b) => [b.id, passage(b, 'related')])).values()],
    }));
  }
  return out;
}

// ---------- Run ----------

const ORDER: Record<Severity, number> = { red: 0, amber: 1, green: 2 };

export function runFindings(input: FindingsInput): FindingsResponse {
  const all = comparable(input.blocks);
  const classified = classifyBlocks(all);
  const ctx: Ctx = {
    all,
    blocks: all.filter((b) => !looksLikeHeading(b)),
    topics: new Map(classified.map((c) => [c.blockId, c.topics])),
    input,
  };
  const findings = [
    ...liabilityRule(ctx),
    ...escalationRule(ctx),
    ...overlappingEscalationRule(ctx),
    ...terminationCureRule(ctx),
    ...referenceRule(ctx),
    ...essentialsRule(ctx),
  ].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  // Keys survive new versions: they use clause numbers, not block ids. The
  // wording hash changes whenever the passages a finding rests on change.
  const byId = new Map(all.map((b) => [b.id, b]));
  const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);
  for (const f of findings) {
    const primary = f.passages.filter((p) => p.role === 'primary');
    const basis = primary.length ? primary : f.passages;
    f.key = 'fk_' + hash(`${f.rule}|${f.title}|${basis.map((p) => p.clauseNumber ?? '-').sort().join(',')}`);
    f.wordingHash = hash(basis.map((p) => (byId.get(p.blockId)?.text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()).join('\n'));
  }
  const summary: Record<Severity, number> = { red: 0, amber: 0, green: 0 };
  for (const f of findings) summary[f.severity]++;
  return {
    versionId: input.versionId,
    findings,
    orphanedDecisions: [],
    summary,
    rulesChecked: FINDING_RULES.filter((r) => r !== 'missing_essentials' || FULL_CONTRACT_ROLES.includes(input.role))
      .map((rule) => ({ rule, label: FINDING_RULE_LABELS[rule] })),
  };
}
