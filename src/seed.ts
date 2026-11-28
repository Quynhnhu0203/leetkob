import type { Seed } from "./store.js";

/**
 * The deployment's starting data: the PA3.md test accounts and their classes, nothing else.
 * No lab, constraint or test is seeded: a TA creates every lab through the product (UI or API).
 * The accounts hold no real data; anyone who reads the public repository can use them.
 */
export const DEMO_SEED: Seed = {
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
};
