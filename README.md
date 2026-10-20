# EasyContract

Helps people understand the contracts they sign and write protective ones.

> **EasyContract is not a formal legal advisory tool. Consulting a legal practitioner is always advisable.**
> The usage policy is a draft and has not yet been reviewed by a lawyer.

## Run it locally

Needs Node 22+ and pnpm 10.

```bash
pnpm install
pnpm --filter @easycontract/api samples   # synthetic test contracts in ./samples
pnpm dev                                   # API on http://localhost:3001, web on http://localhost:5173
```

Open http://localhost:5173. Data is kept in `./data` (ignored by git); delete that folder to start fresh.

## Checks

```bash
pnpm test        # API and web tests
pnpm typecheck
pnpm build
```

## Docs

- [docs/PLAN.md](docs/PLAN.md): stages, scope and what's out of scope
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it fits together, and the roadmap

Use synthetic contracts only. Never commit real client documents, passwords or keys.
