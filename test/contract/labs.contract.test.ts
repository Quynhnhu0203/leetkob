import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { InMemoryStore } from "../../src/store.js";

// A TA builds a lab through the API alone: no lab exists until the TA creates it.
function freshApp(): { app: FastifyInstance; store: InMemoryStore } {
  const store = new InMemoryStore({
    users: [
      { id: 10, role: "ta", token: "tok-ta-a" },
      { id: 20, role: "ta", token: "tok-ta-b" },
    ],
    classes: [
      { id: 1, taIds: [10], studentIds: [] },
      { id: 2, taIds: [20], studentIds: [] },
    ],
  });
  return { app: buildApp({ store }), store };
}

const json = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

let app: FastifyInstance;
let store: InMemoryStore;
let labId: number;

beforeEach(async () => {
  ({ app, store } = freshApp());
  const res = await app.inject({
    method: "POST",
    url: "/v1/labs",
    headers: json("tok-ta-a"),
    payload: JSON.stringify({ classId: 1, name: "Lab", statement: "Sort." }),
  });
  expect(res.statusCode).toBe(201);
  labId = res.json<{ id: number }>().id;
});

describe("POST /v1/labs/{labId}/tests", () => {
  it("201 stores a test whose input and expected output are strings", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/labs/${labId}/tests`,
      headers: json("tok-ta-a"),
      payload: JSON.stringify({ input: "1\n42\n", expectedOutput: "42\n" }),
    });
    expect(res.statusCode).toBe(201);
    expect(await store.getTests(labId)).toHaveLength(1);
  });

  it.each([
    ["missing expectedOutput", { input: "1\n" }],
    ["missing input", { expectedOutput: "1\n" }],
    ["non-string input", { input: 5, expectedOutput: "5\n" }],
    ["non-string expectedOutput", { input: "5\n", expectedOutput: null }],
  ])("400 validation on %s, and nothing is stored", async (_name, body) => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/labs/${labId}/tests`,
      headers: json("tok-ta-a"),
      payload: JSON.stringify(body),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ type: string }>().type).toMatch(/\/validation$/);
    expect(await store.getTests(labId)).toHaveLength(0);
  });

  it("404 for a TA of another class, and nothing is stored", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/labs/${labId}/tests`,
      headers: json("tok-ta-b"),
      payload: JSON.stringify({ input: "1\n", expectedOutput: "1\n" }),
    });
    expect(res.statusCode).toBe(404);
    expect(await store.getTests(labId)).toHaveLength(0);
  });
});

describe("POST /v1/labs/{labId}/constraints", () => {
  const c1 = { id: "C1", text: "Do not call `qsort`.", deduction: 3 };

  it("400 validation when the constraint id already exists in the lab; the first one is kept", async () => {
    const first = await app.inject({
      method: "POST",
      url: `/v1/labs/${labId}/constraints`,
      headers: json("tok-ta-a"),
      payload: JSON.stringify(c1),
    });
    expect(first.statusCode).toBe(201);

    const again = await app.inject({
      method: "POST",
      url: `/v1/labs/${labId}/constraints`,
      headers: json("tok-ta-a"),
      payload: JSON.stringify({ ...c1, deduction: 9 }),
    });
    expect(again.statusCode).toBe(400);
    expect(await store.getConstraints(labId)).toEqual([c1]);
  });
});
