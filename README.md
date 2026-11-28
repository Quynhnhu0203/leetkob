# LeeTKOB

Constraint review for C++ lab submissions: hard rules first, then an LLM, then the TA reviews and
publishes marks. CSC13114 class project (brief: LeeTKOB — the class project), team
23120068 · 23120069 · 23120078.

Status: **PA#3 — Prototype with the LLM feature running.** Hard rules first, then Google Gemini (`gemini-3.8-flash`), queued sandbox judging, TA review queue, and mark publishing.

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
| Sandbox tests  | `REQUIRE_DOCKER=1 npm run test:sandbox`     | `sandbox`                   |
| Secret scan    | — (CI only, gitleaks over the full history) | `secrets`                   |

CI (`.github/workflows/ci.yml`) runs on every pull request, on `main` and on `pa*` tags. `main` is protected: all required status checks must pass before merging.

## Deployment (with Docker sandbox)

Copy `.env.example` to `.env`, set `GEMINI_API_KEY`, `GEMINI_MODEL`, and `LLM_MAX_CALLS_PER_LAB`, then launch with Docker Compose on any Docker host:

```bash
docker build -f Dockerfile.sandbox -t leetkob-sandbox:latest .
docker compose up --build -d
```

Note: Sandbox containers run isolated with `--network none`, `--ulimit cpu`, wall-clock kill, `--memory 256m --memory-swap 256m`, `--pids-limit 16`, output size cap, `--user 1000:1000`, `--read-only`, `--cap-drop ALL`, and clean environment (`PATH` only; `GEMINI_API_KEY` never reaches any sandbox container).

## Checker command and Docker build

```bash
# Model ON (runs hard rules first, then Gemini for semantic constraints; loads .env):
npx tsx src/checker-cli.ts --data eval --output predictions.jsonl --log call-log.jsonl

# Model OFF (hard rules only, semantic constraints output unsure, zero network):
MODEL_OFF=1 npx tsx src/checker-cli.ts --data eval --output predictions.jsonl

# Build standalone checker container image:
docker build -f Dockerfile.checker -t leetkob-checker .

# Run checker image with MODEL_OFF=1 on any mounted dataset:
mkdir -p out
docker run --rm --network none -e MODEL_OFF=1 -v $(pwd)/eval:/data:ro -v $(pwd)/out:/out leetkob-checker --data /data --output /out/predictions.jsonl

# Score predictions with eval.mjs:
node eval/eval.mjs --data eval --predictions out/predictions.jsonl
```

## Configuration and secrets

Copy `.env.example` to `.env` and fill it in. `.env` is git-ignored; `.env.example` lists every
variable with no value. No secret is in the repository or its history; the `secrets` CI job scans
the whole history with gitleaks on every PR.

## Model

- **Provider and model:** Google Gemini API, free tier. Primary model `gemini-3.8-flash` (set in
  `GEMINI_MODEL`); when it times out or answers 429/5xx the client falls back, in order, to
  `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-flash-lite-latest` (which answers as
  `gemini-3.5-flash-lite`). Every call log entry names the model that actually answered. Used for
  semantic constraints only (hard rules decide ban lists without calling the model).
- **Models in the committed dev-set run** ([`dev-set-run/`](dev-set-run/)): `gemini-3.8-flash`
  timed out or hit the free-tier daily quota, so the 47 answers came from `gemini-3.6-flash` (24),
  `gemini-3-flash-preview` (18) and `gemini-3.5-flash-lite` (5).
- **Spending cap:** the key belongs to a Google AI Studio project with **no billing account
  attached** (checked in AI Studio on 2026-11-07), so it can only use free-tier quota and cannot
  incur charges: the cap is 0 VND. Per-lab cap `LLM_MAX_CALLS_PER_LAB` is enforced in code ([`src/reviewer/limits.ts`](src/reviewer/limits.ts)).
- **Prices used** (Gemini Developer API, paid tier, Standard, USD per 1M tokens, from
  [aistudio.google.com/docs/pricing](https://aistudio.google.com/docs/pricing), read 2026-11-28;
  output includes thinking tokens; coded in [`src/model/pricing.ts`](src/model/pricing.ts)):

  | Model                                  | Input                       | Output                      |
  | -------------------------------------- | --------------------------- | --------------------------- |
  | `gemini-3.8-flash`, `gemini-3.6-flash` | 0.75 (1.50 from 2027-01-01) | 3.75 (7.50 from 2027-01-01) |
  | `gemini-3-flash-preview`               | 0.50                        | 3.00                        |
  | `gemini-3.5-flash-lite`                | 0.30                        | 2.50                        |

- **Cost of one lab of 80 submissions (with arithmetic):**
  - Ban-list constraints (e.g. `C1: Do not call ...`) are decided by hard rules: 0 calls.
  - One call per semantic constraint per Accepted submission. `sort-merge` has one (`C2`), so at
    most 80 × 1 = 80 calls (fewer if some submissions are not Accepted). With _k_ semantic
    constraints, multiply by _k_.
  - Tokens per call, measured on the 47 calls of the committed run: 933.8 input, 36.7 output on
    average; we round to 934 and 37.
  - Input: 80 × 934 = 74,720 tokens × \$0.75 / 1M = \$0.05604.
  - Output: 80 × 37 = 2,960 tokens × \$3.75 / 1M = \$0.01110.
  - **Total with `gemini-3.8-flash`: \$0.0671 per lab** (≈ 1,750 VND at 26,000 VND/USD);
    \$0.1343 from 2027-01-01, when the promotional rate ends.
  - Thinking tokens are billed as output, and the committed run did not record them (the client
    read `thoughtsTokenCount` only from 2026-11-28). If each call thought for 500 tokens, output
    would be 80 × 537 = 42,960 tokens × \$3.75 / 1M = \$0.1611 and the lab \$0.2171.
  - **What we pay: 0 VND.** The key's project has no billing account, so it can only use the
    free tier (see Spending cap); the figures above are what the same calls would cost on the
    paid tier.
- **Limits and human gate:**
  - Model output is checked against a strict JSON schema; malformed output or mismatched evidence becomes `unsure` ([FAQ-09](https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-09)).
  - Timeouts and cost-cap overruns become `unsure`.
  - Verdicts land only in the TA's review queue; publishing marks refuses (`409 reviews-pending`) while any item is unreviewed ([FAQ-12](https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-12)).
  - Students cannot see constraint review verdicts before publishing ([FAQ-08](https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-08)).
- No unit or contract test calls the real model; unit and contract tests run offline.

## Working with the assistant

- Rules: [`CLAUDE.md`](CLAUDE.md) (stack, commands, conventions, never).
- Permissions in three tiers: [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md), enforced by
  [`.claude/settings.json`](.claude/settings.json).
- What the assistant did and what we changed or rejected: [`AI-LOG.md`](AI-LOG.md).

## Layout

```text
src/app.ts               Fastify app setup, error handler, unknown-path 404
src/server.ts            Server entrypoint starting API + background JudgeWorker
src/checker-cli.ts       Standalone CLI checker with MODEL_OFF=1 support
src/sandbox/runner.ts    Docker sandbox runner enforcing the 9 security minimums
src/queue/               FIFO queue and idempotent background worker
src/reviewer/hard-rules.ts  Syntax-aware C++ ban-list analyzer
src/reviewer/limits.ts   Schema validation, async timeout, evidence match, cost cap
src/model/               Comment/ID stripper, prompt builder, Gemini client + call log
src/routes/              /v1 labs, submissions, reviews, publish endpoints
src/ui/html.ts           Single-page TA & student demo UI (FAQ-06/08/09)
test/attacks/            9 C++ attack submissions testing sandbox minimums
test/unit/               Unit tests
test/contract/           Contract tests
docs/contract/           Endpoint contracts
```
