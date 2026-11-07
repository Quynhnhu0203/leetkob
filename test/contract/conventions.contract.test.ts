/**
 * Contract tests for the conventions shared by every /v1 endpoint
 * (docs/contract/publish.md §1–§2).
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { InMemoryStore } from "../../src/store.js";

const app = buildApp({ store: new InMemoryStore() });

describe("§2 errors on paths that do not exist", () => {
  it.each([
    ["GET", "/v1/nope"],
    ["POST", "/v1/labs/7/unpublish"],
    ["DELETE", "/v1/labs/7/publish"],
  ] as const)("%s %s is 404 not-found as problem details", async (method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(res.json()).toEqual({
      type: "https://leetkob.example/problems/not-found",
      title: "Not found",
      status: 404,
      detail: expect.any(String) as string,
    });
  });
});
