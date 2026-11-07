# What the assistant may do

Three tiers. `.claude/settings.json` enforces them for Claude Code; this file explains why.
Changing a tier is a PR like any other.

## Allowed (no prompt)

| Action                                                                                                            | Why it is safe                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Read the repo (except `.env*`)                                                                                    | Nothing secret is tracked                        |
| Edit `src/**`, `docs/**` (except `docs/contract/**`)                                                              | Every change still goes through PR + required CI |
| Run the checks: `npm run lint`, `format:check`, `format`, `typecheck`, `test`, `test:contract`, `check`; `npm ci` | Local, no network, nothing outside the repo      |
| `git status`, `diff`, `log`, `switch`, `add`                                                                      | Read-only or local and reversible                |

## Ask first

| Action                                               | Why a human looks first                                       |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| Edit `test/**`, `docs/contract/**`                   | Tests and contract are the gate; changing them can hide a bug |
| Edit `.github/**`, `CLAUDE.md`, `package.json`       | Changes what CI runs and how the assistant behaves            |
| `npm install` / `npm uninstall`                      | Pulls third-party code into the build                         |
| `git commit`, `git push` (feature branch), `git tag` | Becomes public history (the repo is public)                   |
| `gh pr create`, `gh pr merge`                        | Outward-facing; a merge decides what lands on `main`          |

## Never

| Action                                                                  | Why                                                                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Read, print, edit or commit `.env` or any real key                      | The key must not reach logs, history or the sandbox                   |
| Edit `eval/**` (dev-set data and labels, from PA#4)                     | Editing labels to pass the eval defeats the gate                      |
| `git push` to `main`, `git push --force`, `git reset --hard`            | `main` is protected; history must show every change went through a PR |
| Change branch protection, delete the repo, anything via `gh api DELETE` | Only a team member does this, by hand                                 |
| `docker run` (host mounts, Docker socket, secrets into the sandbox)     | Sandbox minimums in the brief §5                                      |
| Call the real Gemini API from a test                                    | Tests must be free, deterministic and offline                         |
