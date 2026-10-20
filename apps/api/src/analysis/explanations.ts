// Plain-English explanations from fixed templates. The templates describe
// what a kind of clause generally does and what to check. Anything specific
// (periods, amounts, parties) is quoted from the clause itself, never made up.

import type { ClauseExplanation, ExpertiseLevel, Topic } from '@easycontract/shared';
import { extractFacts } from './facts.ts';

interface Template {
  plain: string;
  legal: string;
  checkPlain: string[];
  checkLegal: string[];
}

const T: Record<Topic, Template> = {
  parties: {
    plain: 'This says who the agreement is between.',
    legal: 'Identifies the contracting parties and, usually, the short names used for them in the rest of the document.',
    checkPlain: ['Are the full registered names correct?', 'Is the right company in your group signing?'],
    checkLegal: ['Full legal names and registration numbers match the official records.', 'The signing entity is the one that will perform and be paid.', 'Defined party names are used consistently throughout.'],
  },
  term_renewal: {
    plain: 'This says when the agreement starts, how long it lasts and whether it renews.',
    legal: 'Sets the commencement, duration and any renewal mechanism of the agreement.',
    checkPlain: ['Is the start date clear?', 'If it renews by itself, do you know how and when to stop it?'],
    checkLegal: ['Commencement trigger is certain.', 'Renewal is automatic or by election, and the notice window to prevent renewal is stated.', 'What happens to pricing on renewal is stated.'],
  },
  pricing_escalation: {
    plain: 'This sets the price and how it can go up.',
    legal: 'Fixes the consideration payable and any mechanism for adjusting it over time.',
    checkPlain: ['Is every price filled in?', 'Can the price go up, by how much and how often?'],
    checkLegal: ['All amounts and rates are completed (no blanks or placeholders).', 'Escalation basis, index, frequency and caps are stated.', 'Whether increases need notice or consent is stated.'],
  },
  payment: {
    plain: 'This says when and how money must be paid.',
    legal: 'Regulates invoicing, payment terms, method of payment and consequences of late payment.',
    checkPlain: ['How many days do you have to pay?', 'What happens if a payment is late?'],
    checkLegal: ['Invoice requirements and payment period are stated.', 'Interest or suspension rights on late payment are stated.', 'Disputed-invoice procedure is stated.'],
  },
  liability_caps: {
    plain: 'This limits how much a party can be made to pay if something goes wrong.',
    legal: 'Limits or excludes a party\'s liability, by amount, by type of loss, or both.',
    checkPlain: ['Is the limit enough to cover a real problem?', 'Does it apply to both sides equally?'],
    checkLegal: ['The cap amount or formula is stated and complete.', 'Which losses are excluded (e.g. indirect or consequential).', 'Carve-outs from the cap, and whether indemnities sit inside or outside it.'],
  },
  indemnities: {
    plain: 'This makes one party cover the other\'s losses in certain situations.',
    legal: 'Creates an obligation to make good specified losses or third-party claims, often outside the general liability regime.',
    checkPlain: ['Who has to pay whom, and for what?', 'Is there any limit on it?'],
    checkLegal: ['Scope of indemnified losses and triggering events.', 'Whether the indemnity is capped or sits outside the liability cap.', 'Claims-handling process (notice, conduct of defence).'],
  },
  insurance: {
    plain: 'This says what insurance a party must have.',
    legal: 'Requires a party to obtain and maintain specified insurance cover.',
    checkPlain: ['What cover is needed, and how much?', 'Do you have to show proof?'],
    checkLegal: ['Types of cover and minimum amounts are stated.', 'Duration of cover, evidence of cover and notice of cancellation.'],
  },
  termination_notice: {
    plain: 'This says how the agreement can be ended and what notice is needed.',
    legal: 'Sets the grounds and procedure for termination, including notice requirements.',
    checkPlain: ['Can you end it if you need to, and how much notice is needed?', 'What has to be done or paid when it ends?'],
    checkLegal: ['Termination for convenience and for cause, and whether both are mutual.', 'Notice periods and the method of giving notice.', 'Consequences of termination and surviving clauses.'],
  },
  cure_periods: {
    plain: 'This gives a party time to fix a problem before stronger action is taken.',
    legal: 'Provides a period within which a defaulting party may remedy a breach before remedies (such as termination) become available.',
    checkPlain: ['How long is the time to fix a problem?', 'Does it start from a written notice?'],
    checkLegal: ['Length of the cure period and its trigger.', 'Whether it is consistent with the termination clause.', 'Breaches that cannot be cured.'],
  },
  confidentiality: {
    plain: 'This says what information must be kept secret.',
    legal: 'Restricts use and disclosure of confidential information.',
    checkPlain: ['What counts as confidential?', 'How long does the duty last?'],
    checkLegal: ['Definition and exclusions of confidential information.', 'Permitted disclosures and duration.', 'Return or destruction on termination.'],
  },
  intellectual_property: {
    plain: 'This says who owns or may use ideas, designs, software or other creative work.',
    legal: 'Allocates ownership of, and licences to use, intellectual property.',
    checkPlain: ['Who owns what is created under this agreement?', 'What can each side do with it?'],
    checkLegal: ['Ownership of pre-existing and newly created IP.', 'Scope, duration and transferability of licences.', 'Third-party IP warranties.'],
  },
  disputes: {
    plain: 'This says how disagreements must be handled.',
    legal: 'Sets the dispute-resolution procedure (negotiation, mediation, arbitration or courts).',
    checkPlain: ['What steps must be taken before going to court or arbitration?', 'Where would it be heard?'],
    checkLegal: ['Escalation steps and time limits.', 'Forum, seat, rules and appointment process.', 'Interim relief carve-outs.'],
  },
  governing_law: {
    plain: 'This says which country\'s or region\'s law applies to the agreement.',
    legal: 'Selects the system of law governing the agreement and, where stated, the courts with jurisdiction.',
    checkPlain: ['Is it a law you are comfortable with?'],
    checkLegal: ['Governing law is stated.', 'Jurisdiction (exclusive or non-exclusive) is stated and consistent with the dispute clause.'],
  },
  force_majeure: {
    plain: 'This excuses a party when events outside its control stop it from performing.',
    legal: 'Suspends or excuses performance where specified events beyond a party\'s reasonable control occur.',
    checkPlain: ['Which events count?', 'What happens to payments during that time, and can you end the agreement if it goes on too long?'],
    checkLegal: ['Defined events and any exclusions.', 'Notice and mitigation obligations.', 'Effect on payment obligations and long-stop termination right.'],
  },
  assignment: {
    plain: 'This says whether a party can hand the agreement over to someone else.',
    legal: 'Restricts or permits transfer of rights and obligations, subcontracting and changes of control.',
    checkPlain: ['Can the other side pass the agreement to someone you don\'t know?', 'Do they need your permission?'],
    checkLegal: ['Whether consent is required and whether it may be unreasonably withheld.', 'Intra-group transfers and change of control.', 'Subcontracting and responsibility for subcontractors.'],
  },
  service_levels: {
    plain: 'This sets the standard the service must meet.',
    legal: 'Specifies measurable performance standards and how they are monitored.',
    checkPlain: ['Are the targets measurable?', 'What happens if they are missed?'],
    checkLegal: ['Metrics, measurement periods and reporting.', 'Remedies for failure (service credits, termination).', 'Exclusions from the measurement.'],
  },
  penalties: {
    plain: 'This sets a fixed amount or credit that is due if something isn\'t done as agreed.',
    legal: 'Provides for a pre-agreed sum, credit or forfeiture upon a specified failure.',
    checkPlain: ['When does it apply, and how much is it?', 'Is it the only remedy?'],
    checkLegal: ['Trigger, amount or formula, and any cap.', 'Whether it is an exclusive remedy.', 'Whether enforceability of the provision needs advice in the applicable law.'],
  },
};

const MUTUAL = /\b(each|either|both|neither) part(y|ies)\b|\bthe parties\b/i;
// "The Supplier may ..." / "The Client shall ..." — the subject of an obligation or right.
const SUBJECT = /\b(?:[Tt]he\s+)?([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?)(?:'s)?\s+(shall|must|will|may|is entitled to|is not liable|will not be liable|shall not be liable|agrees|undertakes|indemnifies|warrants)(\s+not)?\b/;
const NOT_PARTIES = new Set(['This', 'The', 'Such', 'Any', 'All', 'Each', 'Either', 'Neither', 'Both', 'It', 'Invoices', 'Fees', 'Notice', 'Payment', 'Agreement', 'This Agreement', 'Note']);

export function whoItFavours(text: string, level: ExpertiseLevel, topic?: Topic): string {
  if (topic === 'parties') {
    return level === 'plain' ? 'Neither side: it identifies who is involved.' : 'Not applicable: identifies the parties.';
  }
  if (MUTUAL.test(text)) {
    return level === 'plain'
      ? 'As worded, it applies to both sides.'
      : 'Mutual as drafted: it binds or benefits both parties. Check the detail is genuinely reciprocal.';
  }
  const m = SUBJECT.exec(text);
  if (m && !NOT_PARTIES.has(m[1])) {
    const party = m[1];
    const verb = m[2] + (m[3] ?? '');
    // "may not" restricts rather than permits.
    if (verb === 'may' || verb === 'is entitled to' || /not (be )?liable/.test(verb)) {
      return level === 'plain'
        ? `It gives ${party} a right or protection, so it mainly favours ${party}.`
        : `Confers a right or protection on ${party} ("${party} ${verb}"); prima facie in ${party}'s favour.`;
    }
    return level === 'plain'
      ? `It puts a duty on ${party}, so it mainly favours the other side.`
      : `Imposes an obligation on ${party} ("${party} ${verb}"); prima facie in the counterparty's favour.`;
  }
  return level === 'plain'
    ? 'Not clear from the wording. Check which party this binds.'
    : 'Not stated: the wording does not make clear which party it binds or benefits.';
}

export function explainClause(input: {
  blockId: string;
  text: string;
  topic: Topic;
  level: ExpertiseLevel;
  reasons?: string[];
}): ClauseExplanation {
  const { blockId, text, topic, level } = input;
  const t = T[topic];
  const facts = extractFacts(text, blockId);
  const checks = [...(level === 'plain' ? t.checkPlain : t.checkLegal)];
  if (facts.some((f) => f.kind === 'placeholder')) {
    checks.unshift(level === 'plain'
      ? 'Part of this clause is still a blank or placeholder. Get it filled in before signing.'
      : 'Contains an unfilled placeholder; the clause is incomplete as drafted.');
  }
  return {
    sourceBlockId: blockId,
    topic,
    level,
    whatItMeans: level === 'plain' ? t.plain : t.legal,
    whoItFavours: whoItFavours(text, level, topic),
    whatToCheck: checks,
    facts,
    ...(level === 'legal' ? { reasons: input.reasons ?? [] } : {}),
  };
}
