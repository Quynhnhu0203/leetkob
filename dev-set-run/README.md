# Committed Dev-Set Run

Run the real Gemini constraint checker with your key in `.env`:

```bash
npm run eval:run
node eval/eval.mjs --data eval --predictions dev-set-run/predictions.jsonl > dev-set-run/eval-report.txt
```

This directory intentionally holds no synthetic/mocked log; run the commands above and commit `predictions.jsonl`, `call-log.jsonl`, and `eval-report.txt` before final submission.
