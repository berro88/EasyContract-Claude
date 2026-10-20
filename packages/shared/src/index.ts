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

export const UPLOAD_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  extensions: ['.pdf', '.docx'],
} as const;
