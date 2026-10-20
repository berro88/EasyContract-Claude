// The full schema. Tables for later stages exist now so features plug in
// without migrations reshuffling tenancy. Every tenant-owned row carries
// tenant_id, and every query on it must filter by tenant_id.

export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  profile_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Password hashes only (scrypt). Never logged, never returned.
CREATE TABLE IF NOT EXISTS user_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Sessions are stored by the SHA-256 of their token; the token itself lives only in the browser cookie.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Company invites. No emails are sent: the inviter shares the link. Stored by token hash.
CREATE TABLE IF NOT EXISTS tenant_invites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','reviewer','commenter','read_only')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner','admin','reviewer','commenter','read_only')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  limits_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('ai_tokens','pages_processed')),
  quantity INTEGER NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- Per-project access. An invite is a row with accepted_at NULL.
CREATE TABLE IF NOT EXISTS project_grants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT REFERENCES users(id),
  invite_email TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','reviewer','commenter','read_only')),
  invited_by TEXT REFERENCES users(id),
  accepted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('main_agreement','amendment','addendum','increase_letter','proposal','signed_copy','other')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  document_id TEXT NOT NULL REFERENCES documents(id),
  version_number INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  page_count INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ready','unreadable')),
  quality_message TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (document_id, version_number)
);

-- Negotiation status is set by a person. File names and words like "final"
-- never make a document authoritative. No row means 'unknown'.
CREATE TABLE IF NOT EXISTS document_statuses (
  document_id TEXT PRIMARY KEY REFERENCES documents(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  negotiation_status TEXT NOT NULL CHECK (negotiation_status IN ('unknown','draft','proposed','agreed','signed','rejected')),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);

-- Which agreement an amendment, addendum or letter applies to.
CREATE TABLE IF NOT EXISTS document_links (
  document_id TEXT PRIMARY KEY REFERENCES documents(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  target_document_id TEXT NOT NULL REFERENCES documents(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS extraction_blocks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  version_id TEXT NOT NULL REFERENCES document_versions(id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  clause_number TEXT,
  text TEXT NOT NULL,
  anchor_json TEXT NOT NULL,
  flags_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_blocks_version ON extraction_blocks(tenant_id, version_id, seq);

-- A person's decision on a finding, keyed so it survives reruns and new versions.
-- The note is the user's own text about the finding, not contract text.
CREATE TABLE IF NOT EXISTS finding_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  document_id TEXT NOT NULL REFERENCES documents(id),
  finding_key TEXT NOT NULL,
  finding_title TEXT NOT NULL,
  decision TEXT CHECK (decision IN ('accepted','rejected','negotiate')),
  note TEXT NOT NULL DEFAULT '',
  wording_hash TEXT NOT NULL,
  decided_by TEXT NOT NULL REFERENCES users(id),
  decided_at TEXT NOT NULL,
  UNIQUE (document_id, finding_key)
);

-- Contract Wizard drafts. Answers are the user's own input.
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  block_id TEXT REFERENCES extraction_blocks(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Metadata only. Never store clause or document text here.
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('allowed','denied')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- Clause library. Each edit adds a version; old versions are never changed.
CREATE TABLE IF NOT EXISTS library_clauses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  topic TEXT NOT NULL,
  title TEXT NOT NULL,
  is_example INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS library_clause_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  clause_id TEXT NOT NULL REFERENCES library_clauses(id),
  version INTEGER NOT NULL,
  text TEXT NOT NULL,
  guidance TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (clause_id, version)
);

-- Playbooks: rows with the same tenant and name are versions of one playbook.
-- At most one version per tenant is active. Positions belong to a version.
CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playbook_positions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  playbook_id TEXT NOT NULL REFERENCES playbooks(id),
  topic TEXT NOT NULL,
  preferred_text TEXT,
  fallback_text TEXT,
  red_line TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signed_contracts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  document_version_id TEXT REFERENCES document_versions(id),
  title TEXT NOT NULL,
  signed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS key_dates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  signed_contract_id TEXT NOT NULL REFERENCES signed_contracts(id),
  label TEXT NOT NULL,
  due_on TEXT NOT NULL,
  source_block_id TEXT REFERENCES extraction_blocks(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS obligations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  signed_contract_id TEXT NOT NULL REFERENCES signed_contracts(id),
  description TEXT NOT NULL,
  owner_party TEXT,
  due_on TEXT,
  source_block_id TEXT REFERENCES extraction_blocks(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_provider_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  provider_key TEXT NOT NULL,
  model_id TEXT,
  data_residency TEXT NOT NULL DEFAULT 'local',
  allow_external_processing INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_acceptances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  document_key TEXT NOT NULL,
  version TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);
`;
