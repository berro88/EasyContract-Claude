// Types and constants shared by the API and the web app.

export * from './policy.ts';

export const ROLES = ['owner', 'admin', 'reviewer', 'commenter', 'read_only'] as const;
export type Role = (typeof ROLES)[number];

export const DOCUMENT_ROLES = [
  'main_agreement',
  'amendment',
  'addendum',
  'increase_letter',
  'proposal',
  'signed_copy',
  'other',
] as const;
export type DocumentRole = (typeof DOCUMENT_ROLES)[number];

export const DOCUMENT_ROLE_LABELS: Record<DocumentRole, string> = {
  main_agreement: 'Main agreement',
  amendment: 'Amendment',
  addendum: 'Addendum',
  increase_letter: 'Increase letter',
  proposal: 'Proposal',
  signed_copy: 'Signed copy',
  other: 'Other',
};

export const THEMES = ['fun', 'normal', 'professional'] as const;
export type Theme = (typeof THEMES)[number];

export const EXPERTISE_LEVELS = ['plain', 'legal'] as const;
export type ExpertiseLevel = (typeof EXPERTISE_LEVELS)[number];

export const USAGE_KINDS = ['ai_tokens', 'pages_processed'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export type BlockKind =
  | 'paragraph'
  | 'heading'
  | 'table_cell'
  | 'tracked_insertion'
  | 'tracked_deletion';

/** Where a block lives in its source file. Enough to open the exact passage. */
export type BlockAnchor =
  | {
      format: 'docx';
      part: string; // e.g. "word/document.xml"
      paragraphId: string; // w14:paraId, or a positional fallback "p{n}"
      paragraphIdSource: 'paraId' | 'position';
      revisionId?: string; // w:id of a tracked change
      author?: string;
      date?: string;
    }
  | {
      format: 'pdf';
      page: number; // 1-based
      charStart: number; // offset into the page's extracted text
      charEnd: number; // exclusive
    };

export type BlockFlag = 'embedded_instruction';

export interface ExtractionBlock {
  id: string;
  versionId: string;
  seq: number;
  kind: BlockKind;
  clauseNumber: string | null;
  text: string;
  anchor: BlockAnchor;
  flags: BlockFlag[];
}

export type VersionStatus = 'ready' | 'unreadable';

export interface DocumentVersionSummary {
  id: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  pageCount: number | null;
  status: VersionStatus;
  qualityMessage: string | null;
  createdAt: string;
}

export interface DocumentSummary {
  id: string;
  projectId: string;
  title: string;
  role: DocumentRole;
  createdAt: string;
  latestVersion: DocumentVersionSummary | null;
  versionCount: number;
  negotiationStatus: NegotiationStatus;
  /** 'set' when a person chose it; 'role' when it follows from the role they picked. */
  statusSource: 'set' | 'role' | 'none';
  /** For amendments and letters: the agreement they apply to, if a person linked one. */
  appliesTo: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  documentCount: number;
}

export interface CompanyProfile {
  name: string;
  legalName: string;
  registrationNumber: string;
  address: string;
  country: string;
  industry: string;
  contactEmail: string;
}

export interface Me {
  user: { id: string; name: string; email: string };
  tenant: { id: string; name: string };
  role: Role;
  plan: string | null;
  policyAccepted: boolean;
}

/** A plain-English note about a block. Always points back at its source. */
export interface BlockNote {
  sourceBlockId: string;
  level: ExpertiseLevel;
  lines: string[];
}

export const TOPICS = [
  'parties',
  'term_renewal',
  'pricing_escalation',
  'payment',
  'liability_caps',
  'indemnities',
  'insurance',
  'termination_notice',
  'cure_periods',
  'confidentiality',
  'intellectual_property',
  'disputes',
  'governing_law',
  'force_majeure',
  'assignment',
  'service_levels',
  'penalties',
] as const;
export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABELS: Record<Topic, string> = {
  parties: 'Parties',
  term_renewal: 'Term and renewal',
  pricing_escalation: 'Pricing and escalation',
  payment: 'Payment',
  liability_caps: 'Liability caps',
  indemnities: 'Indemnities',
  insurance: 'Insurance',
  termination_notice: 'Termination and notice',
  cure_periods: 'Cure periods',
  confidentiality: 'Confidentiality',
  intellectual_property: 'Intellectual property',
  disputes: 'Disputes',
  governing_law: 'Governing law',
  force_majeure: 'Force majeure',
  assignment: 'Assignment',
  service_levels: 'Service levels',
  penalties: 'Penalties',
};

/** Something found in a clause, quoted exactly from it. Never calculated. */
export interface QuotedFact {
  kind: 'period' | 'amount' | 'percentage' | 'placeholder' | 'defined_term';
  label: string;
  quote: string;
  sourceBlockId: string;
}

/** A plain-English explanation of one clause. Always points back at its source. */
export interface ClauseExplanation {
  sourceBlockId: string;
  topic: Topic;
  level: ExpertiseLevel;
  whatItMeans: string;
  whoItFavours: string;
  whatToCheck: string[];
  facts: QuotedFact[];
  /** Legal view only: why the clause landed in this topic. */
  reasons?: string[];
}

export interface TopicBlockRef {
  blockId: string;
  clauseNumber: string | null;
  kind: BlockKind;
  excerpt: string;
  heading: string | null;
}

export interface TopicCard {
  topic: Topic;
  label: string;
  blocks: TopicBlockRef[];
}

export interface TopicsResponse {
  versionId: string;
  cards: TopicCard[];
  /** Topics with no matching clause: shown as "not stated" rather than hidden. */
  notFound: Topic[];
  unsorted: TopicBlockRef[];
}

// ---------- Stage 3: comparison and amendments ----------

/**
 * Where a document stands in negotiation. Set by a person, never inferred
 * from a file name or words like "final".
 */
export const NEGOTIATION_STATUSES = ['unknown', 'draft', 'proposed', 'agreed', 'signed', 'rejected'] as const;
export type NegotiationStatus = (typeof NEGOTIATION_STATUSES)[number];
export const NEGOTIATION_LABELS: Record<NegotiationStatus, string> = {
  unknown: 'Not confirmed',
  draft: 'Draft',
  proposed: 'Proposed',
  agreed: 'Agreed',
  signed: 'Signed',
  rejected: 'Rejected',
};
/** Only these statuses make wording count as agreed. */
export const AUTHORITATIVE_STATUSES: readonly NegotiationStatus[] = ['agreed', 'signed'];

export interface ClauseSide {
  blockId: string;
  clauseNumber: string | null;
  text: string;
}

export type DiffOp = { op: 'same' | 'add' | 'remove'; text: string };

export type CompareRowStatus = 'unchanged' | 'changed' | 'renumbered' | 'added' | 'removed';

export interface CompareRow {
  status: CompareRowStatus;
  /** True when a matched clause has a different number (it may also be changed). */
  renumbered: boolean;
  left: ClauseSide | null;
  right: ClauseSide | null;
  similarity: number | null;
  diff: DiffOp[] | null;
}

export interface PartyChange {
  leftBlockId: string;
  rightBlockId: string;
  from: string;
  to: string;
  message: string;
}

export interface DocumentRef {
  documentId: string;
  versionId: string;
  title: string;
  versionNumber: number;
  negotiationStatus: NegotiationStatus;
}

export interface CompareResponse {
  left: DocumentRef;
  right: DocumentRef;
  rows: CompareRow[];
  partyChanges: PartyChange[];
  summary: Record<CompareRowStatus, number>;
  warnings: string[];
}

export type ProposedSignedStatus = 'same' | 'changed_before_signing' | 'proposed_only' | 'signed_only';

/** Proposed and agreed wording are kept in separate fields and never merged. */
export interface ProposedSignedRow {
  status: ProposedSignedStatus;
  proposed: ClauseSide | null;
  agreed: ClauseSide | null;
  diff: DiffOp[] | null;
}

export interface ProposedSignedResponse {
  proposed: DocumentRef;
  agreed: DocumentRef;
  rows: ProposedSignedRow[];
  partyChanges: PartyChange[];
  warnings: string[];
}

export type InstructionKind = 'replace_clause' | 'replace_words' | 'delete_clause' | 'insert_clause' | 'unrecognised';

export interface AmendmentInstruction {
  index: number;
  kind: InstructionKind;
  clauseNumber: string | null;
  /** For replace_words: the words being replaced. */
  from: string | null;
  /** New wording, quoted exactly from the amendment. */
  to: string | null;
  sourceBlockIds: string[];
  sourceText: string;
}

export type InstructionState =
  | 'incorporated' // the latest base version already reflects it
  | 'applied' // applied on top of the base to work out the effective position
  | 'pending' // amendment not agreed, so not applied
  | 'cannot_apply'; // e.g. clause not in the base

export interface InstructionResult extends AmendmentInstruction {
  state: InstructionState;
  explanation: string;
}

export type IncorporationStatus = 'incorporated' | 'partly_incorporated' | 'not_incorporated' | 'nothing_to_incorporate';

export interface AmendmentSummary {
  document: DocumentRef;
  negotiationStatus: NegotiationStatus;
  incorporation: IncorporationStatus;
  incorporatedCount: number;
  instructionCount: number;
  instructions: InstructionResult[];
}

export interface EffectiveClause {
  clauseNumber: string | null;
  text: string;
  baseBlockId: string | null;
  /** Agreed changes applied on top of the base, oldest first. */
  changedBy: { documentId: string; title: string; instructionIndex: number; sourceBlockIds: string[] }[];
  deleted: boolean;
}

export interface EffectivePositionResponse {
  base: DocumentRef;
  baseWarning: string | null;
  clauses: EffectiveClause[];
  amendments: AmendmentSummary[];
  partyChanges: PartyChange[];
  warnings: string[];
}

export interface LetterMatchResponse {
  letter: DocumentRef;
  status: 'matched' | 'uncertain' | 'not_matched';
  agreement: { documentId: string; title: string } | null;
  clause: { blockId: string; clauseNumber: string | null; excerpt: string } | null;
  reasons: string[];
  problems: string[];
}

export const UPLOAD_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  extensions: ['.pdf', '.docx'],
} as const;
