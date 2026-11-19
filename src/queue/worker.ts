import type { SubmissionQueue, SubmissionJob } from "./queue.js";
import type { Store, ReviewItem, Lab, Constraint, LabTest } from "../store.js";
import { judgeInSandbox, type JudgeResult, type TestCase } from "../sandbox/runner.js";

export type JudgeFunction = (sourceCode: string, tests: TestCase[]) => Promise<JudgeResult>;

export type ConstraintReviewerFunction = (
  code: string,
  lab: Lab,
  constraints: Constraint[],
) => Promise<Array<Omit<ReviewItem, "reviewed">>>;

export interface WorkerOptions {
  queue: SubmissionQueue;
  store: Store;
  judgeFn?: JudgeFunction | undefined;
  reviewerFn?: ConstraintReviewerFunction | undefined;
  pollIntervalMs?: number | undefined;
}

export class JudgeWorker {
  private readonly queue: SubmissionQueue;
  private readonly store: Store;
  private readonly judgeFn: JudgeFunction;
  private readonly reviewerFn?: ConstraintReviewerFunction | undefined;
  private readonly pollIntervalMs: number;

  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: WorkerOptions) {
    this.queue = options.queue;
    this.store = options.store;
    this.judgeFn = options.judgeFn ?? ((code, tests) => judgeInSandbox(code, tests));
    this.reviewerFn = options.reviewerFn;
    this.pollIntervalMs = options.pollIntervalMs ?? 50;
  }

  get running(): boolean {
    return this.isRunning;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNext();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(() => {
      void this.processNext().finally(() => {
        if (this.isRunning) {
          this.scheduleNext();
        }
      });
    }, this.pollIntervalMs);
  }

  /**
   * Processes the next available job in the queue.
   * Guarantees that each submission is judged exactly once.
   */
  async processNext(): Promise<{ job: SubmissionJob; judged: boolean } | null> {
    const job = await this.queue.dequeue();
    if (!job) return null;

    try {
      const sub = await this.store.submission(job.submissionId);
      if (!sub) {
        await this.queue.markCompleted(job.id);
        return { job, judged: false };
      }

      // Check if already judged: judged exactly once guarantee
      if (sub.status === "judged") {
        await this.queue.markCompleted(job.id);
        return { job, judged: false };
      }

      const lab = await this.store.lab(job.labId);
      if (!lab) {
        await this.queue.markCompleted(job.id);
        return { job, judged: false };
      }

      const labTests = await this.store.getTests(job.labId);
      const testCases: TestCase[] = labTests.map((t: LabTest) => ({
        id: t.id,
        input: t.input,
        expectedOutput: t.expectedOutput,
      }));

      // 1. Sandbox judgment
      const judgeRes = await this.judgeFn(job.code, testCases);

      // 2. Constraint review (only for Accepted submissions)
      let reviewVerdicts: Array<Omit<ReviewItem, "reviewed">> = [];
      if (judgeRes.verdict === "AC" && this.reviewerFn) {
        const constraints = await this.store.getConstraints(job.labId);
        reviewVerdicts = await this.reviewerFn(job.code, lab, constraints);
      }

      // 3. Atomically save judged status and verdicts
      const formattedVerdicts = reviewVerdicts.map((v) => ({
        ...v,
        submissionId: sub.id,
      }));

      const saved = await this.store.setSubmissionJudged(
        sub.id,
        judgeRes.verdict,
        formattedVerdicts,
      );

      await this.queue.markCompleted(job.id);
      return { job, judged: saved };
    } catch {
      await this.queue.markCompleted(job.id);
      return { job, judged: false };
    }
  }
}
