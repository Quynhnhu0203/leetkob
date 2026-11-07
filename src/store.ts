export type Role = "admin" | "ta" | "student";

export interface User {
  id: number;
  role: Role;
}

export interface Lab {
  id: number;
  classId: number;
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

/**
 * Persistence port. PA#2 ships an in-memory implementation; the database one
 * arrives in PA#3 and must pass the same contract tests.
 */
export interface Store {
  userByToken(token: string): Promise<User | undefined>;
  lab(labId: number): Promise<Lab | undefined>;
  isTaOfClass(userId: number, classId: number): Promise<boolean>;
  publication(labId: number): Promise<Publication | undefined>;
  pendingReviewCount(labId: number): Promise<number>;
  /**
   * Atomically publish the lab. If it is already published, return the stored
   * publication with created=false and change nothing.
   */
  publish(
    labId: number,
    by: number,
    now: Date,
  ): Promise<{ created: boolean; publication: Publication }>;
}

export interface Seed {
  users?: (User & { token: string })[];
  classes?: { id: number; taIds: number[] }[];
  labs?: Lab[];
  submissions?: { id: number; labId: number }[];
  /** One entry per verdict that sits in the TA's review queue. */
  reviewItems?: { labId: number; submissionId: number; reviewed: boolean }[];
}

export class InMemoryStore implements Store {
  private readonly users = new Map<string, User>();
  private readonly classTas = new Map<number, Set<number>>();
  private readonly labs = new Map<number, Lab>();
  private readonly submissions: { id: number; labId: number }[];
  private readonly reviewItems: { labId: number; submissionId: number; reviewed: boolean }[];
  private readonly publications = new Map<number, Publication>();

  constructor(seed: Seed = {}) {
    for (const u of seed.users ?? []) this.users.set(u.token, { id: u.id, role: u.role });
    for (const c of seed.classes ?? []) this.classTas.set(c.id, new Set(c.taIds));
    for (const l of seed.labs ?? []) this.labs.set(l.id, l);
    this.submissions = [...(seed.submissions ?? [])];
    this.reviewItems = (seed.reviewItems ?? []).map((r) => ({ ...r }));
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
    // Check-and-set with no await in between: atomic on the event loop.
    const existing = this.publications.get(labId);
    if (existing) return Promise.resolve({ created: false, publication: existing });
    const publication: Publication = {
      labId,
      status: "published",
      publishedAt: now.toISOString(),
      publishedBy: by,
      submissionCount: this.submissions.filter((s) => s.labId === labId).length,
    };
    this.publications.set(labId, publication);
    return Promise.resolve({ created: true, publication });
  }

  /** Test helper: mark every review item of a lab as reviewed. */
  markAllReviewed(labId: number): void {
    for (const r of this.reviewItems) if (r.labId === labId) r.reviewed = true;
  }
}
