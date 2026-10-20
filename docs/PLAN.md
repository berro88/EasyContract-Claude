# EasyContract build plan

EasyContract helps people understand the contracts they sign and write protective ones. It is **not a formal legal advisory tool**; consulting a legal practitioner is always advisable.

We build one stage at a time. Every stage ends with a working flow and tests. Nothing past the current stage is built except types, schema and empty states.

## Stages

| Stage | What it delivers | Status |
|---|---|---|
| 0 | Context, architecture, roadmap (this file and `ARCHITECTURE.md`) | Done |
| 1 | Understand a contract: projects, upload with document roles, PDF/DOCX extraction, source viewer, quality checks, audit and usage | Done |
| 2 | Clause navigation into topic cards, plain-English explanations from templates | Done |
| 3 | Version comparison, amendment reconciliation, letter matching | Done |
| 4 | Clause interactions and red/amber/green risk findings | Next |
| 5 | Human decisions on findings; Word, PDF (and Excel) exports with the disclaimer | |
| 6 | Versioned clause library and playbooks | |
| 7 | Contract Wizard (create a contract) | |
| 8 | Sign-up with policy acceptance, invites, hardening, .doc and optional OCR, private-preview deploy config | |

## Stage 1 scope

In scope:
- pnpm monorepo: `apps/api` (Fastify + `node:sqlite`), `apps/web` (Vite + React), `packages/shared`.
- Full schema with `tenant_id` on every tenant-owned row; seed with one demo tenant, one owner, `local_unlimited` plan, and a second tenant only for isolation tests.
- Dev sign-in through the `x-user-id` header.
- Home with "Understand a contract" and "Create a contract" (coming-soon page).
- Company profile page, theme switcher (Fun, Normal, Professional), Plain/Legal detail switch, persistent draft usage-policy banner.
- Guided flow: create a project, upload documents, give each a role.
- Extraction: PDF text layer (page + character span anchors) and DOCX (part + paragraph id anchors), tracked insertions and deletions as separate blocks, Word auto-numbering turned into clause numbers.
- Source viewer: document on the left, panel on the right. Clicking a passage re-opens it from the original file and checks it still matches.
- Quality checks: scans and near-empty text are reported as "couldn't read this"; file type is checked by content; size limit.
- Audit rows for project create, upload and denied access. `pages_processed` usage events.
- Text in uploaded documents is data: phrases that look like instructions are flagged, never followed.

Out of scope for Stage 1:
- Topic sorting, explanations of meaning, findings (Stages 2 and 4).
- Comparisons and amendments (Stage 3).
- Exports (Stage 5), playbooks (Stage 6), the wizard (Stage 7).
- Real sign-up, invites, OCR, `.doc` files, deployment (Stage 8).
- Any paid or external AI.

## Stage 2 scope

In scope:
- Rule-based sorting of clauses into 17 topic cards (parties, term and renewal, pricing and escalation, payment, liability caps, indemnities, insurance, termination and notice, cure periods, confidentiality, IP, disputes, governing law, force majeure, assignment, service levels, penalties). A clause's own wording counts, plus the heading of the section it sits under. A clause can sit in more than one card.
- Topics with no matching clause are listed as "not stated", not hidden. Passages that match nothing are listed as unsorted.
- For each clause and topic, a template explanation through `AiProvider.explainClause`: what it means, who it favours (read only from the wording, "not clear" otherwise), what to check. Figures, placeholders and defined terms are quoted exactly from the clause, never calculated.
- The Legal view gives fuller wording, a longer checklist, the reasons for the topic and the technical location.
- Left navigation: Documents (with the project's other documents), Topics, Findings (empty state).

Out of scope for Stage 2: comparing documents, risk findings, decisions, exports.

## Stage 3 scope

In scope:
- **Version vs version.** Any two versions (of one document, or two documents) compared clause by clause. Clauses are paired by what they say, so renumbered clauses still match; changed clauses get a word-level redline.
- **Base agreement plus amendments.** Amendment instructions are read ("Clause 3.1 is amended by replacing … with …", "deleted and replaced with the following", "a new clause … is inserted", "is deleted"). Agreed amendments are applied on top of the latest version of the base agreement to show the effective position, quoting the amendment's wording. Each instruction is checked against the base: already incorporated, applied, not applied (not agreed), or can't be applied (with the reason).
- **Incorporation tracked separately from negotiation.** Each amendment shows its negotiation status (set by a person) and whether the base already reflects it: fully, partly (for example 2 of 3) or not.
- **Proposed vs signed.** Proposed and agreed wording are returned in separate fields and shown in separate columns, never merged. Which side is agreed comes only from the status a person set (or the "signed copy" or "proposal" role they picked), never from a file name or the word "final". If neither or both are marked agreed, it refuses and says why.
- **Letters without clause numbers** are matched to an agreement and clause using party names, references, dates, topic, headings and wording. Each match lists its reasons; a failed or doubtful match says why in plain English.
- **Party changes.** A named party replaced by a term the newer wording never defines (e.g. "Sample Client Ltd" → "the Client") is flagged.
- Project page: status and "applies to" for each document, and uploading a new version.

Out of scope for Stage 3: risk findings (Stage 4), decisions and exports (Stage 5).

## Try it

```bash
pnpm install
pnpm --filter @easycontract/api samples   # writes synthetic contracts to ./samples
pnpm dev                                   # API on :3001, web on :5173
```

Open http://localhost:5173, choose **Understand a contract**, and upload the files from `samples/`. `sample-master-services-agreement.docx` has one section per topic. For Stage 3, add `sample-amendment-1.docx` (role: Amendment), `sample-msa-proposal-FINAL.docx` (Proposal) and `sample-msa-increase-letter.pdf` (Increase letter), mark the agreement and amendment as Signed, then open **Compare and reconcile**.
