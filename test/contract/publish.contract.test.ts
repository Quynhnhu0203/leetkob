/**
 * Contract tests for docs/contract/publish.md.
 * Each `describe` names the section it holds the code to. If one of these fails,
 * fix the code — or change the contract first, in its own commit.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../../src/app.js";
import { InMemoryStore, type Store } from "../../src/store.js";

const NOW = new Date("2026-11-11T14:00:00.000Z");
const PROBLEM = "https://leetkob.example/problems/";

const TOKENS = {
  ta12: "ta-12-token", // class 1
  ta13: "ta-13-token", // class 1
  ta20: "ta-20-token", // class 2 only
  student: "student-500-token",
  admin: "admin-1-token",
} as const;

// lab 7: class 1, closed, all reviewed, 3 submissions -> publishable
// lab 8: class 1, closed, 2 verdicts pending
// lab 9: class 1, still open
// lab 30: class 2 (not ta12's)
function seedStore(): InMemoryStore {
  return new InMemoryStore({
    users: [
      { id: 12, role: "ta", token: TOKENS.ta12 },
      { id: 13, role: "ta", token: TOKENS.ta13 },
      { id: 20, role: "ta", token: TOKENS.ta20 },
      { id: 500, role: "student", token: TOKENS.student },
      { id: 1, role: "admin", token: TOKENS.admin },
    ],
    classes: [
      { id: 1, taIds: [12, 13] },
      { id: 2, taIds: [20] },
    ],
    labs: [
      { id: 7, classId: 1, closesAt: new Date("2026-11-10T17:00:00.000Z") },
      { id: 8, classId: 1, closesAt: new Date("2026-11-10T17:00:00.000Z") },
      { id: 9, classId: 1, closesAt: new Date("2026-11-20T17:00:00.000Z") },
      { id: 30, classId: 2, closesAt: new Date("2026-11-10T17:00:00.000Z") },
    ],
    submissions: [
      { id: 1, labId: 7 },
      { id: 2, labId: 7 },
      { id: 3, labId: 7 },
      { id: 4, labId: 8 },
      { id: 5, labId: 8 },
    ],
    reviewItems: [
      { labId: 7, submissionId: 1, reviewed: true },
      { labId: 7, submissionId: 2, reviewed: true },
      { labId: 8, submissionId: 4, reviewed: false },
      { labId: 8, submissionId: 5, reviewed: false },
      { labId: 8, submissionId: 5, reviewed: true },
    ],
  });
}

let store: InMemoryStore;
let app: FastifyInstance;

beforeEach(() => {
  store = seedStore();
  app = buildApp({ store, now: () => NOW });
});

interface Call {
  labId?: string | number;
  token?: string | null;
  authorization?: string;
  contentType?: string | null;
  body?: string;
}

function publish({
  labId = 7,
  token = TOKENS.ta12,
  authorization,
  contentType = "application/json",
  body = JSON.stringify({ confirm: true }),
}: Call = {}): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  else if (token !== null) headers.authorization = `Bearer ${token}`;
  if (contentType !== null) headers["content-type"] = contentType;
  return app.inject({ method: "POST", url: `/v1/labs/${labId}/publish`, headers, body });
}

const TITLES: Record<string, [number, string]> = {
  unauthenticated: [401, "Authentication required"],
  forbidden: [403, "Not allowed for this role"],
  "not-found": [404, "Not found"],
  "unsupported-media-type": [415, "Unsupported media type"],
  "invalid-json": [400, "Malformed JSON"],
  validation: [400, "Invalid request"],
  "lab-still-open": [409, "Lab still open"],
  "reviews-pending": [409, "Reviews pending"],
  "payload-too-large": [413, "Payload too large"],
  internal: [500, "Internal error"],
};
const ALLOWED_MEMBERS = [
  "type",
  "title",
  "status",
  "detail",
  "errors",
  "closesAt",
  "pendingReviews",
];

/** §2: the full problem-details shape, not just the status code. */
function expectProblem(res: LightMyRequestResponse, slug: string): Record<string, unknown> {
  const [status, title] = TITLES[slug] ?? [0, ""];
  expect(res.statusCode, res.body).toBe(status);
  expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
  const body = res.json<Record<string, unknown>>();
  expect(body.type).toBe(PROBLEM + slug);
  expect(body.title).toBe(title);
  expect(body.status).toBe(status);
  expect(typeof body.detail).toBe("string");
  expect(body.detail).not.toMatch(/at .+\.(ts|js):\d+|SELECT|node_modules|-token\b/i);
  for (const key of Object.keys(body)) expect(ALLOWED_MEMBERS).toContain(key);
  return body;
}

describe("§4.4 success", () => {
  it("201 with the Publication, Location, and no Idempotent-Replayed", async () => {
    const res = await publish();
    expect(res.statusCode).toBe(201);
    expect(res.headers.location).toBe("/v1/labs/7/publication");
    expect(res.headers["idempotent-replayed"]).toBeUndefined();
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.json()).toEqual({
      labId: 7,
      status: "published",
      publishedAt: "2026-11-11T14:00:00.000Z",
      publishedBy: 12,
      submissionCount: 3,
    });
  });

  it("accepts a charset parameter on Content-Type", async () => {
    const res = await publish({ contentType: "application/json; charset=utf-8" });
    expect(res.statusCode).toBe(201);
  });

  it("ignores unknown request fields", async () => {
    const res = await publish({ body: JSON.stringify({ confirm: true, note: "hi" }) });
    expect(res.statusCode).toBe(201);
  });
});

describe("§4.5 idempotency and concurrency", () => {
  it("a retry gets 200, the identical stored body, and Idempotent-Replayed: true", async () => {
    const first = await publish();
    const again = await publish();
    expect(again.statusCode).toBe(200);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.headers.location).toBe("/v1/labs/7/publication");
    expect(again.json()).toEqual(first.json());
  });

  it("a later publish by another TA of the class keeps publishedBy and publishedAt", async () => {
    const first = await publish({ token: TOKENS.ta12 });
    const later = buildApp({ store, now: () => new Date("2026-11-12T09:00:00.000Z") });
    const res = await later.inject({
      method: "POST",
      url: "/v1/labs/7/publish",
      headers: { authorization: `Bearer ${TOKENS.ta13}`, "content-type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(first.json());
  });

  it("concurrent requests: exactly one 201, the rest 200 replays of the same body", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => publish()));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 200, 200, 200, 201]);
    const bodies = new Set(results.map((r) => r.body));
    expect(bodies.size).toBe(1);
  });

  it("a failed request publishes nothing", async () => {
    await publish({ body: JSON.stringify({ confirm: false }) });
    expect(await store.publication(7)).toBeUndefined();
  });
});

describe("§4.1 who may call it", () => {
  it("401 unauthenticated without Authorization, with WWW-Authenticate", async () => {
    const res = await publish({ token: null });
    expectProblem(res, "unauthenticated");
    expect(res.headers["www-authenticate"]).toBe('Bearer realm="leetkob"');
  });

  it("401 unauthenticated for an unknown token", async () => {
    expectProblem(await publish({ token: "nope" }), "unauthenticated");
  });

  it("401 unauthenticated when the scheme is not Bearer", async () => {
    expectProblem(await publish({ authorization: `Basic ${TOKENS.ta12}` }), "unauthenticated");
  });

  it("403 forbidden for a student", async () => {
    expectProblem(await publish({ token: TOKENS.student }), "forbidden");
  });

  it("403 forbidden for an admin", async () => {
    expectProblem(await publish({ token: TOKENS.admin }), "forbidden");
  });

  it("ownership: another class's lab is 404, byte-for-byte the same as a missing lab", async () => {
    const other = await publish({ labId: 30 });
    const missing = await publish({ labId: 999 });
    expectProblem(other, "not-found");
    expect(other.body).toBe(missing.body);
    expect(await store.publication(30)).toBeUndefined();
  });

  it("ownership holds in the other direction too (TA of class 2 on class 1's lab)", async () => {
    expectProblem(await publish({ token: TOKENS.ta20, labId: 7 }), "not-found");
  });

  it("the owning TA of class 2 can publish lab 30", async () => {
    expect((await publish({ token: TOKENS.ta20, labId: 30 })).statusCode).toBe(201);
  });
});

describe("§2 / §4.3 each error type", () => {
  it.each(["0", "-1", "abc", "7.5", "2147483648", "07"])(
    "404 not-found for labId %s",
    async (id) => {
      expectProblem(await publish({ labId: id }), "not-found");
    },
  );

  it("415 unsupported-media-type without Content-Type", async () => {
    expectProblem(await publish({ contentType: null }), "unsupported-media-type");
  });

  it("415 unsupported-media-type for text/plain", async () => {
    expectProblem(await publish({ contentType: "text/plain" }), "unsupported-media-type");
  });

  it("400 invalid-json for a broken body", async () => {
    expectProblem(await publish({ body: '{"confirm": tru' }), "invalid-json");
  });

  it("400 invalid-json for an empty body", async () => {
    expectProblem(await publish({ body: "" }), "invalid-json");
  });

  it.each([
    ["missing", "{}"],
    ["false", '{"confirm": false}'],
    ["a string", '{"confirm": "true"}'],
    ["a number", '{"confirm": 1}'],
  ])("400 validation when confirm is %s, pointer /confirm", async (_name, body) => {
    const problem = expectProblem(await publish({ body }), "validation");
    expect(problem.errors).toEqual([{ pointer: "/confirm", detail: expect.any(String) as string }]);
  });

  it.each(["[]", "null", '"confirm"', "42"])(
    "400 validation, pointer '' for body %s",
    async (body) => {
      const problem = expectProblem(await publish({ body }), "validation");
      expect(problem.errors).toEqual([{ pointer: "", detail: expect.any(String) as string }]);
    },
  );

  it("409 lab-still-open with closesAt", async () => {
    const problem = expectProblem(await publish({ labId: 9 }), "lab-still-open");
    expect(problem.closesAt).toBe("2026-11-20T17:00:00.000Z");
    expect(await store.publication(9)).toBeUndefined();
  });

  it("409 reviews-pending with pendingReviews, and nothing is published", async () => {
    const problem = expectProblem(await publish({ labId: 8 }), "reviews-pending");
    expect(problem.pendingReviews).toBe(2);
    expect(await store.publication(8)).toBeUndefined();
  });

  it("after the reviews are done, the same lab publishes", async () => {
    store.markAllReviewed(8);
    expect((await publish({ labId: 8 })).statusCode).toBe(201);
  });

  it("500 internal with a generic detail that leaks nothing", async () => {
    class BrokenStore extends InMemoryStore {
      override userByToken(): ReturnType<Store["userByToken"]> {
        return Promise.reject(new Error("SELECT * FROM users -- connection refused"));
      }
    }
    const broken = new BrokenStore();
    const res = await buildApp({ store: broken, now: () => NOW }).inject({
      method: "POST",
      url: "/v1/labs/7/publish",
      headers: { authorization: `Bearer ${TOKENS.ta12}`, "content-type": "application/json" },
      body: "{}",
    });
    const problem = expectProblem(res, "internal");
    expect(problem.detail).not.toMatch(/SELECT|connection/);
  });
});

describe("§4.3 step 0: body size", () => {
  const padded = (size: number): string => {
    const json = JSON.stringify({ confirm: true });
    return json + " ".repeat(size - json.length);
  };

  it("a body of exactly 1024 bytes is accepted", async () => {
    expect((await publish({ body: padded(1024) })).statusCode).toBe(201);
  });

  it("413 payload-too-large at 1025 bytes, and nothing is published", async () => {
    expectProblem(await publish({ body: padded(1025) }), "payload-too-large");
    expect(await store.publication(7)).toBeUndefined();
  });

  it("413 comes before authentication", async () => {
    expectProblem(await publish({ token: null, body: padded(5000) }), "payload-too-large");
  });
});

describe("§4.8 GET /v1/labs/{labId}/publication", () => {
  const read = (labId: number | string, token: string | null = TOKENS.ta12) =>
    app.inject({
      method: "GET",
      url: `/v1/labs/${labId}/publication`,
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    });

  it("200 with the body the publish 201 returned, at the Location it gave", async () => {
    const created = await publish();
    const location = created.headers.location as string;
    const res = await app.inject({
      method: "GET",
      url: location,
      headers: { authorization: `Bearer ${TOKENS.ta12}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.json()).toEqual(created.json());
  });

  it("404 not-found when the lab is not published yet", async () => {
    expectProblem(await read(7), "not-found");
  });

  it("401 unauthenticated without a token", async () => {
    expectProblem(await read(7, null), "unauthenticated");
  });

  it("403 forbidden for a student", async () => {
    expectProblem(await read(7, TOKENS.student), "forbidden");
  });

  it("ownership: another class's published lab is 404, identical to a missing lab", async () => {
    await publish({ token: TOKENS.ta20, labId: 30 });
    const other = await read(30);
    const missing = await read(999);
    expectProblem(other, "not-found");
    expect(other.body).toBe(missing.body);
  });

  it("reading changes nothing: a later publish is still the first 201", async () => {
    await read(7);
    expect((await publish()).statusCode).toBe(201);
  });
});

describe("§4.3 order of checks", () => {
  it("401 before 403/404: no token on another class's lab with a broken body", async () => {
    expectProblem(await publish({ token: null, labId: 30, body: "{" }), "unauthenticated");
  });

  it("403 before 404: a student on a missing lab", async () => {
    expectProblem(await publish({ token: TOKENS.student, labId: 999 }), "forbidden");
  });

  it("404 before 415/400: another class's lab with a broken body reveals nothing", async () => {
    expectProblem(await publish({ labId: 30, contentType: "text/plain", body: "{" }), "not-found");
  });

  it("415 before 400 invalid-json", async () => {
    expectProblem(
      await publish({ contentType: "text/plain", body: "{" }),
      "unsupported-media-type",
    );
  });

  it("400 validation before 409: an open lab with confirm missing", async () => {
    expectProblem(await publish({ labId: 9, body: "{}" }), "validation");
  });

  it("409 lab-still-open before reviews-pending", async () => {
    const s = new InMemoryStore({
      users: [{ id: 12, role: "ta", token: TOKENS.ta12 }],
      classes: [{ id: 1, taIds: [12] }],
      labs: [{ id: 9, classId: 1, closesAt: new Date("2026-11-20T17:00:00.000Z") }],
      reviewItems: [{ labId: 9, submissionId: 1, reviewed: false }],
    });
    app = buildApp({ store: s, now: () => NOW });
    expectProblem(await publish({ labId: 9 }), "lab-still-open");
  });
});
