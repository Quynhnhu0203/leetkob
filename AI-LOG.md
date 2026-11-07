# AI-LOG — PA#2

## Tools

| Tool                                     | Used for                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code (Claude Opus 5.5) in VS Code | Read the brief and the rubric; scaffold; `CLAUDE.md`; permissions; contract; contract tests; CI; README; drafts of PA2.md and this log |
| GitHub CLI (`gh`), run by us             | Creating the public repo, pull requests, merges, the `pa2` tag                                                                         |
| GitHub web UI, by us                     | Branch protection on `main` and its screenshot                                                                                         |
| Google Gemini                            | Not used yet. The app's model from PA#3 (free tier, see README)                                                                        |

Decisions we made, not the assistant: endpoint = `POST /labs/{labId}/publish`; stack =
TypeScript/Node; model = Gemini; commits under our own account, without AI co-author lines.

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

<!-- Entries #5+ are added as the PRs run: the blocked PR, the green commit, the deliberate break. -->

## What we checked ourselves

- Every line of `CLAUDE.md` and `docs/contract/publish.md` against the brief §3–§4 and the rubric.
- That `npm run check` is green on a fresh clone with no `.env`.
- That the free-tier Gemini project has no billing account attached (README "spending cap").
