import { describe, it, expect, vi } from "vitest";
import { InMemorySubmissionQueue } from "../../src/queue/queue.js";
import { JudgeWorker } from "../../src/queue/worker.js";
import { InMemoryStore } from "../../src/store.js";
import { buildApp } from "../../src/app.js";
import type { JudgeResult } from "../../src/sandbox/runner.js";

describe("Queue and Worker — judged exactly once", () => {
  it("enqueues and dequeues jobs in FIFO order", async () => {
    const queue = new InMemorySubmissionQueue();
    await queue.enqueue({ submissionId: 1, labId: 10, code: "int main() {}" });
    await queue.enqueue({ submissionId: 2, labId: 10, code: "void foo() {}" });

    expect(await queue.pendingCount()).toBe(2);

    const first = await queue.dequeue();
    expect(first?.submissionId).toBe(1);
    expect(first?.status).toBe("processing");

    const second = await queue.dequeue();
    expect(second?.submissionId).toBe(2);

    const third = await queue.dequeue();
    expect(third).toBeUndefined();
  });

  it("HTTP submit enqueues without direct judging; stopping and starting worker judges exactly once", async () => {
    const store = new InMemoryStore({
      users: [{ id: 201, role: "student", token: "tok-stu" }],
      classes: [{ id: 1, taIds: [10], studentIds: [201] }],
      labs: [{ id: 1, classId: 1, closesAt: new Date(Date.now() + 100000) }],
    });
    await store.addConstraint(1, { id: "C1", text: "Do not use std::sort", deduction: 3 });
    await store.addTest(1, { input: "5\n", expectedOutput: "5\n" });

    const queue = new InMemorySubmissionQueue();
    let judgeCount = 0;
    const fakeJudge = vi.fn().mockImplementation((): Promise<JudgeResult> => {
      judgeCount++;
      return Promise.resolve({
        verdict: "AC",
        compileSuccess: true,
        compileOutput: "",
        testResults: [{ testId: 1, verdict: "AC", timeMs: 50 }],
      });
    });

    const fakeReviewer = vi.fn().mockResolvedValue([
      {
        labId: 1,
        submissionId: 0,
        constraintId: "C1",
        verdict: "pass" as const,
        evidence: [],
        deduction: 3,
        decidedBy: "hard_rule" as const,
      },
    ]);

    const worker = new JudgeWorker({
      queue,
      store,
      judgeFn: fakeJudge,
      reviewerFn: fakeReviewer,
      pollIntervalMs: 10,
    });

    const app = buildApp({ store, queue });

    // 1. Worker is stopped: submit via HTTP API
    worker.stop();
    expect(worker.running).toBe(false);

    const submitRes = await app.inject({
      method: "POST",
      url: "/v1/labs/1/submissions",
      headers: { authorization: "Bearer tok-stu", "content-type": "application/json" },
      payload: JSON.stringify({ code: "int main() { return 0; }" }),
    });
    expect(submitRes.statusCode).toBe(202);
    const created = submitRes.json<{ id: number; status: string }>();
    expect(created.status).toBe("queued");

    // Even after a brief delay, request handler MUST NOT judge directly while worker is stopped
    await new Promise((r) => setTimeout(r, 40));
    const whileStopped = await store.submission(created.id);
    expect(whileStopped?.status).toBe("queued");
    expect(judgeCount).toBe(0);
    expect(await queue.pendingCount()).toBe(1);

    // 2. Start the worker -> dequeues and judges the submission
    worker.start();
    await new Promise((r) => setTimeout(r, 80));
    worker.stop();

    const judgedSub = await store.submission(created.id);
    expect(judgedSub?.status).toBe("judged");
    expect(judgedSub?.testVerdict).toBe("AC");
    expect(judgeCount).toBe(1);

    const reviewQueue = await store.getReviewQueue(1);
    expect(reviewQueue.length).toBe(1);
    expect(reviewQueue[0]?.submissionId).toBe(created.id);

    // 3. Re-enqueuing and restarting worker still judges exactly once (idempotent)
    await queue.enqueue({ submissionId: created.id, labId: 1, code: "int main() { return 0; }" });
    worker.start();
    await new Promise((r) => setTimeout(r, 80));
    worker.stop();

    expect(judgeCount).toBe(1);
    expect((await store.getReviewQueue(1)).length).toBe(1);
  });

  it("rejects submissions exceeding 64 KB code limit (FAQ-05)", async () => {
    const store = new InMemoryStore({
      users: [{ id: 201, role: "student", token: "tok-stu" }],
      classes: [{ id: 1, taIds: [10], studentIds: [201] }],
      labs: [{ id: 1, classId: 1, closesAt: new Date(Date.now() + 100000) }],
    });
    const queue = new InMemorySubmissionQueue();
    const app = buildApp({ store, queue });

    const oversizedCode = "a".repeat(65537);
    const res = await app.inject({
      method: "POST",
      url: "/v1/labs/1/submissions",
      headers: { authorization: "Bearer tok-stu", "content-type": "application/json" },
      payload: JSON.stringify({ code: oversizedCode }),
    });
    expect(res.statusCode).toBe(413);
    expect(await queue.pendingCount()).toBe(0);
  });

  it("does not call constraint reviewer when code fails testcases (WA)", async () => {
    const store = new InMemoryStore({
      classes: [{ id: 1, taIds: [10] }],
      labs: [{ id: 1, classId: 1, closesAt: new Date(Date.now() + 100000) }],
    });
    await store.addConstraint(1, { id: "C1", text: "Do not use std::sort", deduction: 3 });
    await store.addTest(1, { input: "5\n", expectedOutput: "5\n" });

    const queue = new InMemorySubmissionQueue();
    const fakeJudge = vi.fn().mockResolvedValue({
      verdict: "WA",
      compileSuccess: true,
      compileOutput: "",
      testResults: [{ testId: 1, verdict: "WA", timeMs: 50 }],
    });
    const fakeReviewer = vi.fn();

    const worker = new JudgeWorker({
      queue,
      store,
      judgeFn: fakeJudge,
      reviewerFn: fakeReviewer,
    });

    const sub = await store.createSubmission({
      labId: 1,
      studentId: 201,
      code: "int main() { return 0; }",
    });
    await queue.enqueue({ submissionId: sub.id, labId: 1, code: sub.code });

    await worker.processNext();

    const judgedSub = await store.submission(sub.id);
    expect(judgedSub?.status).toBe("judged");
    expect(judgedSub?.testVerdict).toBe("WA");
    expect(fakeReviewer).not.toHaveBeenCalled();

    const queueItems = await store.getReviewQueue(1);
    expect(queueItems.length).toBe(0);
  });

  it("rejects cross-class TA submission and invalid closesAt / negative deduction (404 / 400)", async () => {
    const store = new InMemoryStore({
      users: [
        { id: 10, role: "ta", token: "tok-ta-a" },
        { id: 20, role: "ta", token: "tok-ta-b" },
      ],
      classes: [
        { id: 1, taIds: [10] },
        { id: 2, taIds: [20] },
      ],
      labs: [{ id: 1, classId: 1, closesAt: new Date(Date.now() + 100000) }],
    });
    const queue = new InMemorySubmissionQueue();
    const app = buildApp({ store, queue });

    // Cross-class TA cannot submit into Class 1 lab
    const crossSubmit = await app.inject({
      method: "POST",
      url: "/v1/labs/1/submissions",
      headers: { authorization: "Bearer tok-ta-b", "content-type": "application/json" },
      payload: JSON.stringify({ code: "int main() {}" }),
    });
    expect(crossSubmit.statusCode).toBe(404);

    // Invalid closesAt returns 400 validation instead of 500
    const badDateLab = await app.inject({
      method: "POST",
      url: "/v1/labs",
      headers: { authorization: "Bearer tok-ta-a", "content-type": "application/json" },
      payload: JSON.stringify({ classId: 1, name: "Lab X", closesAt: "not-a-date" }),
    });
    expect(badDateLab.statusCode).toBe(400);

    // Negative deduction returns 400 validation
    const badDeduction = await app.inject({
      method: "POST",
      url: "/v1/labs/1/constraints",
      headers: { authorization: "Bearer tok-ta-a", "content-type": "application/json" },
      payload: JSON.stringify({ id: "C9", text: "Rule", deduction: -2 }),
    });
    expect(badDeduction.statusCode).toBe(400);
  });
});
