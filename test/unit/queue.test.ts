import { describe, it, expect, vi } from "vitest";
import { InMemorySubmissionQueue } from "../../src/queue/queue.js";
import { JudgeWorker } from "../../src/queue/worker.js";
import { InMemoryStore } from "../../src/store.js";
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

  it("stop the worker, submit, start worker again, and submission is judged exactly once", async () => {
    const store = new InMemoryStore({
      classes: [{ id: 1, taIds: [10] }],
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
        submissionId: 101,
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
    });

    // 1. Worker is stopped
    worker.stop();
    expect(worker.running).toBe(false);

    // 2. Student submits while worker is stopped
    const sub = await store.createSubmission({
      labId: 1,
      studentId: 201,
      code: "int main() { return 0; }",
    });
    await queue.enqueue({ submissionId: sub.id, labId: 1, code: sub.code });

    // Verify submission is still queued and not judged yet
    const currentSub = await store.submission(sub.id);
    expect(currentSub?.status).toBe("queued");
    expect(judgeCount).toBe(0);

    // 3. Start the worker and process
    const result = await worker.processNext();
    expect(result?.judged).toBe(true);

    // Verify submission is now judged
    const judgedSub = await store.submission(sub.id);
    expect(judgedSub?.status).toBe("judged");
    expect(judgedSub?.testVerdict).toBe("AC");
    expect(judgeCount).toBe(1);

    // Verify verdicts landed in review queue
    const reviewQueue = await store.getReviewQueue(1);
    expect(reviewQueue.length).toBe(1);
    expect(reviewQueue[0]?.constraintId).toBe("C1");
    expect(reviewQueue[0]?.verdict).toBe("pass");

    // 4. If processed again or re-enqueued, judged exactly once: no duplicate verdicts
    await queue.enqueue({ submissionId: sub.id, labId: 1, code: sub.code });
    const secondResult = await worker.processNext();
    expect(secondResult?.judged).toBe(false);
    expect(judgeCount).toBe(1);

    const reviewQueueAfter = await store.getReviewQueue(1);
    expect(reviewQueueAfter.length).toBe(1); // exactly one set of verdicts
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
});
