# Committed Dev-Set Run

Run the real Gemini constraint checker with your key in `.env`:

```bash
npm run eval:run
node eval/eval.mjs --data eval --predictions dev-set-run/predictions.jsonl > dev-set-run/eval-report.txt
```

Committed run summary (`eval/` — 47 solutions, 102 pairs: 55 hard-rule + 47 semantic LLM calls):

- `eval.mjs` result: **PASS** — `wrongful deductions: 0`, `recall: 100.0% (37/37)`, `unsure rate: 0.0% (0/102)`
- Call log (`call-log.jsonl`): 47 genuine Gemini API calls (`0` errors, `0` fake/missing IDs; models used via fallback under free-tier 20 RPD quota: `gemini-3.6-flash` x24, `gemini-3-flash-preview` x18, `gemini-3.5-flash-lite` x5; total tokens: 45,614; total estimated cost: `$0.003809`; avg duration: `4160 ms`)
- **The `costUsd` field in `call-log.jsonl` is understated.** The run priced every call at a flat
  \$0.075 / \$0.30 per 1M input / output tokens. At the Gemini Developer API Standard rates in
  [`src/model/pricing.ts`](../src/model/pricing.ts) (read 2026-11-28), the same tokens cost:

  | Model                    | Calls | Input tokens | Output tokens | Cost (USD) |
  | ------------------------ | ----: | -----------: | ------------: | ---------: |
  | `gemini-3.6-flash`       |    24 |       22,349 |           638 |   0.019154 |
  | `gemini-3-flash-preview` |    18 |       17,006 |           803 |   0.010912 |
  | `gemini-3.5-flash-lite`  |     5 |        4,535 |           283 |   0.002068 |
  | **Total**                |    47 |       43,890 |         1,724 |   0.032134 |

  That is 8.4× the logged \$0.003809, and still a floor: the run did not record thinking tokens,
  which are billed as output. We leave the log as the run wrote it; new runs price each call by
  the model that answered and log `thoughtsTokens`. Actual spend was 0 VND (free tier).

- Note: Pass 1 exhausted the 20 RPD free-tier quota on `gemini-3.6-flash` and hit 8 timeouts on overloaded `gemini-3.8-flash`; those 23 transient error rows were resumed cleanly through `runChecker` against `gemini-3-flash-preview` + `gemini-flash-lite-latest` fallback with per-attempt timeouts enabled in `src/model/client.ts`.
