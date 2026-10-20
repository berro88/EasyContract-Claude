// Contract Wizard templates. Questions are plain English. Clause builders
// insert answers exactly as given; a missing answer becomes a visible
// "[NOT PROVIDED: ...]" marker rather than a guess. Nothing is calculated.
//
// Template wording is a generic starting point, labelled as such in the app
// and in exports. It is not tailored to any law and must be reviewed.

import type { ContractType, ContractTypeInfo, Topic, WizardQuestion } from '@easycontract/shared';

export type Answers = Record<string, string>;

export interface SectionSpec {
  topic: Topic | null;
  heading: string;
  text: string;
  explanation: string;
  protective?: string | null;
  loophole?: string | null;
}

interface TypeDef extends ContractTypeInfo {
  build(a: Answers): SectionSpec[];
}

// ---------- Helpers ----------

const has = (a: Answers, id: string) => !!a[id]?.trim();
const yes = (a: Answers, id: string) => a[id] === 'yes';

/** The answer exactly as given, or a visible marker that it is missing. */
function make(questions: WizardQuestion[]) {
  const label = (id: string) => questions.find((q) => q.id === id)?.label ?? id;
  return (a: Answers, id: string) => (has(a, id) ? a[id].trim() : `[NOT PROVIDED: ${label(id)}]`);
}

const YESNO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];

// Questions most types share.
const partyQuestions = (ourRoleLabel: string, otherRoleLabel: string): WizardQuestion[] => [
  { id: 'ourName', group: 'Parties', label: `Your company's registered name (${ourRoleLabel})`, kind: 'text', prefill: 'legalName', essential: true },
  { id: 'ourRegistration', group: 'Parties', label: 'Your registration number', kind: 'text', prefill: 'registrationNumber' },
  { id: 'ourAddress', group: 'Parties', label: 'Your registered address', kind: 'textarea', prefill: 'address' },
  { id: 'otherName', group: 'Parties', label: `The other party's full name (${otherRoleLabel})`, kind: 'text', essential: true },
  { id: 'otherRegistration', group: 'Parties', label: "The other party's registration or ID number", kind: 'text' },
  { id: 'otherAddress', group: 'Parties', label: "The other party's address", kind: 'textarea' },
];

const lawQuestions: WizardQuestion[] = [
  { id: 'governingLaw', group: 'Law and disputes', label: "Which country's or region's law should apply?", kind: 'text', prefill: 'country', essential: true,
    help: 'Usually where you are based. A lawyer can confirm whether the choice is effective.' },
  { id: 'disputes', group: 'Law and disputes', label: 'How should disagreements be settled?', kind: 'select',
    options: [{ value: 'courts', label: 'Go straight to court' }, { value: 'mediation', label: 'Try mediation first, then court' }, { value: 'arbitration', label: 'Arbitration' }],
    protective: { answer: 'mediation', why: 'Trying mediation first is usually cheaper and quicker than going straight to court.' } },
];

const liabilityQuestions: WizardQuestion[] = [
  { id: 'liabilityCap', group: 'Risk', label: 'Should liability be limited?', kind: 'select',
    options: [{ value: 'fees12', label: 'Yes, to the fees paid in the 12 months before a claim' }, { value: 'amount', label: 'Yes, to a fixed amount' }, { value: 'none', label: 'No limit' }],
    protective: { answer: 'fees12', why: 'A cap stops one claim from costing more than the contract is worth.' }, essential: true },
  { id: 'capAmount', group: 'Risk', label: 'The fixed limit (with currency)', kind: 'text', showIf: { question: 'liabilityCap', equals: 'amount' } },
];

function partiesSection(a: Answers, val: (a: Answers, id: string) => string, ourTerm: string, otherTerm: string): SectionSpec {
  const reg = (id: string) => (has(a, id) ? `, registration number ${a[id].trim()}` : '');
  const addr = (id: string) => (has(a, id) ? `, of ${a[id].trim().replace(/\s*\n\s*/g, ', ')}` : '');
  return {
    topic: 'parties',
    heading: 'Parties',
    text: `This agreement is made between ${val(a, 'ourName')}${reg('ourRegistration')}${addr('ourAddress')} ("${ourTerm}"), and ${val(a, 'otherName')}${reg('otherRegistration')}${addr('otherAddress')} ("${otherTerm}").`,
    explanation: 'Names who is bound. Use full registered names so there is no doubt which entity signs.',
  };
}

function liabilitySection(a: Answers, val: (a: Answers, id: string) => string): SectionSpec {
  const choice = a.liabilityCap;
  const text = choice === 'amount'
    ? `Each party's total liability under this agreement is limited to ${val(a, 'capAmount')}. Neither party is liable for indirect or consequential loss.`
    : choice === 'none'
      ? 'Neither party is liable for indirect or consequential loss.'
      : choice === 'fees12'
        ? "Each party's total liability under this agreement is limited to the fees paid in the 12 months before the claim. Neither party is liable for indirect or consequential loss."
        : `Each party's total liability under this agreement is limited to [NOT PROVIDED: liability limit]. Neither party is liable for indirect or consequential loss.`;
  return {
    topic: 'liability_caps',
    heading: 'Limitation of liability',
    text,
    explanation: 'Limits how much either side can be made to pay if something goes wrong.',
    protective: choice === 'none' ? 'Consider a cap: with no limit, one claim could cost more than the whole contract.' : 'A liability cap protects both sides from open-ended claims.',
    loophole: 'Check that indemnities elsewhere say whether this limit applies to them; otherwise they may sit outside it.',
  };
}

function lawSections(a: Answers, val: (a: Answers, id: string) => string): SectionSpec[] {
  const disputes = a.disputes === 'arbitration'
    ? 'Any dispute will first be referred to senior representatives of each party. If it is not resolved within 20 business days, it will be finally resolved by arbitration.'
    : a.disputes === 'mediation'
      ? 'Any dispute will first be referred to senior representatives of each party. If it is not resolved within 20 business days, the parties will try mediation before either goes to court.'
      : 'Any dispute will first be referred to senior representatives of each party before either goes to court.';
  return [
    { topic: 'disputes', heading: 'Disputes', text: disputes, explanation: 'Sets the steps to follow before a disagreement goes further.' },
    {
      topic: 'governing_law', heading: 'Governing law', text: `This agreement is governed by the laws of ${val(a, 'governingLaw')}.`,
      explanation: 'Says which law is used to read the agreement. Some laws may apply whatever the agreement says; a lawyer can confirm.',
    },
  ];
}

const forceMajeure: SectionSpec = {
  topic: 'force_majeure', heading: 'Events beyond control',
  text: 'Neither party is liable for delay or failure caused by events beyond its reasonable control, such as natural disasters, war or pandemic, provided it notifies the other party promptly and takes reasonable steps to limit the effect. If such an event lasts more than 60 days, either party may end this agreement by written notice.',
  explanation: 'Excuses a party when something outside its control stops it performing, and lets either side leave if it goes on too long.',
  loophole: 'Payment obligations are often meant to continue during such events. Check whether that should be said.',
};

const assignment: SectionSpec = {
  topic: 'assignment', heading: 'Transfer of the agreement',
  text: "Neither party may transfer or assign its rights or obligations under this agreement without the other party's prior written consent, which may not be unreasonably withheld.",
  explanation: 'Stops either side handing the agreement to someone else without agreement.',
};

const whole: SectionSpec = {
  topic: null, heading: 'Whole agreement',
  text: 'This agreement is the whole agreement between the parties on its subject. A change is only valid if it is in writing and signed by both parties.',
  explanation: 'Makes the written agreement the full deal and requires changes to be in writing.',
};

function confidentialitySection(mutual: boolean): SectionSpec {
  return {
    topic: 'confidentiality', heading: 'Confidentiality',
    text: mutual
      ? "Each party must keep the other party's confidential information secret, use it only for this agreement, and not disclose it to anyone except its staff and advisers who need to know it and are bound to keep it confidential."
      : 'The receiving party must keep the disclosing party\'s confidential information secret, use it only for the purpose of this agreement, and not disclose it to anyone except its staff and advisers who need to know it and are bound to keep it confidential.',
    explanation: 'Keeps business information private and limits how it may be used.',
  };
}

function paymentSection(a: Answers, val: (a: Answers, id: string) => string, payer: string): SectionSpec {
  return {
    topic: 'payment', heading: 'Payment',
    text: `${payer} must pay each invoice within ${val(a, 'paymentDays')} days of receiving it.${yes(a, 'lateInterest') ? ` Overdue amounts carry interest at ${val(a, 'lateInterestRate')} until paid.` : ''}`,
    explanation: 'Sets when money is due and what happens if it is late.',
    protective: yes(a, 'lateInterest') ? 'Interest on late payment encourages paying on time.' : 'Consider adding interest on late payment.',
  };
}

const paymentQuestions: WizardQuestion[] = [
  { id: 'paymentDays', group: 'Money', label: 'How many days does the payer have to pay an invoice?', kind: 'number', essential: true },
  { id: 'lateInterest', group: 'Money', label: 'Charge interest on late payment?', kind: 'yesno', options: YESNO, protective: { answer: 'yes', why: 'It encourages paying on time.' } },
  { id: 'lateInterestRate', group: 'Money', label: 'Late payment interest rate (as you want it written)', kind: 'text', help: 'For example "2% per month".', showIf: { question: 'lateInterest', equals: 'yes' } },
];

function escalationText(a: Answers, val: (a: Answers, id: string) => string, what: string): string | null {
  if (a.escalation === 'fixed') return `The ${what} increases by ${val(a, 'escalationPercent')}% on each anniversary of the start date.`;
  if (a.escalation === 'index') return `The ${what} increases on each anniversary of the start date in line with ${val(a, 'escalationIndex')}.`;
  return null;
}

const escalationQuestions: WizardQuestion[] = [
  { id: 'escalation', group: 'Money', label: 'Does the price go up each year?', kind: 'select',
    options: [{ value: 'none', label: 'No' }, { value: 'fixed', label: 'Yes, by a fixed percentage' }, { value: 'index', label: 'Yes, in line with an index (such as CPI)' }] },
  { id: 'escalationPercent', group: 'Money', label: 'Yearly increase (%)', kind: 'number', showIf: { question: 'escalation', equals: 'fixed' } },
  { id: 'escalationIndex', group: 'Money', label: 'Which index, exactly?', kind: 'text', help: 'Name the official index, and add a maximum if you want one.', showIf: { question: 'escalation', equals: 'index' } },
];

function termination(a: Answers, val: (a: Answers, id: string) => string): SectionSpec[] {
  return [
    {
      topic: 'termination_notice', heading: 'Ending the agreement',
      text: `Either party may end this agreement by giving ${val(a, 'terminationNoticeDays')} days' written notice.`,
      explanation: 'Says how either side can leave and how much warning is needed.',
    },
    {
      topic: 'cure_periods', heading: 'Breach',
      text: `If a party breaches this agreement and does not remedy the breach within ${val(a, 'cureDays')} days after receiving written notice of it, the other party may end this agreement immediately by written notice.`,
      explanation: 'Gives a party time to fix a problem before the other can end the agreement for it.',
      loophole: 'Make sure no other clause allows ending the agreement immediately for a breach without this time to fix it.',
    },
  ];
}

const terminationQuestions: WizardQuestion[] = [
  { id: 'terminationNoticeDays', group: 'Ending it', label: 'Days of written notice to end the agreement', kind: 'number', essential: true },
  { id: 'cureDays', group: 'Ending it', label: 'Days a party has to fix a breach after being told about it', kind: 'number', essential: true },
];

// ---------- Types ----------

const serviceQuestions: WizardQuestion[] = [
  { id: 'ourRole', group: 'Parties', label: 'Are you providing the services or receiving them?', kind: 'select', essential: true,
    options: [{ value: 'supplier', label: 'Providing them (we are the supplier)' }, { value: 'client', label: 'Receiving them (we are the client)' }] },
  ...partyQuestions('you', 'them'),
  { id: 'services', group: 'The work', label: 'Describe the services', kind: 'textarea', essential: true },
  { id: 'startDate', group: 'The work', label: 'Start date', kind: 'date', essential: true },
  { id: 'termMonths', group: 'The work', label: 'How many months does it run for?', kind: 'number', essential: true },
  { id: 'autoRenew', group: 'The work', label: 'Should it renew automatically?', kind: 'yesno', options: YESNO },
  { id: 'renewalNoticeDays', group: 'The work', label: 'Days of notice needed to stop it renewing', kind: 'number', essential: true, showIf: { question: 'autoRenew', equals: 'yes' },
    protective: { answer: '60', why: 'A clear window to stop renewal avoids being locked in by surprise.' } },
  { id: 'fee', group: 'Money', label: 'The fee, with currency and how often (for example "R12,000 per month")', kind: 'text', essential: true },
  ...escalationQuestions,
  ...paymentQuestions,
  ...liabilityQuestions,
  ...terminationQuestions,
  { id: 'ipOwner', group: 'Risk', label: 'Who owns work created under the agreement?', kind: 'select',
    options: [{ value: 'supplier', label: 'The supplier (the client gets a licence to use it)' }, { value: 'client', label: 'The client, once paid for' }] },
  ...lawQuestions,
];

const supplyQuestions: WizardQuestion[] = [
  { id: 'ourRole', group: 'Parties', label: 'Are you selling the goods or buying them?', kind: 'select', essential: true,
    options: [{ value: 'supplier', label: 'Selling (we are the supplier)' }, { value: 'buyer', label: 'Buying (we are the buyer)' }] },
  ...partyQuestions('you', 'them'),
  { id: 'goods', group: 'The goods', label: 'Describe the goods', kind: 'textarea', essential: true },
  { id: 'deliveryDays', group: 'The goods', label: 'Days to deliver after an order is accepted', kind: 'number', essential: true },
  { id: 'deliveryPlace', group: 'The goods', label: 'Where are goods delivered?', kind: 'text' },
  { id: 'warrantyMonths', group: 'The goods', label: 'Months the goods are guaranteed against defects', kind: 'number',
    protective: { answer: '12', why: 'A stated guarantee period avoids arguments about faulty goods.' } },
  { id: 'price', group: 'Money', label: 'Price, with currency (or "as per the price list attached")', kind: 'text', essential: true },
  ...escalationQuestions,
  ...paymentQuestions,
  { id: 'titlePasses', group: 'Risk', label: 'When does ownership pass to the buyer?', kind: 'select',
    options: [{ value: 'payment', label: 'When paid in full' }, { value: 'delivery', label: 'On delivery' }],
    protective: { answer: 'payment', why: 'For a seller, keeping ownership until paid protects against non-payment.' } },
  ...liabilityQuestions,
  ...terminationQuestions,
  ...lawQuestions,
];

const ndaQuestions: WizardQuestion[] = [
  ...partyQuestions('you', 'them'),
  { id: 'mutual', group: 'The information', label: 'Will both sides share confidential information?', kind: 'yesno', options: YESNO, essential: true },
  { id: 'purpose', group: 'The information', label: 'Why is information being shared?', kind: 'textarea', essential: true, help: 'For example "to discuss a possible supply agreement".' },
  { id: 'durationYears', group: 'The information', label: 'For how many years must it be kept confidential?', kind: 'number', essential: true },
  { id: 'returnInfo', group: 'The information', label: 'Must information be returned or destroyed when asked?', kind: 'yesno', options: YESNO,
    protective: { answer: 'yes', why: 'Lets you get your information back when talks end.' } },
  ...lawQuestions,
];

const employmentQuestions: WizardQuestion[] = [
  { id: 'ourName', group: 'Parties', label: "Employer's registered name", kind: 'text', prefill: 'legalName', essential: true },
  { id: 'ourRegistration', group: 'Parties', label: "Employer's registration number", kind: 'text', prefill: 'registrationNumber' },
  { id: 'ourAddress', group: 'Parties', label: "Employer's address", kind: 'textarea', prefill: 'address' },
  { id: 'otherName', group: 'Parties', label: "Employee's full name", kind: 'text', essential: true },
  { id: 'otherRegistration', group: 'Parties', label: "Employee's ID number", kind: 'text' },
  { id: 'otherAddress', group: 'Parties', label: "Employee's address", kind: 'textarea' },
  { id: 'jobTitle', group: 'The job', label: 'Job title', kind: 'text', essential: true },
  { id: 'duties', group: 'The job', label: 'Main duties', kind: 'textarea' },
  { id: 'startDate', group: 'The job', label: 'Start date', kind: 'date', essential: true },
  { id: 'workplace', group: 'The job', label: 'Usual place of work', kind: 'text' },
  { id: 'hours', group: 'The job', label: 'Normal working hours per week', kind: 'number', essential: true },
  { id: 'salary', group: 'Pay and leave', label: 'Pay, with currency and period (for example "R25,000 per month")', kind: 'text', essential: true },
  { id: 'leaveDays', group: 'Pay and leave', label: 'Paid annual leave days', kind: 'number', essential: true },
  { id: 'probationMonths', group: 'Pay and leave', label: 'Probation period in months (leave empty for none)', kind: 'number' },
  { id: 'noticeWeeks', group: 'Ending it', label: 'Weeks of notice either side must give', kind: 'number', essential: true },
  { id: 'governingLaw', group: 'Law and disputes', label: 'Which country\'s law applies?', kind: 'text', prefill: 'country', essential: true },
];

const leaseQuestions: WizardQuestion[] = [
  { id: 'ourRole', group: 'Parties', label: 'Are you the landlord or the tenant?', kind: 'select', essential: true,
    options: [{ value: 'landlord', label: 'Landlord' }, { value: 'tenant', label: 'Tenant' }] },
  ...partyQuestions('you', 'them'),
  { id: 'premises', group: 'The premises', label: 'Address and description of the premises', kind: 'textarea', essential: true },
  { id: 'use', group: 'The premises', label: 'What may the premises be used for?', kind: 'text' },
  { id: 'startDate', group: 'The premises', label: 'Start date', kind: 'date', essential: true },
  { id: 'termMonths', group: 'The premises', label: 'Length of the lease in months', kind: 'number', essential: true },
  { id: 'rent', group: 'Money', label: 'Rent, with currency and period', kind: 'text', essential: true },
  { id: 'deposit', group: 'Money', label: 'Deposit, with currency (leave empty for none)', kind: 'text',
    protective: { answer: 'deposit', why: 'For a landlord, a deposit covers unpaid rent or damage.' } },
  ...escalationQuestions,
  { id: 'paymentDay', group: 'Money', label: 'Rent is due on which day of each month?', kind: 'number', essential: true },
  { id: 'terminationNoticeDays', group: 'Ending it', label: 'Days of written notice to end the lease', kind: 'number', essential: true },
  { id: 'cureDays', group: 'Ending it', label: 'Days a party has to fix a breach after being told about it', kind: 'number', essential: true },
  ...lawQuestions,
];

const salesQuestions: WizardQuestion[] = [
  { id: 'ourName', group: 'Parties', label: "Your company's registered name (the seller)", kind: 'text', prefill: 'legalName', essential: true },
  { id: 'ourRegistration', group: 'Parties', label: 'Your registration number', kind: 'text', prefill: 'registrationNumber' },
  { id: 'ourAddress', group: 'Parties', label: 'Your registered address', kind: 'textarea', prefill: 'address' },
  { id: 'quoteValidityDays', group: 'Quotes and orders', label: 'How many days is a quotation valid?', kind: 'number', essential: true },
  { id: 'pricesIncludeTax', group: 'Quotes and orders', label: 'Do quoted prices include tax?', kind: 'select', essential: true,
    options: [{ value: 'yes', label: 'Yes, tax is included' }, { value: 'no', label: 'No, tax is added' }],
    help: "We don't assume any tax applies; this just states how your prices are shown." },
  { id: 'deliveryDays', group: 'Quotes and orders', label: 'Usual days to deliver after an order is accepted', kind: 'number' },
  ...paymentQuestions,
  { id: 'returnsDays', group: 'Returns', label: 'Days a customer has to report damaged or wrong goods', kind: 'number',
    protective: { answer: '7', why: 'A short, clear window stops late complaints about goods.' } },
  { id: 'titlePasses', group: 'Risk', label: 'When does ownership pass to the customer?', kind: 'select',
    options: [{ value: 'payment', label: 'When paid in full' }, { value: 'delivery', label: 'On delivery' }],
    protective: { answer: 'payment', why: 'Keeping ownership until paid protects against non-payment.' } },
  ...liabilityQuestions,
  ...lawQuestions,
];

export const TYPES: Record<ContractType, TypeDef> = {
  service_agreement: {
    id: 'service_agreement', label: 'Service agreement', description: 'For providing or receiving services, such as cleaning, IT support or consulting.',
    questions: serviceQuestions,
    build(a) {
      const val = make(serviceQuestions);
      const weSupply = a.ourRole !== 'client';
      const [our, other] = weSupply ? ['Supplier', 'Client'] : ['Client', 'Supplier'];
      const esc = escalationText(a, val, 'fee');
      const s: SectionSpec[] = [
        partiesSection(a, val, our, other),
        { topic: null, heading: 'Services', text: `The Supplier will provide the following services to the Client: ${val(a, 'services')}`, explanation: 'Describes what is being done. Vague descriptions are a common source of disputes.',
          loophole: 'If the services are only loosely described, it is hard to show they were not delivered.' },
        {
          topic: 'term_renewal', heading: 'Duration',
          text: `This agreement starts on ${val(a, 'startDate')} and runs for ${val(a, 'termMonths')} months.${yes(a, 'autoRenew') ? ` It then renews automatically for further periods of the same length unless either party gives written notice at least ${val(a, 'renewalNoticeDays')} days before the end of the current period.` : ''}`,
          explanation: 'Says when the agreement starts, how long it lasts and whether it renews.',
          loophole: yes(a, 'autoRenew') ? 'Automatic renewal can lock you in. Diarise the date by which notice must be given.' : null,
        },
        { topic: 'pricing_escalation', heading: 'Fees', text: `The Client will pay the Supplier ${val(a, 'fee')}.${esc ? ` ${esc}` : ''}`, explanation: 'Sets the price and any yearly increase.',
          loophole: a.escalation === 'index' ? 'An index-linked increase without a maximum can grow more than expected.' : null },
        paymentSection(a, val, 'The Client'),
        liabilitySection(a, val),
        ...termination(a, val),
        confidentialitySection(true),
        {
          topic: 'intellectual_property', heading: 'Work created under this agreement',
          text: a.ipOwner === 'client'
            ? 'All work created by the Supplier specifically for the Client under this agreement belongs to the Client once it has been paid for.'
            : 'The Supplier keeps ownership of work it creates under this agreement and grants the Client a licence to use it for the Client\'s own business for as long as this agreement lasts.',
          explanation: 'Says who owns what is created.',
        },
        forceMajeure, assignment, ...lawSections(a, val), whole,
      ];
      return s;
    },
  },
  supply: {
    id: 'supply', label: 'Supply agreement', description: 'For selling or buying goods on an ongoing basis.',
    questions: supplyQuestions,
    build(a) {
      const val = make(supplyQuestions);
      const [our, other] = a.ourRole === 'buyer' ? ['Buyer', 'Supplier'] : ['Supplier', 'Buyer'];
      const esc = escalationText(a, val, 'price');
      return [
        partiesSection(a, val, our, other),
        { topic: null, heading: 'Goods', text: `The Supplier will supply the following goods to the Buyer when ordered: ${val(a, 'goods')}`, explanation: 'Describes what is being supplied.' },
        { topic: null, heading: 'Delivery', text: `The Supplier will deliver goods within ${val(a, 'deliveryDays')} days after accepting an order${has(a, 'deliveryPlace') ? `, to ${a.deliveryPlace.trim()}` : ''}. The Buyer must inspect goods on delivery and report any shortage or damage in writing within 5 business days.`,
          explanation: 'Sets when and where goods arrive and how problems must be reported.' },
        { topic: 'pricing_escalation', heading: 'Price', text: `The price of the goods is ${val(a, 'price')}.${esc ? ` ${esc}` : ''}`, explanation: 'Sets the price and any yearly increase.' },
        paymentSection(a, val, 'The Buyer'),
        { topic: null, heading: 'Ownership and risk', text: a.titlePasses === 'delivery'
          ? 'Ownership of and risk in the goods pass to the Buyer on delivery.'
          : 'Risk in the goods passes to the Buyer on delivery. Ownership passes to the Buyer only when the goods have been paid for in full.',
          explanation: 'Says when the goods become the buyer\'s and who bears the loss if they are damaged.',
          protective: a.titlePasses === 'delivery' ? null : 'Keeping ownership until payment protects the seller if the buyer does not pay.' },
        { topic: null, heading: 'Guarantee', text: has(a, 'warrantyMonths')
          ? `The Supplier guarantees that the goods will be free from defects for ${a.warrantyMonths.trim()} months after delivery and will repair or replace defective goods.`
          : 'The goods are supplied without any guarantee beyond what the law requires.',
          explanation: 'Says what happens if goods turn out to be faulty.' },
        liabilitySection(a, val),
        ...termination(a, val),
        confidentialitySection(true), forceMajeure, assignment, ...lawSections(a, val), whole,
      ];
    },
  },
  nda: {
    id: 'nda', label: 'Non-disclosure agreement (NDA)', description: 'For keeping information confidential while you talk business.',
    questions: ndaQuestions,
    build(a) {
      const val = make(ndaQuestions);
      const mutual = a.mutual !== 'no';
      return [
        partiesSection(a, val, mutual ? 'First Party' : 'Disclosing Party', mutual ? 'Second Party' : 'Receiving Party'),
        { topic: null, heading: 'Purpose', text: `Confidential information is shared only for this purpose: ${val(a, 'purpose')}`, explanation: 'Limits why the information may be used.' },
        { topic: null, heading: 'What is confidential', text: 'Confidential information means all information shared under this agreement that is marked confidential or that a reasonable person would understand to be confidential. It does not include information that is public through no fault of the recipient, that the recipient already had, or that the recipient develops independently.',
          explanation: 'Defines what is protected and what is not.' },
        confidentialitySection(mutual),
        { topic: 'term_renewal', heading: 'How long it lasts', text: `The duty to keep information confidential lasts for ${val(a, 'durationYears')} years after the date of this agreement.`, explanation: 'Says how long secrecy must be kept.',
          loophole: 'Some information, such as trade secrets, may need protection for longer than this period.' },
        ...(yes(a, 'returnInfo') ? [{ topic: null, heading: 'Returning information', text: 'On written request, the recipient must promptly return or destroy all confidential information and any copies.', explanation: 'Lets the owner get its information back.', protective: 'Lets you recover your information when talks end.' } as SectionSpec] : []),
        { topic: null, heading: 'No commitment', text: 'This agreement does not oblige either party to enter into any further agreement.', explanation: 'Makes clear that signing an NDA is not a promise to do business.' },
        ...lawSections(a, val), whole,
      ];
    },
  },
  employment: {
    id: 'employment', label: 'Employment contract', description: 'For employing a person. Employment law may set minimum terms this draft does not cover.',
    questions: employmentQuestions,
    build(a) {
      const val = make(employmentQuestions);
      return [
        partiesSection(a, val, 'Employer', 'Employee'),
        { topic: null, heading: 'Job', text: `The Employer employs the Employee as ${val(a, 'jobTitle')}, starting on ${val(a, 'startDate')}.${has(a, 'duties') ? ` The Employee's main duties are: ${a.duties.trim()}` : ''}${has(a, 'workplace') ? ` The usual place of work is ${a.workplace.trim()}.` : ''}`,
          explanation: 'Sets the role and start date.' },
        { topic: null, heading: 'Working hours', text: `The Employee's normal working hours are ${val(a, 'hours')} hours per week.`, explanation: 'Sets the normal hours of work.',
          loophole: 'Employment laws often limit working hours and require pay for overtime. Check what applies.' },
        { topic: 'pricing_escalation', heading: 'Pay', text: `The Employer will pay the Employee ${val(a, 'salary')}.`, explanation: 'Sets the pay. Check any minimum pay rules that may apply.' },
        { topic: null, heading: 'Leave', text: `The Employee is entitled to ${val(a, 'leaveDays')} days of paid annual leave per year.`, explanation: 'Sets paid holiday. Laws may set a minimum.' },
        ...(has(a, 'probationMonths') ? [{ topic: null, heading: 'Probation', text: `The first ${a.probationMonths.trim()} months of employment are a probation period.`, explanation: 'Sets a trial period.' } as SectionSpec] : []),
        { topic: 'termination_notice', heading: 'Ending employment', text: `Either party may end this contract by giving ${val(a, 'noticeWeeks')} weeks' written notice.`, explanation: 'Sets the notice period. Laws may set a minimum or require a fair reason.',
          loophole: 'Ending employment often has legal requirements beyond notice. Take advice before dismissing anyone.' },
        confidentialitySection(false),
        { topic: 'intellectual_property', heading: 'Work created in the job', text: 'All work the Employee creates in the course of employment belongs to the Employer.', explanation: 'Says the employer owns work done for it.' },
        { topic: 'governing_law', heading: 'Governing law', text: `This contract is governed by the laws of ${val(a, 'governingLaw')}.`, explanation: 'Says which law applies. Employment laws may give rights this contract cannot remove.' },
        whole,
      ];
    },
  },
  lease: {
    id: 'lease', label: 'Lease', description: 'For renting premises.',
    questions: leaseQuestions,
    build(a) {
      const val = make(leaseQuestions);
      const [our, other] = a.ourRole === 'tenant' ? ['Tenant', 'Landlord'] : ['Landlord', 'Tenant'];
      const esc = escalationText(a, val, 'rent');
      return [
        partiesSection(a, val, our, other),
        { topic: null, heading: 'Premises', text: `The Landlord lets to the Tenant the premises at ${val(a, 'premises')}${has(a, 'use') ? `, to be used only for ${a.use.trim()}` : ''}.`, explanation: 'Identifies the property and what it may be used for.' },
        { topic: 'term_renewal', heading: 'Duration', text: `The lease starts on ${val(a, 'startDate')} and lasts for ${val(a, 'termMonths')} months.`, explanation: 'Says how long the lease runs.' },
        { topic: 'pricing_escalation', heading: 'Rent', text: `The Tenant will pay rent of ${val(a, 'rent')}.${esc ? ` ${esc}` : ''}`, explanation: 'Sets the rent and any yearly increase.' },
        { topic: 'payment', heading: 'Paying rent', text: `Rent is payable in advance on or before day ${val(a, 'paymentDay')} of each month.`, explanation: 'Says when rent is due.' },
        ...(has(a, 'deposit') ? [{ topic: null, heading: 'Deposit', text: `The Tenant will pay a deposit of ${a.deposit.trim()} before the lease starts. The Landlord may use it to cover unpaid amounts or damage beyond fair wear and tear, and will refund the balance after the lease ends.`, explanation: 'Covers unpaid rent or damage.', protective: 'A deposit protects the landlord against loss.' } as SectionSpec] : []),
        { topic: null, heading: 'Upkeep', text: 'The Tenant must keep the inside of the premises in good condition, fair wear and tear excepted. The Landlord is responsible for the structure and the roof.', explanation: 'Splits responsibility for repairs.',
          loophole: 'Repair duties are a frequent source of disputes. Record the condition of the premises at the start.' },
        ...termination(a, val),
        forceMajeure, assignment, ...lawSections(a, val), whole,
      ];
    },
  },
  sales_terms: {
    id: 'sales_terms', label: 'Sales and quotation terms', description: 'Standard terms that apply to your quotes and orders.',
    questions: salesQuestions,
    build(a) {
      const val = make(salesQuestions);
      return [
        { topic: 'parties', heading: 'Who these terms apply to', text: `These terms apply to every quotation and order between ${val(a, 'ourName')}${has(a, 'ourRegistration') ? `, registration number ${a.ourRegistration.trim()}` : ''} ("Seller") and the customer named in the quotation or order ("Customer").`,
          explanation: 'Says these terms govern all quotes and orders.', loophole: "If the customer sends its own terms, make sure yours say they take priority." },
        { topic: null, heading: 'Quotations', text: `A quotation is valid for ${val(a, 'quoteValidityDays')} days from its date. A contract is formed only when the Seller accepts an order in writing.`, explanation: 'Sets how long quotes stand and when a deal is made.' },
        { topic: 'pricing_escalation', heading: 'Prices', text: a.pricesIncludeTax === 'yes' ? 'Prices in a quotation include tax.' : a.pricesIncludeTax === 'no' ? 'Prices in a quotation exclude tax, which is added where it applies.' : 'Prices in a quotation [NOT PROVIDED: whether prices include tax].',
          explanation: 'States how prices are shown.' },
        paymentSection(a, val, 'The Customer'),
        ...(has(a, 'deliveryDays') ? [{ topic: null, heading: 'Delivery', text: `Delivery dates are estimates. The Seller will usually deliver within ${a.deliveryDays.trim()} days after accepting an order.`, explanation: 'Sets expectations on delivery.' } as SectionSpec] : []),
        { topic: null, heading: 'Damaged or wrong goods', text: has(a, 'returnsDays') ? `The Customer must report damaged, missing or wrong goods in writing within ${a.returnsDays.trim()} days of delivery.` : 'The Customer must report damaged, missing or wrong goods in writing promptly after delivery.',
          explanation: 'Sets a deadline for complaints.' },
        { topic: null, heading: 'Ownership', text: a.titlePasses === 'delivery' ? 'Ownership of goods passes to the Customer on delivery.' : 'Ownership of goods passes to the Customer only when they have been paid for in full.',
          explanation: 'Says when the goods become the customer\'s.', protective: a.titlePasses === 'delivery' ? null : 'Keeping ownership until payment protects you if the customer does not pay.' },
        liabilitySection(a, val),
        forceMajeure, ...lawSections(a, val),
      ];
    },
  },
};

export function visibleQuestions(type: ContractType, a: Answers): WizardQuestion[] {
  return TYPES[type].questions.filter((q) => !q.showIf || a[q.showIf.question] === q.showIf.equals);
}
