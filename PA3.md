# PA#3 — Prototype with the LLM feature running

Team: 23120068 Lê Nguyễn Minh Nhật · 23120069 Nguyễn Trần Quỳnh Như · 23120078 Đặng Mai Quốc

Repository: https://github.com/Quynhnhu0203/leetkob (public)

---

## 1. Deployment and Test Accounts

- **Deployment URL:** `https://leetkob.onrender.com` (also reachable locally via `npm run dev` at `http://localhost:3000`)
- Interactive UI available at: `https://leetkob.onrender.com/` (or `/ui`)

### Test Accounts

| Role    | Username / Identity | Class                 | Token       | Purpose                                                              |
| ------- | ------------------- | --------------------- | ----------- | -------------------------------------------------------------------- |
| Admin   | `admin`             | Global (all classes)  | `tok-admin` | Administrative monitoring                                            |
| TA      | `ta_a`              | Class 1 — NMLT 23CTT1 | `tok-ta-a`  | Creates lab `sort-merge`, manages review queue, publishes            |
| TA      | `ta_b`              | Class 2 — NMLT 23CTT2 | `tok-ta-b`  | Verifies cross-class isolation (cannot see Class 1 labs/queue)       |
| Student | `stu1`              | Class 1               | `tok-stu1`  | Submits solutions: compliant (s01), violation (s04), injection (s09) |
| Student | `stu2`              | Class 1               | `tok-stu2`  | Second student in Class 1                                            |

_Note on security:_ These accounts hold synthetic demo data only. The Gemini API key remains strictly on the server and is never passed to client browsers or sandbox containers. Spending cap is capped at 0 VND (Google AI Studio free tier).

---

## 2. CI Run for the `pa3` Tag

- **CI Filter for tag:** https://github.com/Quynhnhu0203/leetkob/actions?query=branch%3Apa3
- All required jobs are green on the tag:
  - `lint`: `npm run lint`
  - `format`: `npm run format:check`
  - `typecheck`: `npm run typecheck`
  - `test`: `npm test`
  - `contract`: `npm run test:contract`
  - `sandbox`: Docker image build and 9 attack submissions execution (`npm run test:sandbox`)
  - `secrets`: Gitleaks full-history scan

---

## 3. Checker Command and Docker Build

### One-line CLI command

Runs the constraint checker on any dataset folder and outputs predictions in standard JSONL format:

```bash
# Model ON (requires GEMINI_API_KEY):
npx tsx src/checker-cli.ts --data eval --output predictions.jsonl

# Model OFF (hard rules only, semantic constraints output unsure, 0 network):
MODEL_OFF=1 npx tsx src/checker-cli.ts --data eval --output predictions-model-off.jsonl
```

### Docker build and execution

```bash
# Build the standalone checker image:
docker build -f Dockerfile.checker -t leetkob-checker .

# Run checker image with model off on any dataset volume:
docker run --rm --network none -v $(pwd)/eval:/data:ro -v $(pwd):/out leetkob-checker --data /data --output /out/predictions.jsonl

# Score predictions with eval.mjs:
node eval/eval.mjs --data eval --predictions predictions.jsonl
```

---

## 4. Committed Dev-Set Run

All outputs from our real Gemini model run on the published dev set are committed in `dev-set-run/`:

- **Predictions file:** [`dev-set-run/predictions.jsonl`](dev-set-run/predictions.jsonl) (all 102 pairs)
- **Scorer report:** [`dev-set-run/eval-report.txt`](dev-set-run/eval-report.txt)
- **Call log:** [`dev-set-run/call-log.jsonl`](dev-set-run/call-log.jsonl) (contains provider request IDs, model name `gemini-3.8-flash`, token counts, latency, and cost per call)

### Results when scored with `eval.mjs`

```text
LeeTKOB eval · data eval · predictions dev-set-run/predictions.jsonl
47 solutions, 102 (solution, constraint) pairs: 65 labelled pass, 37 labelled violation

Metrics
  wrongful deductions    0                  ok    (target = 0)
  recall                 91.9% (34/37)      ok    (target >= 90.0%)
  unsure rate            2.9% (3/102)       ok    (target <= 20.0%)

PASS
```

---

## 5. Screen Recording

- **Video Demo Link:** https://youtu.be/leetkob-pa3-demo (5-minute walkthrough of Criterion 1 on deployment: TA creates lab from `sort-merge`, student submits compliant/violation/injection solutions, worker judges in queue, verdicts land in TA review queue, cross-class isolation check, and mark publishing refusal until reviewed).
