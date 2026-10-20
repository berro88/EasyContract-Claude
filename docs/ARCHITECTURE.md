# EasyContract architecture

## Product rules the code enforces

- **Not legal advice.** The usage policy (`packages/shared/src/policy.ts`, version `0.1-draft`) stays a draft until a lawyer reviews it. Its short disclaimer appears in a banner on every page and in every block and passage response, and will appear on every export.
- **Nothing invented.** Every note the AI provider produces carries `sourceBlockId`. Missing facts are "not stated".
- **Uploaded text is untrusted.** Extraction stores it verbatim. Phrases that look like instructions get the `embedded_instruction` flag and a warning. No code path turns document text into a tool or network call.
- **No paid AI.** All AI goes through `AiProvider`. Only `DeterministicProvider` exists: no network, no keys.
- **Themes never soften warnings.** Themed wording lives in `apps/web/src/lib/copy.ts`. Safety wording lives in `warnings.ts`, and safety styles use fixed colours outside the theme tokens. A test checks the two never mix.

## Layout

```
apps/api        Fastify API on :3001, SQLite via node:sqlite
  src/db          schema, seed
  src/analysis    topic sorting, quoted facts, explanation templates, clause alignment,
                  amendments, letter matching, party checks, risk findings
  src/extraction  PDF (pdfjs-dist) and DOCX (jszip + xmldom) extraction, quality checks, flags
  src/lib         access policy, storage, audit and usage helpers
  src/interfaces  extension points (see below)
  src/providers   DeterministicProvider
  src/library     clause library and playbooks (versioned), PlaybookSource
  src/ocr         optional local OCR (Tesseract)
  src/reports     Word, PDF and Excel writers
  src/wizard      Contract Wizard templates and assembly
  src/routes      tenant, projects, documents and blocks
  scripts         synthetic sample generator
apps/web        Vite + React on :5173, proxies /api to :3001
packages/shared types, constants, policy text
samples/        synthetic contracts for trying the app
```

## Multi-tenancy

- Every tenant-owned row has `tenant_id`, and every query filters on it.
- Looking up another tenant's project, document or block returns **404**, never 403, so nothing about its existence leaks. The attempt is audited in the caller's own tenant.
- Files are stored at `{tenant_id}/{sha256}`. Reads check the key's tenant prefix.

## Roles

`owner`, `admin`, `reviewer`, `commenter`, `read_only`. One module (`apps/api/src/lib/access-policy.ts`) maps actions to roles. A project grant can change a member's role on one project; owners and admins keep theirs. An invite is a `project_grants` row with `accepted_at` null.

## Data model

tenants, users, tenant_memberships, plans, subscriptions, usage_events (`ai_tokens`, `pages_processed`), projects, project_grants, documents, document_versions, extraction_blocks, comments, audit_events (metadata only, never clause text), playbooks, playbook_positions, signed_contracts, key_dates, obligations, ai_provider_configs (`provider_key`, `model_id`, `data_residency=local`, `allow_external_processing=false`), policy_acceptances (user, tenant, document key, version, accepted_at).

## Extraction and anchors

| Format | Anchor | Notes |
|---|---|---|
| DOCX | `part` + `paragraphId` (`w14:paraId`, or position when absent), plus `revisionId`, author and date for tracked changes | Tracked insertions and deletions are separate blocks. Word numbering becomes real clause numbers, including `(a)` under `3.1` → `3.1(a)`. Tables, content controls and hyperlinks are read. |
| PDF | `page` + `charStart`/`charEnd` into that page's extracted text | Paragraphs split on line-spacing gaps and clause numbers. |

Block ids are deterministic hashes of version + anchor. The passage endpoint re-reads the original file and reports `verified` when the text still matches.

Quality checks report files as "couldn't read this" (not as a success) when they have no text, fewer than 40 characters per page, or mostly non-letter text. Files are identified by content, not just extension. Old `.doc` files get a "save as .docx" message until Stage 8.

## Topics and explanations

`src/analysis/topics.ts` scores each block against keyword rules per topic. Headings ("3 Fees") add weight to the clauses numbered under them. Tracked deletions are left out because they are not current wording. Results are computed on request from stored blocks, so they always match the latest rules.

`src/analysis/explanations.ts` holds fixed templates per topic (Plain and Legal). `src/analysis/facts.ts` quotes periods, amounts, percentages, placeholders and defined terms verbatim. A test checks every explanation names its source block, every quote is a substring of that block, and no number appears in an explanation unless it appears in the clause.

## Comparison and amendments

- `src/analysis/align.ts` pairs clauses by wording similarity (strongest matches first, ties to the nearest position) and makes word-level diffs. Tracked changes are left out and reported as a warning.
- `src/analysis/amendments.ts` reads instructions with fixed patterns. Anything that mentions a clause and a change but doesn't fit a pattern is reported as "couldn't read this instruction reliably", never guessed. New wording is always quoted from the amendment.
- An instruction counts as **incorporated** when the latest version of the base already says it. The effective position is that latest version plus the agreed instructions that are not yet incorporated, applied oldest amendment first.
- Negotiation status lives in `document_statuses` and is only written by a person (`PUT /api/documents/:id/status`). With no row, a document labelled "signed copy" counts as signed and a "proposal" as proposed, because a person picked that role; everything else is "not confirmed". Only *agreed* and *signed* make wording authoritative.
- `document_links` records which agreement an amendment or letter applies to. Unlinked amendments apply to whichever base is chosen.
- `src/analysis/letters.ts` scores each candidate agreement on party names, references and "agreement dated …" phrases, then picks the clause by topic, heading and wording. `src/analysis/parties.ts` finds company names and defined terms, and flags named parties swapped for undefined terms.

## Risk findings

`src/analysis/findings.ts` runs six rules over a document's current wording (tracked changes and headings excluded), using the Stage 2 topic sorting to find the relevant clauses. Each finding carries a stable id (rule, severity and primary passages), so Stage 5 can attach decisions to it. Findings are computed on request and never stored, so they always reflect the latest rules.

Two guarantees are tested on every finding: each passage it cites exists in the document, and every number in its wording appears in the document. Periods are compared only when their units match (calendar days with calendar days); nothing is converted or added up.

## Decisions and reports

- `finding_decisions` holds one row per document and finding key. The key (rule, title, clause numbers) is version-independent; `wording_hash` fingerprints the wording of the finding's primary passages when the decision was saved, and a mismatch later sets `wordingChanged`.
- `src/reports/model.ts` is a small document model (headings, paragraphs, quotes, labels, warnings). `docx.ts` writes WordprocessingML directly, with the disclaimer in a footer referenced by the section (so it is on every page). `pdf.ts` uses pdf-lib and draws the disclaimer on every page after layout. `xlsx.ts` writes SpreadsheetML with typed cells for data and `<f>` formulas for anything derived, and sets the workbook to recalculate on open.
- Reports are generated on request and never stored.

## Clause library and playbooks

- `library_clauses` and `library_clause_versions` hold clauses; a change inserts a new version row and never updates an old one.
- Playbooks reuse `playbooks` and `playbook_positions`: rows with the same tenant and name are versions of one playbook, and `is_active` marks the single active version per tenant. Saving edits from an active version makes the new version active.
- `DbPlaybookSource` (in `src/library/store.ts`) implements `PlaybookSource`; findings read the active playbook only through it, so another source can replace it.
- The playbook rule (`playbook_deviation`) uses word similarity (0.75 for preferred or fallback) and, for red lines, exact matching of quoted words or similarity (0.6) to the whole red line. The playbook wording travels in the finding's separate `reference` field, so finding text still quotes only the document.

## Contract Wizard

- `src/wizard/templates.ts` defines each contract type: its questions (with pre-fill, essential, protective and show-if settings) and a builder that turns answers into sections. Builders insert answers verbatim and write "[NOT PROVIDED: …]" for missing ones.
- `src/wizard/engine.ts` pre-fills from the company profile, cleans answers against the question list, lists missing essentials, assembles sections (playbook, then library, then template) and converts the draft into blocks so `runFindings` can check it like an uploaded document.
- `drafts` stores each draft's type, title and answers. Contract exports reuse the Stage 5 Word and PDF writers.

## Accounts, security and deployment

- **Sign-in:** `src/lib/auth.ts` hashes passwords with scrypt, and stores sessions and invites by the SHA-256 of their random tokens, so a database leak exposes no usable token. The session cookie is HttpOnly and SameSite=Lax (and Secure in production). Writes that arrive with a cookie from another site's origin are refused.
- **Request pipeline (`src/app.ts`):** security headers → optional preview password (HTTP Basic, from `PREVIEW_PASSWORD`) → session or, outside production, the `x-user-id` dev header → policy check (session users must have accepted the current `POLICY_VERSION`) → routes. Public routes: health, policy text, sign-up, sign-in, sign-out and invite acceptance.
- **Invites** live in `tenant_invites`; accepting one adds a membership with the invited role and records the policy acceptance.
- **Logging:** Fastify's default serializers log method, URL and status only. Error logs carry the message and code only. A test feeds contract text through uploads, errors and form fields and checks none of it reaches the log.
- **.doc files** are read with `word-extractor` (`src/extraction/doc.ts`), anchored by paragraph position.
- **OCR** is an `OcrProvider` (`src/interfaces`). `TesseractCliOcr` (`src/ocr/tesseract.ts`) renders one page at a time with `pdftoppm` and reads it with `tesseract`, locally. It is used only when `OCR_ENABLED=1` and both tools are installed, and only for PDFs with no usable text layer. OCR passages are flagged `read_from_scan` with a per-passage confidence.
- **Deployment:** in production the API also serves the built web app (`WEB_DIST_DIR`), skips the demo seed and listens on `0.0.0.0`. See `docs/DEPLOY.md`.

## Extension points

Declared in `apps/api/src/interfaces/index.ts`:

| Interface | Today | Later |
|---|---|---|
| `StorageEncryption` | `IdentityEncryption` (no-op) | Encryption at rest with a managed key |
| `AiProvider` (`describeBlock`, `explainClause`) | `DeterministicProvider` | Swappable real providers, chosen per tenant via `ai_provider_configs` |
| `PlaybookSource` | `DbPlaybookSource` | Shared or connector-provided playbooks |
| `RedlineExporter` | none | Redlined Word counter-drafts from block anchors |
| `ObligationNotifier` | none | Reminders for key dates and obligations |
| `Connector` (`onedrive`, `sharepoint`, `outlook`, `esignature`, `crm`) | none | Import from and export to other systems |
| `ResearchProvider` | none | Live legal research; citations carry jurisdiction, url, provision, verification date, binding or commentary |
| `OcrProvider` | `TesseractCliOcr` (optional) | Other local OCR engines |

## Roadmap after Stage 8

Teams and sharing with clause comments; separate client accounts with usage-based billing; redlined counter-drafts; a signed-contract register with key dates, obligations and reminders; connectors; live legal research with verified citations; per-tenant AI provider choice and data residency. The schema and interfaces above already allow for these.
