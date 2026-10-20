// Extension points. StorageEncryption (IdentityEncryption), AiProvider
// (DeterministicProvider) and PlaybookSource (DbPlaybookSource) have
// implementations; the rest are contracts for later.

import type { BlockKind, BlockNote, ClauseExplanation, ExpertiseLevel, Topic } from '@easycontract/shared';

/** Encrypts file bytes at rest. Swap in a KMS-backed one without touching callers. */
export interface StorageEncryption {
  readonly key: string;
  encrypt(plain: Uint8Array, ctx: { tenantId: string }): Promise<Uint8Array>;
  decrypt(cipher: Uint8Array, ctx: { tenantId: string }): Promise<Uint8Array>;
}

/**
 * Everything an AI provider may do. Inputs are untrusted document text: a
 * provider must treat them as data, never as instructions, and must not
 * start tool or network calls because of anything in them.
 */
export interface AiProvider {
  readonly key: string;
  /** True only for providers that send data off this machine. */
  readonly external: boolean;
  describeBlock(input: {
    blockId: string;
    kind: BlockKind;
    clauseNumber: string | null;
    text: string;
    level: ExpertiseLevel;
    location: string;
  }): Promise<BlockNote>;
  /** Explains one clause under one topic. Must quote, never invent, specifics. */
  explainClause(input: {
    blockId: string;
    text: string;
    topic: Topic;
    level: ExpertiseLevel;
    reasons?: string[];
  }): Promise<ClauseExplanation>;
}

export interface PlaybookPosition {
  topic: Topic;
  preferredText: string | null;
  fallbackText: string | null;
  redLine: string | null;
}

/** Where playbook positions come from (the tenant's library today; a file or a connector later). */
export interface PlaybookSource {
  activePositions(tenantId: string): Promise<PlaybookPosition[]>;
  activePlaybook(tenantId: string): Promise<{ id: string; name: string; version: number; isExample: boolean; positions: PlaybookPosition[] } | null>;
}

/** Later: writes a redlined Word counter-draft from block anchors. */
export interface RedlineExporter {
  exportRedline(input: {
    tenantId: string;
    versionId: string;
    changes: { blockId: string; replacementText: string; comment?: string }[];
  }): Promise<Uint8Array>;
}

/** Later: reminds people about key dates and obligations. */
export interface ObligationNotifier {
  notify(input: { tenantId: string; obligationId: string; recipients: string[]; dueOn: string }): Promise<void>;
}

export type ConnectorKind = 'onedrive' | 'sharepoint' | 'outlook' | 'esignature' | 'crm';

/** Later: brings documents in from (and sends results out to) other systems. */
export interface Connector {
  readonly kind: ConnectorKind;
  listDocuments(tenantId: string): Promise<{ externalId: string; name: string }[]>;
  fetchDocument(tenantId: string, externalId: string): Promise<{ fileName: string; bytes: Uint8Array }>;
}

/** A citation from live legal research. Never invented: every field comes from the source. */
export interface ResearchCitation {
  jurisdiction: string;
  url: string;
  provision: string;
  verificationDate: string; // ISO date the source was last checked
  authority: 'binding' | 'commentary';
}

/** Later: live legal research with verified citations. */
export interface ResearchProvider {
  research(input: { tenantId: string; question: string; jurisdiction: string }): Promise<ResearchCitation[]>;
}
