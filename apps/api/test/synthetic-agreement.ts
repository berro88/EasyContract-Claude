// A synthetic agreement with one section per topic. Made up; not legal content.
import type { Topic } from '@easycontract/shared';

export const SECTIONS: { heading: string; clauses: string[]; topic: Topic }[] = [
  { topic: 'parties', heading: 'Parties', clauses: ['This agreement is made between Example Supplier (Pty) Ltd, registration number 0000/000000/07 ("Supplier"), and Sample Client Ltd ("Client").'] },
  { topic: 'term_renewal', heading: 'Duration', clauses: ['This agreement starts on the Effective Date and runs for an initial term of 24 months.', 'It renews automatically for further 12 month periods unless cancelled in writing at least 60 days before expiry.'] },
  { topic: 'pricing_escalation', heading: 'Fees', clauses: ['The Client shall pay a monthly fee of R12,000.', 'The fee escalates on each anniversary by [ESCALATION %].'] },
  { topic: 'payment', heading: 'Invoicing', clauses: ['The Supplier will invoice monthly in arrears and invoices are due within 30 days by electronic funds transfer.'] },
  { topic: 'liability_caps', heading: 'Limitation of liability', clauses: ["Each party's aggregate liability shall not exceed the fees paid in the 12 months before the claim.", 'Neither party is liable for indirect or consequential loss.'] },
  { topic: 'indemnities', heading: 'Indemnity', clauses: ['The Supplier indemnifies the Client against all third-party claims arising from the Supplier\'s negligence.'] },
  { topic: 'insurance', heading: 'Insurance', clauses: ['The Supplier must maintain public liability insurance with minimum cover of R5,000,000.'] },
  { topic: 'termination_notice', heading: 'Termination', clauses: ['Either party may terminate this agreement on 90 days\' written notice.'] },
  { topic: 'cure_periods', heading: 'Breach', clauses: ['If a party breaches this agreement and fails to remedy the breach within 14 days after receiving written notice, the other party may act.'] },
  { topic: 'confidentiality', heading: 'Confidentiality', clauses: ['Each party must keep the other party\'s confidential information secret and must not disclose it to any third party.'] },
  { topic: 'intellectual_property', heading: 'Intellectual property', clauses: ['All intellectual property in the deliverables vests in the Client on payment.'] },
  { topic: 'disputes', heading: 'Dispute resolution', clauses: ['Any dispute will first be referred to senior management and, if unresolved after 10 business days, to arbitration.'] },
  { topic: 'governing_law', heading: 'Governing law', clauses: ['This agreement is governed by the laws of the Republic of Exampleland.'] },
  { topic: 'force_majeure', heading: 'Force majeure', clauses: ['Neither party is liable for delay caused by events beyond its reasonable control, including flood, fire or pandemic.'] },
  { topic: 'assignment', heading: 'Assignment', clauses: ['The Supplier may not assign or cede this agreement without the Client\'s prior written consent.'] },
  { topic: 'service_levels', heading: 'Service levels', clauses: ['The Supplier must meet an uptime of 99.5% measured monthly, with response times of 4 hours.'] },
  { topic: 'penalties', heading: 'Service credits', clauses: ['If the uptime target is missed, the Supplier must give a service credit of 5% of the monthly fee.'] },
];
