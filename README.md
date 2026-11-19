# LeeTKOB

Constraint review for C++ lab submissions: hard rules first, then an LLM, then the TA reviews and
publishes marks. CSC13114 class project (brief: LeeTKOB — the class project), team
23120068 · 23120069 · 23120078.

Status: **PA#3 — Prototype with the LLM feature running.** Hard rules first, then Google Gemini (`gemini-3.8-flash`), queued sandbox judging, TA review queue, and mark publishing. Tested end-to-end with dev set and 9 sandbox attack submissions.

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
| Sandbox tests  | `npm run test:sandbox`                      | `sandbox`                   |
| Secret scan    | — (CI only, gitleaks over the full history) | `secrets`                   |

CI (`.github/workflows/ci.yml`) runs on every pull request, on `main` and on `pa*` tags. Each job
runs exactly the command in the table. `main` is protected: all six jobs are required and nothing
is pushed to it directly.

`npm run format` rewrites files with Prettier; `npm run dev` starts the API on `PORT` (default 3000)
with an empty in-memory store.

## Checker command and Docker build

```bash
# Model ON (runs hard rules, then Gemini for semantic constraints):
npx tsx src/checker-cli.ts --data eval --output predictions.jsonl

# Model OFF (hard rules only, semantic constraints output unsure, no network):
MODEL_OFF=1 npx tsx src/checker-cli.ts --data eval --output predictions.jsonl

# Build and run Docker checker container:
docker build -f Dockerfile.checker -t leetkob-checker .
docker run --rm --network none -v $(pwd)/eval:/data:ro -v $(pwd):/out leetkob-checker --data /data --output /out/predictions.jsonl

# Score predictions:
node eval/eval.mjs --data eval --predictions predictions.jsonl
```

## Configuration and secrets

Copy `.env.example` to `.env` and fill it in. `.env` is git-ignored; `.env.example` lists every
variable with no value. No secret is in the repository or its history; the `secrets` CI job scans
the whole history with gitleaks on every PR.

## Model

- **Provider and model:** Google Gemini API, free tier, model `gemini-3.8-flash` (set in
  `GEMINI_MODEL`; fallback `gemini-3.6-flash`). Used for semantic constraints only (hard rules run first).
- **Spending cap:** the key belongs to a Google AI Studio project with **no billing account
  attached** (checked in AI Studio on 2026-11-07), so it can only use free-tier quota and cannot
  incur charges: the cap is 0 VND.
- **Cost of one lab of 80 submissions (with arithmetic):**
  - Hard rules decide ban-list constraints (e.g. C1 `Do not use std::sort`) without calling the model.
  - A typical lab has 1 semantic constraint per submission (e.g. C2 `Sort with merge sort you wrote yourself`).
  - Volume = 80 submissions × 1 semantic constraint = 80 model calls.
  - Average prompt length: ~750 input tokens (statement + constraint + stripped code).
  - Average response length: ~60 output tokens (JSON verdict + evidence line).
  - Total input tokens: 80 × 750 = 60,000 tokens. Cost @ $0.075 / 1M tokens = $0.0045 (~115 VND).
  - Total output tokens: 80 × 60 = 4,800 tokens. Cost @ $0.30 / 1M tokens = $0.0014 (~36 VND).
  - **Total cost for 1 lab of 80 submissions = $0.0059 (~151 VND)**, or **0 VND** on free tier.
- **Limits and human gate:**
  - Model output validated against JSON schema; malformed output or invalid evidence becomes `unsure`.
  - Request timeouts become `unsure`.
  - All verdicts land strictly in the TA's review queue. Marks cannot be published while any verdict is unreviewed.
  - Students cannot see constraint verdicts before marks are published (following product owners' FAQ-08).
- No test calls the real model; unit and contract tests run offline with fake models.

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
