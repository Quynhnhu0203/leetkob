import { describe, expect, it } from "vitest";
import { DEMO_SEED } from "../../src/seed.js";
import { InMemoryStore } from "../../src/store.js";

// PA3.md accounts: one admin, two TAs in two different classes, two students in the first TA's class.
describe("DEMO_SEED (the deployment's starting data)", () => {
  it("holds the PA3.md accounts and classes", async () => {
    const store = new InMemoryStore(DEMO_SEED);
    const byToken = async (t: string) => store.userByToken(t);

    expect((await byToken("tok-admin"))?.role).toBe("admin");
    const taA = await byToken("tok-ta-a");
    const taB = await byToken("tok-ta-b");
    const stu1 = await byToken("tok-stu1");
    const stu2 = await byToken("tok-stu2");
    expect([taA?.role, taB?.role, stu1?.role, stu2?.role]).toEqual([
      "ta",
      "ta",
      "student",
      "student",
    ]);

    expect(await store.isTaOfClass(taA!.id, 1)).toBe(true);
    expect(await store.isTaOfClass(taB!.id, 1)).toBe(false);
    expect(await store.isTaOfClass(taB!.id, 2)).toBe(true);
    expect(await store.isStudentOfClass(stu1!.id, 1)).toBe(true);
    expect(await store.isStudentOfClass(stu2!.id, 1)).toBe(true);
  });

  it("creates no lab, constraint or test: every lab comes from a TA through the product", () => {
    expect(DEMO_SEED.labs ?? []).toEqual([]);
    expect(DEMO_SEED.constraints ?? []).toEqual([]);
    expect(DEMO_SEED.tests ?? []).toEqual([]);
    expect(DEMO_SEED.submissions ?? []).toEqual([]);
    expect(DEMO_SEED.reviewItems ?? []).toEqual([]);
  });
});
