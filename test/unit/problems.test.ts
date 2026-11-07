import { describe, expect, it } from "vitest";
import { PROBLEMS, problem } from "../../src/problems.js";

describe("problem()", () => {
  it("builds an RFC 9457 object whose status matches the table", () => {
    for (const slug of Object.keys(PROBLEMS) as (keyof typeof PROBLEMS)[]) {
      const p = problem(slug, "x.");
      expect(p.type).toBe(`https://leetkob.example/problems/${slug}`);
      expect(p.status).toBe(PROBLEMS[slug].status);
    }
  });

  it("keeps extensions", () => {
    expect(problem("reviews-pending", "x.", { pendingReviews: 2 }).pendingReviews).toBe(2);
  });
});
