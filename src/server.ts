import fs from "node:fs";
import path from "node:path";
import { buildApp } from "./app.js";
import { InMemoryStore, type LabTest, type Seed } from "./store.js";
import { InMemorySubmissionQueue } from "./queue/queue.js";
import { JudgeWorker } from "./queue/worker.js";
import { reviewConstraints } from "./reviewer/limits.js";
import { GeminiModelClient, OfflineFakeModelClient } from "./model/client.js";

function loadDefaultSortMergeTests(): LabTest[] {
  const testsDir = path.resolve(process.cwd(), "eval/problems/sort-merge/tests");
  try {
    const files = fs
      .readdirSync(testsDir)
      .filter((f) => f.endsWith(".in"))
      .sort();
    const loaded: LabTest[] = [];
    for (let i = 0; i < files.length; i++) {
      const inFile = files[i]!;
      const outFile = inFile.replace(/\.in$/, ".out");
      const outPath = path.join(testsDir, outFile);
      if (fs.existsSync(outPath)) {
        loaded.push({
          id: i + 1,
          labId: 1,
          input: fs.readFileSync(path.join(testsDir, inFile), "utf8"),
          expectedOutput: fs.readFileSync(outPath, "utf8"),
        });
      }
    }
    if (loaded.length > 0) return loaded;
  } catch {
    // Fallback when eval folder is not packaged in minimal container
  }
  return [
    { id: 1, labId: 1, input: "1\n42\n", expectedOutput: "42\n" },
    { id: 2, labId: 1, input: "6\n5 -2 9 -2 0 7\n", expectedOutput: "-2 -2 0 5 7 9\n" },
    { id: 3, labId: 1, input: "5\n1 2 3 4 5\n", expectedOutput: "1 2 3 4 5\n" },
    { id: 4, labId: 1, input: "5\n5 4 3 2 1\n", expectedOutput: "1 2 3 4 5\n" },
  ];
}

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
      statement:
        "Read n integers (1 <= n <= 5000) and print them in non-decreasing order using merge sort. Time limit: 2s, Memory limit: 256 MB.",
      closesAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    },
  ],
  constraints: [
    {
      labId: 1,
      constraint: {
        id: "C1",
        text: "Do not call a library sort function: `std::sort`, `std::stable_sort`, `std::partial_sort`, `std::ranges::sort`, `std::ranges::stable_sort`, `qsort`.",
        deduction: 3,
      },
    },
    {
      labId: 1,
      constraint: {
        id: "C2",
        text: "Sort with a merge sort you wrote yourself: split the range, sort both halves, merge them (top-down or bottom-up). Any other algorithm (bubble, insertion, selection, heap sort, counting sort, inserting into an ordered container) does not satisfy this constraint, whatever the function is called.",
        deduction: 4,
      },
    },
  ],
  tests: loadDefaultSortMergeTests(),
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
const labCallCounts = new Map<number, number>();
const worker = new JudgeWorker({
  queue,
  store,
  reviewerFn: (code, lab, constraints) =>
    reviewConstraints(code, lab, constraints, modelClient, { labCallCounts }),
});
worker.start();

const app = buildApp({ store, queue, logger: true });

app.listen({ port, host: "0.0.0.0" }).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
