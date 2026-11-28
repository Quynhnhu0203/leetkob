import { buildApp } from "./app.js";
import { InMemoryStore } from "./store.js";
import { DEMO_SEED } from "./seed.js";
import { InMemorySubmissionQueue } from "./queue/queue.js";
import { JudgeWorker } from "./queue/worker.js";
import { reviewConstraints } from "./reviewer/limits.js";
import { GeminiModelClient, OfflineFakeModelClient } from "./model/client.js";

// Load .env locally when present (Node 22 built-in loader; never read or printed)
try {
  process.loadEnvFile();
} catch {
  // .env optional in production / CI
}

const port = Number(process.env.PORT || 3000);
const rawTimeout = Number(process.env.LLM_TIMEOUT_MS || 25000);
const llmTimeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 25000;
// Accounts and classes only: every lab is created by a TA through the product.
const store = new InMemoryStore(DEMO_SEED);
const queue = new InMemorySubmissionQueue();
const modelClient = process.env.GEMINI_API_KEY
  ? new GeminiModelClient({
      logFilePath: process.env.LLM_CALL_LOG_PATH || "server-call-log.jsonl",
      timeoutMs: llmTimeoutMs,
    })
  : new OfflineFakeModelClient();

// Separate background worker judging submissions from the queue
const labCallCounts = new Map<number, number>();
const worker = new JudgeWorker({
  queue,
  store,
  reviewerFn: (code, lab, constraints) =>
    reviewConstraints(code, lab, constraints, modelClient, {
      labCallCounts,
      timeoutMs: llmTimeoutMs,
    }),
});
worker.start();

const app = buildApp({ store, queue, logger: true });

app.listen({ port, host: "0.0.0.0" }).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
