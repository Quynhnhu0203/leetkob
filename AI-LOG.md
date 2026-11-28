# AI-LOG — PA#2

## Tools

| Tool                                                                | Used for                                                                                                                               |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code (Claude Opus 5.5) in VS Code                            | Read the brief and the rubric; scaffold; `CLAUDE.md`; permissions; contract; contract tests; CI; README; drafts of PA2.md and this log |
| GitHub CLI (`gh`), run by the assistant after we approved each step | Creating the public repo, pushing branches, opening PRs, the `pa2` tag (it was refused a merge: #6)                                    |
| GitHub web UI, by us                                                | Branch protection on `main` and its screenshots; **every merge** into `main`                                                           |
| Google Gemini                                                       | Not used yet. The app's model from PA#3 (free tier, see README)                                                                        |

Decisions we made, not the assistant: endpoint = `POST /labs/{labId}/publish`; stack =
TypeScript/Node; model = Gemini. The team conventions in `CLAUDE.md` (branch and commit naming,
one change per PR, contract changes called out, check before merge) are ours, added in PR #5.

## Changed / Rejected

Numbered entries are referenced from `CLAUDE.md`.

### #1 — A leak-check regex that silently lost its escapes (Changed)

The contract test helper checks that no problem `detail` leaks a stack trace, SQL or a token:
`/at .+\.(ts|js):\d+|SELECT|node_modules|-token\b/i`. The assistant edited that line twice with
scripted replacements instead of the editor. The first time (a Python string) `\b` became a
backspace character; ESLint `no-control-regex` failed on it. The "fix" with `sed` then stripped
every backslash, giving `/at .+.(ts|js):d+|...|-tokenb/i` — **lint and all 44 tests were green**,
but the check could no longer match a stack trace (`\d` had become a literal `d`). We caught it by
reading the line back, not from a check. Fixed with the editor tool; `CLAUDE.md` now says to edit
source with the editor, not `sed`/`python`.

### #2 — A 500 test that passed for the wrong reason (Changed)

To test `500 internal`, the first draft built a failing store as `{ ...store, userByToken: () =>
reject(...) }`. Spreading a class instance copies no prototype methods, so `store.lab` etc. were
`undefined`. The test still went green — the route crashed on `undefined is not a function`, which
also maps to 500 — so it proved nothing about the error we meant to inject. Replaced with a
`BrokenStore extends InMemoryStore` subclass. `CLAUDE.md` rule added.

### #3 — A test that could never fail (Rejected)

The assistant wrote "the replay is served even after the lab would no longer pass the checks", which
published, published again and expected 200 — exactly the plain replay test, with no state change
in between, because the in-memory store has no way to add a pending verdict after publishing. We
deleted it rather than keep a test whose name promises more than it checks. Since then every new
contract test is checked by breaking the code on purpose. Before the first push we ran five
mutations on a scratch copy; each was caught:

| Mutation of `src/routes/publish.ts`              | Contract tests failing |
| ------------------------------------------------ | ---------------------- |
| other class's lab answers `403` instead of `404` | 3                      |
| `reviews-pending` check disabled                 | 1                      |
| replay without `Idempotent-Replayed`             | 1                      |
| admin allowed to publish                         | 1                      |
| open lab publishable                             | 2                      |

### #4 — Endpoint behaviour the brief leaves open (Changed)

The assistant's first plan let an `admin` publish. We kept the brief's wording — the TA presses
Publish — so admin gets `403 forbidden`. Admin publishing, publishing before the lab closes and
unpublishing are listed in the contract §6 as assumptions until the product owners' FAQ answers.

### #5 — A contract job that would have been red on `main`, and the fix we rejected (Rejected)

The first bootstrap commit had the `contract` CI job but no file under `test/contract/`, because the
endpoint and its tests were meant to arrive in PR #1. We noticed before pushing that
`vitest run test/contract` exits 1 with "No test files found", so `main` would start red. The quick
fix, `--passWithNoTests`, was rejected: it turns the contract job into a check that passes when the
tests are missing, which is the "CI step that can never fail" in a different form. Instead the
contract (`docs/contract/publish.md`) went into the bootstrap commit, contract-first, together with
`test/contract/conventions.contract.test.ts`, which tests what already existed (unknown `/v1` paths
answer `404` problem details).

### #6 — The assistant tried to merge PR #1 itself (Rejected)

Once PR #1 was green the assistant ran `gh pr merge 1 --merge`. Claude Code's permission check
refused it ("merge without review"), which matches our own tiers: `gh pr merge` is _ask first_ in
`docs/PERMISSIONS.md`. A team member merged it in the GitHub UI with a merge commit (`1d2e874`), so
the red commit `4d32388` and the green commit `0194202` both stay in `main`'s history.

### #7 — How the gate was shown to bite

- **Red check stopped a merge.** PR #1 was pushed one commit at a time. Commit `4d32388` (tests
  only) → `contract` red, 33 of 46 failing, merge state `BLOCKED`
  ([run](https://github.com/Quynhnhu0203/leetkob/actions/runs/42363332790)). Commit `0194202`
  (implementation only) → all six green
  ([run](https://github.com/Quynhnhu0203/leetkob/actions/runs/42363544068)).
- **Deliberate contract break.** PR #2, commit `38d6e23`, changes only `src/routes/publish.ts` so
  that a TA of another class gets `403 forbidden` instead of `404 not-found` (contract §4.1).
  Three contract tests failed — the ownership test, its mirror, and the order-of-checks test —
  and the merge was blocked
  ([run](https://github.com/Quynhnhu0203/leetkob/actions/runs/42363793011)). PR closed unmerged.

### #8 — "A fresh clone is green" was false on Windows (Changed)

Reviewing for the rubric line "a fresh clone that follows the README gets them green", the
assistant cloned the tagged repo into an empty folder on our Windows machine and ran `npm ci` and
`npm run check`. `format:check` failed on **all 24 files**. Git for Windows defaults to
`core.autocrlf=true`, so the clone had CRLF line endings, and Prettier expects LF. Our own working
copy never showed it because the repo had `core.autocrlf=false` set locally from the first commit,
and CI runs on Linux. Fixed in PR #6 with `.gitattributes` (`* text=auto eol=lf`), verified by a new
clone with `core.autocrlf=true`. The same PR untracked a `desktop.ini` that Windows had dropped into
`docs/img/` and we had committed. `CLAUDE.md` now says how to check a fresh clone.

### #9 — The contract's `Location` pointed nowhere (Changed)

Re-reading the contract as a stranger would: `201` and `200` sent
`Location: /v1/labs/{labId}/publication`, but no such endpoint existed, so a client that followed
it got `404`. A body over Fastify's size limit also fell through to `500 internal`, an error the
contract never names. We fixed both in PR #7 in the order `CLAUDE.md` asks: contract first
(`86cde20`, §4.3 step 0 `413 payload-too-large`, §4.8 `GET …/publication`), then the tests, red
(`b5d49aa`, 5 failing), then the code (`b7818bd`). Three mutations of the new code were each caught.
In that PR the assistant again edited `src/problems.ts` with a Python replacement, against the rule
from #1; the line had no escapes and the tests confirmed it, but the rule was broken.

### #10 — A spending-cap claim written before it was true (Changed)

The assistant's README said the key's project had no billing account and the cap was 0 VND before
we had created a key at all. We removed the claim (PR #8), created the key in an AI Studio project
with no billing account, checked it in AI Studio on 2026-11-07, and only then put the sentence back
with that date.

## What we checked ourselves

- Every line of `CLAUDE.md` and `docs/contract/publish.md` against the brief §3–§4 and the rubric.
- That `npm run check` is green on a fresh clone with no `.env`, on Windows with
  `core.autocrlf=true` (after #8).
- That the Gemini key's project has no billing account attached (AI Studio, 2026-11-07).
- The Gemini model and its free-tier status on the official pricing page (2026-11-07):
  `gemini-2.5-flash`, our first choice, is deprecated and reroutes to `gemini-3.5-flash-lite` from
  2026-12-01, so the README now names `gemini-3.8-flash`.

## PA#3 — Prototype with the LLM feature running

### Tools

| Tool                                                    | Used for                                                                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code / Antigravity                               | Architecture, Queue & Worker implementation, syntax-aware hard rules, Gemini model client, prompt stripper, limits guardrails, checker CLI, Dockerfiles, test suite, and PA3 documentation |
| Google Gemini API (`gemini-3.8-flash` + fallback chain) | Semantic constraint reviews on dev set (`gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-3.5-flash-lite`); real 47-call run committed with provider request ids, tokens, and cost     |
| Docker                                                  | Building and validating hardened sandbox image (`Dockerfile.sandbox`) and checker image (`Dockerfile.checker`)                                                                             |
| Git & GitHub Actions CI                                 | Committing one part per commit, verifying CI workflows and branch protection on `main` and `pa*` tags                                                                                      |

### Changed / Rejected

### #11 — AST syntax-aware parser vs. regex on comments/strings/namespaces (Changed)

The assistant's initial draft checked ban lists using regex searches for `\bstd::sort\b`. On `sort-merge/s03.cpp` (which has `// de bai cam dung std::sort nen tu viet ham sort rieng`), the regex matched the comment and predicted a violation, causing a wrongful deduction. It also triggered on string literals like `"std::sort is not allowed"`. We rejected the regex approach and replaced it with a syntax-aware C++ scanner (`src/reviewer/hard-rules.ts`). The scanner strips comments and string literals, tracks 1-based original line numbers, checks scope and namespaces (`using namespace std` vs `namespace my { void sort() }`), and recognizes student-defined functions. Running against the dev set produced 0 wrongful deductions.

### #12 — Memory limit attack compiler optimization elimination (Changed)

In `attack-4-memory.cpp`, the initial version allocated a 512 MiB vector `std::vector<char> v(512 * 1024 * 1024);` but never read from it. Under `g++ -O2`, the compiler can eliminate unused allocations or avoid touching virtual pages, allowing the process to terminate without exceeding the 256 MiB memory limit. We caught this from the rubric requirement ("the test reads back the memory it allocates, so the compiler cannot remove the allocation") and updated the attack code to step through memory every 4096 bytes: `for (size_t i = 0; i < sz; i += 4096) sum += mem[i]; std::cout << sum;`. This forces physical allocation and guarantees kernel OOM killer (exit 137) terminates the container.

### #13 — Rejection of hardcoded dev-set problem IDs in prompt and rules (Rejected)

The assistant drafted a prompt builder that included the dev-set problem name (`sort-merge`). We rejected this: the rubric explicitly warns against prompts or rules that name dev-set problems or quote dev-set code ("tuned to the dev set; it will not survive new problems"). The prompt builder (`src/model/prompt.ts`) and checker CLI (`src/checker-cli.ts`) were rewritten to work strictly from `statement.md` and `constraints.json` without any hardcoded problem IDs.

### #14 — Worker queue exactly-once judging idempotency (Changed)

When testing the worker restart requirement ("stop the worker, submit, start the worker again"), re-enqueuing an existing submission caused duplicate review items to be inserted into `reviewItems`. We modified `store.setSubmissionJudged` to be an atomic check-and-set operation: if `sub.status === 'judged'`, judging is skipped and no duplicate review items are added. This guarantees that stopping and restarting the worker judges each submission exactly once.

### #15 — Prettier formatting modifying dev set file hashes (Changed)

Running `npm run format` initially reformatted `eval/eval.mjs`, changing its byte-for-byte SHA-256 hash. The rubric verifies `eval.mjs starts c836edd8713521bb, labels.jsonl starts 262cda7b0ef5612e`. We immediately restored the published copy and added `eval`, `eval-own`, and `leetkob-eval` to `.prettierignore` and `eslint.config.js`. Verified by calculating SHA-256 on disk matching published upstream.

### #16 — Audit caught fake call log, placeholder URLs, and non-executing sandbox tests (Rejected & Fixed)

During pre-submission verification, a strict audit caught several critical defects left by the prior automated pass:

1. `dev-set-run/call-log.jsonl` lacked `prompt` / `rawResponse` fields and contained uniform synthetic token counts (`28` / `65`), and `PA3.md` pointed to unverified Render / YouTube URLs. We rejected and removed the synthetic call log rather than submitting fabricated logs.
2. `test/unit/sandbox.test.ts` previously only checked attack source strings via `fs.readFileSync` without running Docker containers, and `runner.ts` omitted `--ulimit cpu`, container cleanup on `OLE`, and UID permissions for `/workspace` on GitHub Runners. We fixed `runner.ts`, required live Docker execution in CI via `REQUIRE_DOCKER=1`, and updated `attack-5-process-limit.cpp` so child slots stay occupied cleanly.
3. `src/routes/submissions.ts` invoked `worker.processNext()` directly inside `POST`, defeating worker pause/resume separation. We decoupled HTTP enqueue from `worker.start()` and added an API test verifying `status` stays `queued` while the worker is stopped.
4. `src/reviewer/limits.ts` accepted `timeoutMs` without enforcing it, and `src/reviewer/hard-rules.ts` used `.includes()` inside macro bodies (`#define X before` falsely triggering `for`), lacked multi-level `std::ranges::` namespace tokens, and missed complex return types. All of these were tested red-first and fixed.
5. `src/ui/html.ts` concatenated raw evidence lines into HTML (stored XSS risk) and lacked the `FAQ-06` submission notice and lab picker; fixed with `escapeHtml` and `GET /v1/labs`.

### #17 — Empty env fallback, line-numbered prompts, and per-attempt fallback timeouts (Changed)

Running the real dev-set evaluation against our `.env` uncovered three live integration bugs:

1. **Empty `GEMINI_MODEL=` in `.env` (`404` bug):** `.env` left `GEMINI_MODEL=` blank, and `src/model/client.ts` used `??` instead of `||`, sending requests to `/v1beta/models/:generateContent`. Fixed `||` fallbacks across `client.ts`, `server.ts`, and `checker-cli.ts`, and ensured fresh CLI runs truncate stale logs cleanly.
2. **Evidence line-number grounding:** Unnumbered code inside the prompt forced LLMs to count source lines manually, risking evidence line mismatch against `reviewConstraints` exact-line validation. Added 1-based line prefixes (`1 | ...`) in `src/model/prompt.ts` while stripping identity/comments verbatim.
3. **Shared `AbortController` blocking fallback on timeout:** Under high load, `gemini-3.8-flash` timed out after 25s, aborting the shared `AbortSignal` before fallback models (`gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-flash-lite-latest`) could run. Refactored `GeminiModelClient.call` to give each candidate its own attempt timer inside the total `timeoutMs` budget (tested red-first in `test/unit/model.test.ts`). On Free Tier (20 RPD per model), resuming the 23 errored calls from Pass 1 through `runChecker` achieved `0` wrongful deductions, `100.0% (37/37)` recall, and `0.0% (0/102)` unsure rate (`$0.003809` total cost across 47 real API calls).

### #18 — Sibling Docker TMPDIR bind-mount and API validation hardening (Changed)

While preparing `docker-compose.yml` for public deployment, we caught a sibling-container workspace mismatch: `app` wrote submissions to `/tmp/leetkob-judge-...` inside its container while spawning `docker run -v /tmp/leetkob-judge-...:/workspace` against `/var/run/docker.sock` on the host, where that directory did not exist. We mapped a dedicated shared staging path (`TMPDIR=/tmp/leetkob-sandbox` mounted identically into `app`), ensured `judgeInSandbox` initializes `os.tmpdir()` recursively, aligned `src/server.ts` `LLM_TIMEOUT_MS` to `25000ms` so multi-model fallback can finish before the review limit fires, and rejected invalid `closesAt` dates, negative/non-finite deductions, and cross-class TA submissions.

### #19 — CI Docker run exposed missing stdin forwarding (`-i`), Alpine `/root` stat false positive, and missing image check (Fixed)

Running the real Docker sandbox suite in GitHub Actions uncovered three container-runtime defects that did not appear without `leetkob-sandbox:latest`:

1. **`docker run` lacked `-i` (`src/sandbox/runner.ts`):** Without `-i`, Docker closed stdin immediately, causing compliant C++ programs reading `std::cin` (like `baseline` and `sort-merge`) to hit EOF and score `WA`. Added `-i` to `buildDockerRunArgs` and asserted it in `test/unit/sandbox.test.ts`.
2. **`attack-8-no-mounts.cpp` checked `stat("/root")`:** Every Alpine image contains an empty mode-`0700` `/root` directory, so `stat("/root")` falsely reported a host mount even when UID 1000 could not open it. Replaced the `/root` `stat` check with `opendir("/root")` plus `/proc/mounts` inspection against an allowlist (`/` + `/tmp` + `/workspace` + `/sbin/docker-init` + `/etc/{hosts,hostname,resolv.conf}` + `/proc/*`, `/sys/*`, `/dev/*`) and `docker.sock` checks.
3. **`npm test` vs `npm run test:sandbox` in CI:** Ubuntu runners already have Docker running, so `isDockerDaemonAvailable()` returned `true` even in the `test` job where `Dockerfile.sandbox` is not built. Added `isSandboxImageAvailable()` so container tests require both daemon and `leetkob-sandbox:latest` image (and fail loudly when `REQUIRE_DOCKER=1`).

### #20 — Cost per call used a flat, outdated price and ignored thinking tokens (Changed)

`src/model/client.ts` priced every call at `$0.075` / `$0.30` per 1M input / output tokens, whatever model answered. The README's lab-of-80 estimate used the same rates (`$0.0059` per lab). When we checked the rates against [aistudio.google.com/docs/pricing](https://aistudio.google.com/docs/pricing) on 2026-11-28, they matched none of our models: 3.8 / 3.6 Flash cost `$0.75` / `$3.75` (doubling on 2027-01-01), 3 Flash Preview `$0.50` / `$3.00`, 3.5 Flash-Lite `$0.30` / `$2.50`. Output prices include thinking tokens, and the client never read `thoughtsTokenCount`. Re-pricing the committed 47 calls gives `$0.032134`, 8.4× the logged `$0.003809`. We moved the prices into `src/model/pricing.ts` with a test per model (an unknown model gets the dearest rate), price each call by the model that answered, and log `thoughtsTokens`. We did not edit the committed call log; `dev-set-run/README.md` gives the corrected per-model totals. The README's lab-of-80 figure is now `$0.0671` with the measured average of 934 input and 37 output tokens per call (`$0.1343` from 2027), plus a 500-thinking-token case at `$0.2171`. Spend stays 0 VND on the free tier.
