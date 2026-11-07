import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../src/store.js";

const NOW = new Date("2026-11-11T14:00:00.000Z");

describe("InMemoryStore.publish", () => {
  it("creates once, then returns the stored publication unchanged", async () => {
    const store = new InMemoryStore({ submissions: [{ id: 1, labId: 7 }] });
    const first = await store.publish(7, 12, NOW);
    const second = await store.publish(7, 13, new Date("2026-11-12T00:00:00.000Z"));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.publication).toEqual(first.publication);
    expect(first.publication.submissionCount).toBe(1);
  });

  it("counts only unreviewed items of the given lab", async () => {
    const store = new InMemoryStore({
      reviewItems: [
        { labId: 7, submissionId: 1, reviewed: false },
        { labId: 7, submissionId: 2, reviewed: true },
        { labId: 8, submissionId: 3, reviewed: false },
      ],
    });
    expect(await store.pendingReviewCount(7)).toBe(1);
    store.markAllReviewed(7);
    expect(await store.pendingReviewCount(7)).toBe(0);
    expect(await store.pendingReviewCount(8)).toBe(1);
  });
});
