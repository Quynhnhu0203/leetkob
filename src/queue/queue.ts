export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface SubmissionJob {
  id: number;
  submissionId: number;
  labId: number;
  code: string;
  status: JobStatus;
  enqueuedAt: Date;
  processedAt?: Date;
}

export interface SubmissionQueue {
  enqueue(job: { submissionId: number; labId: number; code: string }): Promise<SubmissionJob>;
  dequeue(): Promise<SubmissionJob | undefined>;
  getJob(id: number): Promise<SubmissionJob | undefined>;
  markCompleted(id: number): Promise<void>;
  pendingCount(): Promise<number>;
}

export class InMemorySubmissionQueue implements SubmissionQueue {
  private jobs: SubmissionJob[] = [];
  private nextId = 1;

  enqueue(job: { submissionId: number; labId: number; code: string }): Promise<SubmissionJob> {
    const item: SubmissionJob = {
      id: this.nextId++,
      submissionId: job.submissionId,
      labId: job.labId,
      code: job.code,
      status: "queued",
      enqueuedAt: new Date(),
    };
    this.jobs.push(item);
    return Promise.resolve({ ...item });
  }

  dequeue(): Promise<SubmissionJob | undefined> {
    const job = this.jobs.find((j) => j.status === "queued");
    if (!job) return Promise.resolve(undefined);
    job.status = "processing";
    return Promise.resolve({ ...job });
  }

  getJob(id: number): Promise<SubmissionJob | undefined> {
    const job = this.jobs.find((j) => j.id === id);
    return Promise.resolve(job ? { ...job } : undefined);
  }

  markCompleted(id: number): Promise<void> {
    const job = this.jobs.find((j) => j.id === id);
    if (job) {
      job.status = "completed";
      job.processedAt = new Date();
    }
    return Promise.resolve();
  }

  pendingCount(): Promise<number> {
    return Promise.resolve(this.jobs.filter((j) => j.status === "queued").length);
  }
}
