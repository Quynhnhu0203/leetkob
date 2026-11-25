import { buildApp } from "./app.js";
import { InMemoryStore, type Seed } from "./store.js";
import { InMemorySubmissionQueue } from "./queue/queue.js";
import { JudgeWorker } from "./queue/worker.js";
import { reviewConstraints } from "./reviewer/limits.js";
import { GeminiModelClient, OfflineFakeModelClient } from "./model/client.js";

export const DEFAULT_SEED: Seed = {
  users: [
    { id: 1, role: "admin", token: "tok-admin" },
    { id: 10, role: "ta", token: "tok-ta-a" },
    { id: 20, role: "ta", token: "tok-ta-b" },
    { id: 101, role: "student", token: "tok-stu1" },
    { id: 102, role: "student", token: "tok-stu2" },
  ],
  classes: [
    { id: 1, taIds: [10], studentIds: [101, 102] },
    { id: 2, taIds: [20], studentIds: [] },
  ],
  labs: [
    {
      id: 1,
      classId: 1,
      name: "Lab 1 — Merge Sort (sort-merge)",
      statement: "Sort an array of integers using merge sort without library sort.",
      closesAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    },
  ],
  constraints: [
    {
      labId: 1,
      constraint: {
        id: "C1",
        text: "Do not call a library sort function: `std::sort`, `std::stable_sort`, `qsort`.",
        deduction: 3,
      },
    },
    {
      labId: 1,
      constraint: {
        id: "C2",
        text: "Sort with a merge sort you wrote yourself: split the range, sort both halves, merge them.",
        deduction: 4,
      },
    },
  ],
  tests: [
    {
      id: 1,
      labId: 1,
      input: "5\n3 1 4 1 5\n",
      expectedOutput: "1 1 3 4 5\n",
    },
  ],
};

// Load .env locally when present (Node 22 built-in loader; never read or printed)
try {
  process.loadEnvFile();
} catch {
  // .env optional in production / CI
}

const port = Number(process.env.PORT ?? 3000);
const store = new InMemoryStore(DEFAULT_SEED);
const queue = new InMemorySubmissionQueue();
const modelClient = process.env.GEMINI_API_KEY
  ? new GeminiModelClient({ logFilePath: process.env.LLM_CALL_LOG_PATH ?? "server-call-log.jsonl" })
  : new OfflineFakeModelClient();

// Separate background worker judging submissions from the queue
const worker = new JudgeWorker({
  queue,
  store,
  reviewerFn: (code, lab, constraints) => reviewConstraints(code, lab, constraints, modelClient),
});
worker.start();

const app = buildApp({ store, queue, logger: true });

app.listen({ port, host: "0.0.0.0" }).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
