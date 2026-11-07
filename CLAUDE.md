# CLAUDE.md — LeeTKOB

Rules for the coding assistant (Claude Code) in this repo. Keep it short; every line must earn its place.
Permissions (allowed / ask first / never) are in `docs/PERMISSIONS.md` and enforced by `.claude/settings.json`.

## Stack

- TypeScript (strict) on Node 22, Fastify 5, Vitest 3, ESLint 9 (typescript-eslint), Prettier 3.
- One HTTP API under `/v1`. Storage behind the `Store` port (`src/store.ts`); in-memory until PA#3.
- LLM (from PA#3): Google Gemini, free tier, key only in `.env` as `GEMINI_API_KEY`.

## Commands

Same commands locally and in CI (`.github/workflows/ci.yml`). Run all before saying "done".

| Check        | Command                 |
| ------------ | ----------------------- |
| Lint         | `npm run lint`          |
| Format check | `npm run format:check`  |
| Type check   | `npm run typecheck`     |
| Unit tests   | `npm test`              |
| Contract     | `npm run test:contract` |
| All of them  | `npm run check`         |

## Conventions

- `docs/contract/*.md` is the spec. Code follows the contract; to change behaviour, change the
  contract first in its own commit that says why, then the tests, then the code.
- Every 4xx/5xx is RFC 9457 problem details built with `sendProblem()`; `detail` never carries a
  stack trace, SQL, a path, a token or another user's data.
- A lab of another class answers `404 not-found`, identical to a missing lab — never `403`.
- Branch from `main`, open a PR, merge only when every required check is green. No direct push.
- A new test must be seen failing once: break the code on purpose, watch it go red, restore.
  (AI-LOG #3: a test was written that could never fail.)
- To inject a fault, subclass `InMemoryStore`; never `{ ...store }` — spreading a class instance
  drops its methods and the test passes for the wrong reason. (AI-LOG #2.)
- Edit source with the editor tool, not `sed`/`python` string replacement: escapes such as `\b`
  and `\d` get mangled. (AI-LOG #1: a leak-check regex silently lost its escapes.)
- Branch naming: use `feature/<description>`, `fix/<description>`, `test/<description>`, `docs/<description>`, or `chore/<description>`.
- Commit messages: use `<type>: <short description>` with types such as `feat`, `fix`, `test`, `docs`, `refactor`, and `chore`.
- Pull requests: keep one logical change per PR; describe the change, tests run, and any contract impact.
- Contract changes: update `docs/contract/` before implementation and clearly mention the contract change in the PR.
- Before merge: run `npm run check` locally and ensure all required CI checks are green.
- Keep `.gitattributes` (`eol=lf`). Before claiming "a fresh clone is green", clone it on Windows
  with `core.autocrlf=true` and run `npm run check`. (AI-LOG #8: format check failed on all 24 files.)

## Never

- Never put a secret in the sandbox: no API key, token or `.env` value reaches the container that
  runs student code — not in env vars, files, args or mounts.
- Never call the real model in unit or contract tests; use a fake behind the same interface.
- Never edit a test, the eval data (`eval/`), a label or `docs/contract/` to make a check pass.
  If a check is wrong, say so and stop.
- Never let the model decide a deduction or publish marks; the TA does both.
- Never send student names or IDs to the model; only statement, constraints, stripped code.
- Never read, print or commit `.env`; never commit a key, even in a test fixture.
- Never weaken CI to get green: no `continue-on-error`, `|| true`, skipped tests, or removed jobs.
