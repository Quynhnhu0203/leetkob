# PA#2 — Harness and quality gate

Team: 23120068 Nguyễn Lê Minh Nhật · 23120069 Nguyễn Trần Quỳnh Như · 23120078 Đặng Mai Quốc

## Links

| What                                 | Link                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository (public)                  | https://github.com/Quynhnhu0203/leetkob                                                                                                                                                                                                                                                                                                                                                          |
| Protected-branch settings            | Screenshot of the rule: [`docs/img/branch-protection-detail.png`](docs/img/branch-protection-detail.png) (PR required, six required checks, no bypass). Also [`docs/img/branch-protection-created.png`](docs/img/branch-protection-created.png) and [`docs/img/pr1-blocked.png`](docs/img/pr1-blocked.png) (checks marked **Required** on a PR). Read back from the API on 2026-11-07, see below |
| Blocked PR (red check stopped merge) | PR #1 https://github.com/Quynhnhu0203/leetkob/pull/1 — commit `4d32388` added the contract tests before the endpoint existed; required `contract` check red, merge **BLOCKED**: run https://github.com/Quynhnhu0203/leetkob/actions/runs/42363332790                                                                                                                                             |
| Commit that turned it green          | `0194202` https://github.com/Quynhnhu0203/leetkob/commit/0194202119ae3d99cc6d6e9c0c75518ef67b8946 (implementation only, no test or contract change): run https://github.com/Quynhnhu0203/leetkob/actions/runs/42363544068. Merged by merge commit `1d2e874`                                                                                                                                      |
| PR that turned green                 | PR #1 (same PR, after `0194202`) https://github.com/Quynhnhu0203/leetkob/pull/1                                                                                                                                                                                                                                                                                                                  |
| Deliberate contract break            | PR #2 https://github.com/Quynhnhu0203/leetkob/pull/2 — commit `38d6e23` https://github.com/Quynhnhu0203/leetkob/commit/38d6e237113d5309f3a3edce65fb363a5e9de146 answers `403` instead of `404` for another class's lab; `contract` red (3 tests): https://github.com/Quynhnhu0203/leetkob/actions/runs/42363793011. Closed, not merged                                                           |
| CI run for the tag `pa2`             | https://github.com/Quynhnhu0203/leetkob/actions?query=branch%3Apa2 (a file in the tagged commit cannot contain the id of its own run; this filter shows exactly the runs for the tag)                                                                                                                                                                                                            |

Branch protection on `main`, as returned by
`gh api repos/Quynhnhu0203/leetkob/branches/main/protection`:

```json
{
  "checks": ["contract", "format", "lint", "secrets", "test", "typecheck"],
  "pr": true,
  "enforce_admins": true,
  "force_push": false,
  "deletions": false
}
```

Protection was turned on right after the first push (`f8c2067`). Every later change to `main`
arrived through a pull request:

| PR                                                   | What                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [#1](https://github.com/Quynhnhu0203/leetkob/pull/1) | Publish endpoint: tests first (red, blocked), then the implementation (green)         |
| [#2](https://github.com/Quynhnhu0203/leetkob/pull/2) | Deliberate contract break, closed unmerged                                            |
| [#4](https://github.com/Quynhnhu0203/leetkob/pull/4) | PA2.md, self-assessment, AI-LOG (#3 was superseded by #4 and closed)                  |
| [#5](https://github.com/Quynhnhu0203/leetkob/pull/5) | Team conventions in `CLAUDE.md`                                                       |
| [#6](https://github.com/Quynhnhu0203/leetkob/pull/6) | `.gitattributes`: fresh clone on Windows was red (AI-LOG #8)                          |
| [#7](https://github.com/Quynhnhu0203/leetkob/pull/7) | Contract → tests → code for `GET …/publication` and `413` (AI-LOG #9)                 |
| [#8](https://github.com/Quynhnhu0203/leetkob/pull/8) | README model update; unverified spending-cap claim removed (AI-LOG #10)               |
| this PR                                              | Spending cap restored after it was checked; AI-LOG #8–#10; this file; self-assessment |

## Where each part lives

| Part                                | File                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rules file                          | [`CLAUDE.md`](CLAUDE.md)                                                                                                                                                       |
| Permissions (allowed / ask / never) | [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md), enforced in [`.claude/settings.json`](.claude/settings.json)                                                                     |
| Env variables, no values            | [`.env.example`](.env.example)                                                                                                                                                 |
| Model                               | [`README.md`](README.md#model)                                                                                                                                                 |
| One command per check               | [`README.md`](README.md#checks--one-command-each-the-same-locally-and-in-ci), [`.github/workflows/ci.yml`](.github/workflows/ci.yml)                                           |
| Contract                            | [`docs/contract/publish.md`](docs/contract/publish.md) — `POST /v1/labs/{labId}/publish`                                                                                       |
| Contract tests                      | [`test/contract/publish.contract.test.ts`](test/contract/publish.contract.test.ts), [`test/contract/conventions.contract.test.ts`](test/contract/conventions.contract.test.ts) |
| AI log                              | [`AI-LOG.md`](AI-LOG.md)                                                                                                                                                       |
| Self-assessment                     | [`SELF_ASSESSMENT_REPORT.md`](SELF_ASSESSMENT_REPORT.md)                                                                                                                       |

## Re-running the checks from the tag

```bash
git clone https://github.com/Quynhnhu0203/leetkob.git && cd leetkob
git checkout pa2
npm ci
npm run check
```
