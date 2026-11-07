import type { FastifyReply } from "fastify";

/** Base URI of every problem `type`. See docs/contract/publish.md §2. */
export const PROBLEM_BASE = "https://leetkob.example/problems/";

export const PROBLEMS = {
  unauthenticated: { status: 401, title: "Authentication required" },
  forbidden: { status: 403, title: "Not allowed for this role" },
  "not-found": { status: 404, title: "Not found" },
  "unsupported-media-type": { status: 415, title: "Unsupported media type" },
  "invalid-json": { status: 400, title: "Malformed JSON" },
  "payload-too-large": { status: 413, title: "Payload too large" },
  validation: { status: 400, title: "Invalid request" },
  "lab-still-open": { status: 409, title: "Lab still open" },
  "reviews-pending": { status: 409, title: "Reviews pending" },
  internal: { status: 500, title: "Internal error" },
} as const;

export type ProblemSlug = keyof typeof PROBLEMS;

export interface FieldError {
  pointer: string;
  detail: string;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  [extension: string]: unknown;
}

export function problem(
  slug: ProblemSlug,
  detail: string,
  extensions: Record<string, unknown> = {},
): Problem {
  const { status, title } = PROBLEMS[slug];
  return { type: PROBLEM_BASE + slug, title, status, detail, ...extensions };
}

export function sendProblem(
  reply: FastifyReply,
  slug: ProblemSlug,
  detail: string,
  extensions: Record<string, unknown> = {},
): FastifyReply {
  const body = problem(slug, detail, extensions);
  return reply.code(body.status).type("application/problem+json").send(body);
}
