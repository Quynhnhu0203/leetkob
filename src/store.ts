export type Role = "admin" | "ta" | "student";

export interface User {
  id: number;
  role: Role;
}

export interface Lab {
  id: number;
  classId: number;
  name?: string;
  statement?: string;
  /** After this instant no submission is accepted. */
  closesAt: Date;
}

export interface Publication {
  labId: number;
  status: "published";
  publishedAt: string;
  publishedBy: number;
  submissionCount: number;
}

export interface Constraint {
  id: string;
  text: string;
  deduction: number;
}

export interface LabTest {
  id: number;
  labId: number;
  input: string;
  expectedOutput: string;
}

export interface EvidenceLine {
  line: number;
  text: string;
}

export interface ReviewItem {
  labId: number;
  submissionId: number;
  constraintId: string;
  verdict: "pass" | "violation" | "unsure";
  evidence: EvidenceLine[];
  deduction: number;
  decidedBy: "hard_rule" | "model" | "ta";
  reviewed: boolean;
  reviewedBy?: number;
  reviewedAt?: string;
}

export interface Submission {
  id: number;
  labId: number;
  studentId: number;
  code: string;
  status: "queued" | "judged";
  testVerdict?: string;
  submittedAt: Date;
  judgedAt?: Date;
}

/**
 * Persistence port.
 */
export interface Store {
  userByToken(token: string): Promise<User | undefined>;
  lab(labId: number): Promise<Lab | undefined>;
  isTaOfClass(userId: number, classId: number): Promise<boolean>;
  publication(labId: number): Promise<Publication | undefined>;
  pendingReviewCount(labId: number): Promise<number>;
  publish(
    labId: number,
    by: number,
    now: Date,
  ): Promise<{ created: boolean; publication: Publication }>;

  // Lab management
  createLab(data: {
    classId: number;
    name?: string;
    statement?: string;
    closesAt: Date;
  }): Promise<Lab>;
  addConstraint(labId: number, constraint: Constraint): Promise<void>;
  getConstraints(labId: number): Promise<Constraint[]>;
  addTest(labId: number, test: { input: string; expectedOutput: string }): Promise<LabTest>;
  getTests(labId: number): Promise<LabTest[]>;

  // Submissions & Queue
  createSubmission(data: { labId: number; studentId: number; code: string }): Promise<Submission>;
  submission(id: number): Promise<Submission | undefined>;
  listSubmissions(labId: number): Promise<Submission[]>;
  setSubmissionJudged(
    id: number,
    testVerdict: string,
    verdicts: Array<Omit<ReviewItem, "reviewed">>,
  ): Promise<boolean>;

  // Review Queue
  getReviewQueue(labId: number): Promise<ReviewItem[]>;
  updateReviewItem(
    labId: number,
    submissionId: number,
    constraintId: string,
    verdict: "pass" | "violation" | "unsure",
    reviewedBy: number,
  ): Promise<boolean>;
}

export interface Seed {
  users?: (User & { token: string })[];
  classes?: { id: number; taIds: number[]; studentIds?: number[] }[];
  labs?: Lab[];
  constraints?: { labId: number; constraint: Constraint }[];
  tests?: LabTest[];
  submissions?: {
    id: number;
    labId: number;
    studentId?: number;
    code?: string;
    status?: "queued" | "judged";
    testVerdict?: string;
  }[];
  /** One entry per verdict that sits in the TA's review queue. */
  reviewItems?: {
    labId: number;
    submissionId: number;
    constraintId?: string;
    verdict?: "pass" | "violation" | "unsure";
    evidence?: EvidenceLine[];
    deduction?: number;
    decidedBy?: "hard_rule" | "model" | "ta";
    reviewed: boolean;
  }[];
}

export class InMemoryStore implements Store {
  private readonly users = new Map<string, User>();
  private readonly classTas = new Map<number, Set<number>>();
  private readonly classStudents = new Map<number, Set<number>>();
  private readonly labs = new Map<number, Lab>();
  private readonly constraints = new Map<number, Constraint[]>();
  private readonly tests = new Map<number, LabTest[]>();
  private readonly submissions = new Map<number, Submission>();
  private readonly reviewItems: ReviewItem[] = [];
  private readonly publications = new Map<number, Publication>();

  private nextLabId = 100;
  private nextSubmissionId = 100;
  private nextTestId = 1;

  constructor(seed: Seed = {}) {
    for (const u of seed.users ?? []) this.users.set(u.token, { id: u.id, role: u.role });
    for (const c of seed.classes ?? []) {
      this.classTas.set(c.id, new Set(c.taIds));
      if (c.studentIds) this.classStudents.set(c.id, new Set(c.studentIds));
    }
    for (const l of seed.labs ?? []) {
      this.labs.set(l.id, l);
      if (l.id >= this.nextLabId) this.nextLabId = l.id + 1;
    }
    for (const item of seed.constraints ?? []) {
      const list = this.constraints.get(item.labId) ?? [];
      list.push(item.constraint);
      this.constraints.set(item.labId, list);
    }
    for (const t of seed.tests ?? []) {
      const list = this.tests.get(t.labId) ?? [];
      list.push(t);
      this.tests.set(t.labId, list);
      if (t.id >= this.nextTestId) this.nextTestId = t.id + 1;
    }
    for (const s of seed.submissions ?? []) {
      const sub: Submission = {
        id: s.id,
        labId: s.labId,
        studentId: s.studentId ?? 1,
        code: s.code ?? "",
        status: s.status ?? "judged",
        testVerdict: s.testVerdict ?? "AC",
        submittedAt: new Date(),
      };
      this.submissions.set(s.id, sub);
      if (s.id >= this.nextSubmissionId) this.nextSubmissionId = s.id + 1;
    }
    for (const r of seed.reviewItems ?? []) {
      this.reviewItems.push({
        labId: r.labId,
        submissionId: r.submissionId,
        constraintId: r.constraintId ?? "C1",
        verdict: r.verdict ?? "violation",
        evidence: r.evidence ?? [],
        deduction: r.deduction ?? 3,
        decidedBy: r.decidedBy ?? "hard_rule",
        reviewed: r.reviewed,
      });
    }
  }

  userByToken(token: string): Promise<User | undefined> {
    return Promise.resolve(this.users.get(token));
  }

  lab(labId: number): Promise<Lab | undefined> {
    return Promise.resolve(this.labs.get(labId));
  }

  isTaOfClass(userId: number, classId: number): Promise<boolean> {
    return Promise.resolve(this.classTas.get(classId)?.has(userId) ?? false);
  }

  publication(labId: number): Promise<Publication | undefined> {
    return Promise.resolve(this.publications.get(labId));
  }

  pendingReviewCount(labId: number): Promise<number> {
    return Promise.resolve(this.reviewItems.filter((r) => r.labId === labId && !r.reviewed).length);
  }

  publish(
    labId: number,
    by: number,
    now: Date,
  ): Promise<{ created: boolean; publication: Publication }> {
    const existing = this.publications.get(labId);
    if (existing) return Promise.resolve({ created: false, publication: existing });
    const count = Array.from(this.submissions.values()).filter((s) => s.labId === labId).length;
    const publication: Publication = {
      labId,
      status: "published",
      publishedAt: now.toISOString(),
      publishedBy: by,
      submissionCount: count,
    };
    this.publications.set(labId, publication);
    return Promise.resolve({ created: true, publication });
  }

  createLab(data: {
    classId: number;
    name?: string;
    statement?: string;
    closesAt: Date;
  }): Promise<Lab> {
    const lab: Lab = {
      id: this.nextLabId++,
      classId: data.classId,
      name: data.name,
      statement: data.statement,
      closesAt: data.closesAt,
    };
    this.labs.set(lab.id, lab);
    return Promise.resolve(lab);
  }

  addConstraint(labId: number, constraint: Constraint): Promise<void> {
    const list = this.constraints.get(labId) ?? [];
    list.push(constraint);
    this.constraints.set(labId, list);
    return Promise.resolve();
  }

  getConstraints(labId: number): Promise<Constraint[]> {
    return Promise.resolve([...(this.constraints.get(labId) ?? [])]);
  }

  addTest(labId: number, test: { input: string; expectedOutput: string }): Promise<LabTest> {
    const list = this.tests.get(labId) ?? [];
    const t: LabTest = {
      id: this.nextTestId++,
      labId,
      input: test.input,
      expectedOutput: test.expectedOutput,
    };
    list.push(t);
    this.tests.set(labId, list);
    return Promise.resolve(t);
  }

  getTests(labId: number): Promise<LabTest[]> {
    return Promise.resolve([...(this.tests.get(labId) ?? [])]);
  }

  createSubmission(data: { labId: number; studentId: number; code: string }): Promise<Submission> {
    const sub: Submission = {
      id: this.nextSubmissionId++,
      labId: data.labId,
      studentId: data.studentId,
      code: data.code,
      status: "queued",
      submittedAt: new Date(),
    };
    this.submissions.set(sub.id, sub);
    return Promise.resolve({ ...sub });
  }

  submission(id: number): Promise<Submission | undefined> {
    const s = this.submissions.get(id);
    return Promise.resolve(s ? { ...s } : undefined);
  }

  listSubmissions(labId: number): Promise<Submission[]> {
    const list = Array.from(this.submissions.values()).filter((s) => s.labId === labId);
    return Promise.resolve(list.map((s) => ({ ...s })));
  }

  setSubmissionJudged(
    id: number,
    testVerdict: string,
    verdicts: Array<Omit<ReviewItem, "reviewed">>,
  ): Promise<boolean> {
    const sub = this.submissions.get(id);
    if (!sub) return Promise.resolve(false);
    if (sub.status === "judged") {
      return Promise.resolve(false);
    }
    sub.status = "judged";
    sub.testVerdict = testVerdict;
    sub.judgedAt = new Date();

    for (const v of verdicts) {
      this.reviewItems.push({
        ...v,
        reviewed: false,
      });
    }
    return Promise.resolve(true);
  }

  getReviewQueue(labId: number): Promise<ReviewItem[]> {
    const list = this.reviewItems.filter((r) => r.labId === labId);
    return Promise.resolve(list.map((r) => ({ ...r })));
  }

  updateReviewItem(
    labId: number,
    submissionId: number,
    constraintId: string,
    verdict: "pass" | "violation" | "unsure",
    reviewedBy: number,
  ): Promise<boolean> {
    const item = this.reviewItems.find(
      (r) =>
        r.labId === labId && r.submissionId === submissionId && r.constraintId === constraintId,
    );
    if (!item) return Promise.resolve(false);
    item.verdict = verdict;
    item.reviewed = true;
    item.reviewedBy = reviewedBy;
    item.reviewedAt = new Date().toISOString();
    return Promise.resolve(true);
  }

  /** Test helper: mark every review item of a lab as reviewed. */
  markAllReviewed(labId: number): void {
    for (const r of this.reviewItems) if (r.labId === labId) r.reviewed = true;
  }
}
