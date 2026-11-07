# LeeTKOB

Constraint review for C++ lab submissions: hard rules first, then an LLM, then the TA reviews and
publishes marks. CSC13114 class project (brief: LeeTKOB — the class project), team
23120068 · 23120069 · 23120078.

Status: **PA#2 — harness and quality gate.** One endpoint exists, `POST /v1/labs/{labId}/publish`,
specified in [`docs/contract/publish.md`](docs/contract/publish.md) and held to it by contract tests.

## Quick start (fresh clone)

Requires Node 22 (`.nvmrc`) and npm.

```bash
git clone https://github.com/Quynhnhu0203/leetkob.git
cd leetkob
npm ci
npm run check        # lint + format check + type check + unit tests + contract tests
```

`npm run check` needs no `.env`, no network and no API key.

## Checks — one command each, the same locally and in CI

| Check          | Command                                     | CI job (required on `main`) |
| -------------- | ------------------------------------------- | --------------------------- |
| Lint           | `npm run lint`                              | `lint`                      |
| Format check   | `npm run format:check`                      | `format`                    |
| Type check     | `npm run typecheck`                         | `typecheck`                 |
| Unit tests     | `npm test`                                  | `test`                      |
| Contract tests | `npm run test:contract`                     | `contract`                  |
| Secret scan    | — (CI only, gitleaks over the full history) | `secrets`                   |

CI (`.github/workflows/ci.yml`) runs on every pull request, on `main` and on `pa*` tags. Each job
runs exactly the command in the table. `main` is protected: all six jobs are required and nothing
is pushed to it directly.

`npm run format` rewrites files with Prettier; `npm run dev` starts the API on `PORT` (default 3000)
with an empty in-memory store.

## Configuration and secrets

Copy `.env.example` to `.env` and fill it in. `.env` is git-ignored; `.env.example` lists every
variable with no value. No secret is in the repository or its history; the `secrets` CI job scans
the whole history with gitleaks on every PR.

## Model

- **Provider and model:** Google Gemini API, free tier, model `gemini-3.8-flash` (set in
  `GEMINI_MODEL`; fallback `gemini-3.6-flash`). Used from PA#3 for the semantic constraints only.
  The final choice is made on the dev set in PA#4.
- **Limits:** when the quota runs out, calls fail with 429 and the checker returns `unsure`, which
  goes to the TA's queue. The app stops calling the model for a lab after `LLM_MAX_CALLS_PER_LAB`
  calls (PA#3).
- **Cost of one lab:** not measured yet. Expected volume ≈ 80 submissions × the number of semantic
  constraints; measured and reported in `AI-LOG.md` once PA#3 runs a real lab.
- No test calls the model; unit and contract tests run offline.

## Working with the assistant

- Rules: [`CLAUDE.md`](CLAUDE.md) (stack, commands, conventions, never).
- Permissions in three tiers: [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md), enforced by
  [`.claude/settings.json`](.claude/settings.json).
- What the assistant did and what we changed or rejected: [`AI-LOG.md`](AI-LOG.md).

## Layout

```text
src/app.ts               Fastify app, error handler, unknown-path 404
src/routes/publish.ts    POST /v1/labs/{labId}/publish
src/problems.ts          RFC 9457 problem types (the table in the contract §2)
src/store.ts             Store port + in-memory implementation
test/unit/               unit tests
test/contract/           contract tests for docs/contract/*.md
docs/contract/           endpoint contracts
```
