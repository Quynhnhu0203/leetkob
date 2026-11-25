# PA#3 — Prototype with the LLM feature running

Team: 23120068 Lê Nguyễn Minh Nhật · 23120069 Nguyễn Trần Quỳnh Như · 23120078 Đặng Mai Quốc

Repository: https://github.com/Quynhnhu0203/leetkob (public)

---

## 1. Deployment and Test Accounts

- **Deployment URL:** `<PENDING: deploy via docker compose up -d on a Docker-enabled host and paste live URL here before submission>` (locally runnable at `http://localhost:3000` with `npm start` or `docker compose up --build -d`)
- Interactive UI available at: `/ui`

> **Important architectural note:** Do NOT deploy on a host without Docker daemon if expecting bare `g++` fallback to block attacks. Use [`Dockerfile`](Dockerfile) + [`docker-compose.yml`](docker-compose.yml) on a Docker-capable host (`REQUIRE_DOCKER=1`) so all 9 sandbox minimums isolate untrusted code.

### Test Accounts

| Role    | Username / Identity | Class                 | Token       | Purpose                                                              |
| ------- | ------------------- | --------------------- | ----------- | -------------------------------------------------------------------- |
| Admin   | `admin`             | Global (all classes)  | `tok-admin` | Administrative monitoring                                            |
| TA      | `ta_a`              | Class 1 — NMLT 23CTT1 | `tok-ta-a`  | Creates lab `sort-merge`, manages review queue, publishes            |
| TA      | `ta_b`              | Class 2 — NMLT 23CTT2 | `tok-ta-b`  | Verifies cross-class isolation (cannot see Class 1 labs/queue)       |
| Student | `stu1`              | Class 1               | `tok-stu1`  | Submits solutions: compliant (s01), violation (s04), injection (s09) |
| Student | `stu2`              | Class 1               | `tok-stu2`  | Second student in Class 1                                            |

_Note on security:_ These accounts hold synthetic demo data only. The Gemini API key stays strictly in `.env` on the server and never reaches client browsers or sandbox containers.

---

## 2. CI Run for the `pa3` Tag

- **CI Filter for tag:** https://github.com/Quynhnhu0203/leetkob/actions?query=branch%3Apa3
- Required jobs running on `pa3` tag:
  - `lint`: `npm run lint`
  - `format`: `npm run format:check`
  - `typecheck`: `npm run typecheck`
  - `test`: `npm test`
  - `contract`: `npm run test:contract`
  - `sandbox`: `docker build -f Dockerfile.sandbox -t leetkob-sandbox:latest .` + `REQUIRE_DOCKER=1 npm run test:sandbox` (compiles & executes all 9 attacks in Docker)
  - `secrets`: Gitleaks full-history scan

---

## 3. Checker Command and Docker Build

```bash
# Model ON (requires GEMINI_API_KEY in .env):
npx tsx src/checker-cli.ts --data eval --output predictions.jsonl --log call-log.jsonl

# Model OFF (hard rules only, semantic constraints output unsure, zero network):
MODEL_OFF=1 npx tsx src/checker-cli.ts --data eval --output predictions-model-off.jsonl

# Build standalone checker container:
docker build -f Dockerfile.checker -t leetkob-checker .

# Run checker container offline with MODEL_OFF=1:
mkdir -p out
docker run --rm --network none -e MODEL_OFF=1 -v $(pwd)/eval:/data:ro -v $(pwd)/out:/out leetkob-checker --data /data --output /out/predictions.jsonl

# Score output with eval.mjs:
node eval/eval.mjs --data eval --predictions out/predictions.jsonl
```

---

## 4. Dev-Set Run

- Run with your Google AI Studio key in `.env`:

```bash
npm run eval:run
node eval/eval.mjs --data eval --predictions dev-set-run/predictions.jsonl | tee dev-set-run/eval-report.txt
```

- Output artifacts belong in `dev-set-run/` (`predictions.jsonl`, `eval-report.txt`, and `call-log.jsonl` containing real `prompt`s, Google provider request IDs, tokens, duration, and cost).

---

## 5. Screen Recording

- **Video Demo Link:** `<PENDING: record <= 5-minute demo walkthrough of Criterion 1 on the live deployment and paste link here>`
