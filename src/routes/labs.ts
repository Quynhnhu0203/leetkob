import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendProblem } from "../problems.js";
import { authenticate } from "../auth.js";
import type { Store, User, Lab, Constraint } from "../store.js";

type LabParams = { Params: { labId: string } };
type ReviewParams = { Params: { labId: string; submissionId: string; constraintId: string } };

function parseId(raw: string): number | undefined {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return undefined;
  const id = Number(raw);
  return id <= 2_147_483_647 ? id : undefined;
}

async function requireTaLab(
  req: FastifyRequest<LabParams>,
  reply: FastifyReply,
  store: Store,
): Promise<{ user: User; lab: Lab } | undefined> {
  const user = await authenticate(req, store);
  if (!user) {
    void reply.header("WWW-Authenticate", 'Bearer realm="leetkob"');
    void sendProblem(reply, "unauthenticated", "A valid bearer token is required.");
    return undefined;
  }

  if (user.role !== "ta") {
    void sendProblem(reply, "forbidden", "Only a teaching assistant can perform this action.");
    return undefined;
  }

  const labId = parseId(req.params.labId);
  const lab = labId === undefined ? undefined : await store.lab(labId);
  if (!lab || !(await store.isTaOfClass(user.id, lab.classId))) {
    void sendProblem(reply, "not-found", "No lab with this id in your classes.");
    return undefined;
  }
  return { user, lab };
}

export function registerLabRoutes(app: FastifyInstance, store: Store): void {
  // GET /v1/labs — List labs visible to caller (FAQ-01 class isolation)
  app.get("/v1/labs", async (req, reply) => {
    const user = await authenticate(req, store);
    if (!user) {
      void reply.header("WWW-Authenticate", 'Bearer realm="leetkob"');
      return sendProblem(reply, "unauthenticated", "A valid bearer token is required.");
    }
    const labs = await store.listLabsForUser(user);
    return reply.code(200).send({ labs });
  });

  // POST /v1/labs — TA creates a lab
  app.post("/v1/labs", async (req, reply) => {
    const user = await authenticate(req, store);
    if (!user) {
      void reply.header("WWW-Authenticate", 'Bearer realm="leetkob"');
      return sendProblem(reply, "unauthenticated", "A valid bearer token is required.");
    }
    if (user.role !== "ta") {
      return sendProblem(reply, "forbidden", "Only a teaching assistant can create a lab.");
    }

    let body: { classId?: number; name?: string; statement?: string; closesAt?: string };
    try {
      const parsed: unknown = JSON.parse(typeof req.body === "string" ? req.body : "{}");
      body = parsed as { classId?: number; name?: string; statement?: string; closesAt?: string };
    } catch {
      return sendProblem(reply, "invalid-json", "Malformed JSON body.");
    }

    if (!body.classId || typeof body.classId !== "number") {
      return sendProblem(reply, "validation", "classId must be a positive integer.");
    }

    if (!(await store.isTaOfClass(user.id, body.classId))) {
      return sendProblem(reply, "forbidden", "You are not a TA of this class.");
    }

    const closesAt = body.closesAt
      ? new Date(body.closesAt)
      : new Date(Date.now() + 7 * 24 * 3600 * 1000);
    if (Number.isNaN(closesAt.getTime())) {
      return sendProblem(reply, "validation", "closesAt must be a valid ISO timestamp.");
    }
    const lab = await store.createLab({
      classId: body.classId,
      name: body.name ?? "Sorting Lab",
      statement: body.statement ?? "",
      closesAt,
    });

    return reply.code(201).send(lab);
  });

  // GET /v1/labs/:labId — Get lab details
  app.get<LabParams>("/v1/labs/:labId", async (req, reply) => {
    const user = await authenticate(req, store);
    if (!user) {
      void reply.header("WWW-Authenticate", 'Bearer realm="leetkob"');
      return sendProblem(reply, "unauthenticated", "A valid bearer token is required.");
    }

    const labId = parseId(req.params.labId);
    const lab = labId === undefined ? undefined : await store.lab(labId);
    if (!lab) {
      return sendProblem(reply, "not-found", "Lab not found.");
    }

    if (user.role === "ta" && !(await store.isTaOfClass(user.id, lab.classId))) {
      return sendProblem(reply, "not-found", "Lab not found in your classes.");
    }
    if (user.role === "student" && !(await store.isStudentOfClass(user.id, lab.classId))) {
      return sendProblem(reply, "not-found", "Lab not found in your classes.");
    }

    const constraints = await store.getConstraints(lab.id);
    return reply.code(200).send({ ...lab, constraints });
  });

  // POST /v1/labs/:labId/constraints — TA adds a constraint
  app.post<LabParams>("/v1/labs/:labId/constraints", async (req, reply) => {
    const found = await requireTaLab(req, reply, store);
    if (!found) return reply;

    let body: { id?: string; text?: string; deduction?: number };
    try {
      const parsed: unknown = JSON.parse(typeof req.body === "string" ? req.body : "{}");
      body = parsed as { id?: string; text?: string; deduction?: number };
    } catch {
      return sendProblem(reply, "invalid-json", "Malformed JSON body.");
    }

    if (
      !body.id ||
      !body.text ||
      typeof body.deduction !== "number" ||
      !Number.isFinite(body.deduction) ||
      body.deduction < 0
    ) {
      return sendProblem(
        reply,
        "validation",
        "id, text, and a non-negative deduction are required.",
      );
    }

    const constraint: Constraint = {
      id: body.id,
      text: body.text,
      deduction: body.deduction,
    };
    await store.addConstraint(found.lab.id, constraint);
    return reply.code(201).send(constraint);
  });

  // POST /v1/labs/:labId/tests — TA adds a testcase
  app.post<LabParams>("/v1/labs/:labId/tests", async (req, reply) => {
    const found = await requireTaLab(req, reply, store);
    if (!found) return reply;

    let body: { input?: string; expectedOutput?: string };
    try {
      const parsed: unknown = JSON.parse(typeof req.body === "string" ? req.body : "{}");
      body = parsed as { input?: string; expectedOutput?: string };
    } catch {
      return sendProblem(reply, "invalid-json", "Malformed JSON body.");
    }

    const t = await store.addTest(found.lab.id, {
      input: body.input ?? "",
      expectedOutput: body.expectedOutput ?? "",
    });
    return reply.code(201).send(t);
  });

  // GET /v1/labs/:labId/reviews — TA opens the review queue
  app.get<LabParams>("/v1/labs/:labId/reviews", async (req, reply) => {
    const found = await requireTaLab(req, reply, store);
    if (!found) return reply;

    const queue = await store.getReviewQueue(found.lab.id);
    return reply.code(200).send({
      labId: found.lab.id,
      pendingCount: queue.filter((item) => !item.reviewed).length,
      items: queue,
    });
  });

  // PUT /v1/labs/:labId/reviews/:submissionId/:constraintId — TA reviews a verdict
  app.put<ReviewParams>(
    "/v1/labs/:labId/reviews/:submissionId/:constraintId",
    async (req, reply) => {
      const found = await requireTaLab(req, reply, store);
      if (!found) return reply;

      const subId = parseId(req.params.submissionId);
      if (!subId) {
        return sendProblem(reply, "validation", "Invalid submissionId.");
      }

      let body: {
        verdict?: string;
        evidence?: Array<{ line?: unknown; text?: unknown }>;
      };
      try {
        const parsed: unknown = JSON.parse(typeof req.body === "string" ? req.body : "{}");
        body = parsed as {
          verdict?: string;
          evidence?: Array<{ line?: unknown; text?: unknown }>;
        };
      } catch {
        return sendProblem(reply, "invalid-json", "Malformed JSON body.");
      }

      // Theo FAQ-09: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-09
      // TA must resolve review items to either "pass" or "violation" (never confirm as "unsure").
      if (body.verdict !== "pass" && body.verdict !== "violation") {
        return sendProblem(reply, "validation", "verdict must be pass or violation.");
      }

      let validEvidence: Array<{ line: number; text: string }> | undefined;
      if (body.evidence !== undefined) {
        if (!Array.isArray(body.evidence)) {
          return sendProblem(reply, "validation", "evidence must be an array.");
        }
        validEvidence = [];
        for (const item of body.evidence) {
          if (
            !item ||
            typeof item !== "object" ||
            typeof item.line !== "number" ||
            !Number.isInteger(item.line) ||
            item.line < 1 ||
            typeof item.text !== "string"
          ) {
            return sendProblem(
              reply,
              "validation",
              "Each evidence entry must have an integer line >= 1 and string text.",
            );
          }
          validEvidence.push({ line: item.line, text: item.text });
        }
      }

      const existingItem = await store.getReviewItem(found.lab.id, subId, req.params.constraintId);
      if (!existingItem) {
        return sendProblem(reply, "not-found", "Review item not found.");
      }

      if (body.verdict === "violation") {
        const effectiveEvidence = validEvidence ?? existingItem.evidence;
        if (effectiveEvidence.length === 0) {
          return sendProblem(
            reply,
            "validation",
            "At least one evidence line is required when selecting violation (FAQ-09).",
          );
        }
      }

      const updated = await store.updateReviewItem(
        found.lab.id,
        subId,
        req.params.constraintId,
        body.verdict,
        found.user.id,
        validEvidence,
      );

      if (!updated) {
        return sendProblem(reply, "not-found", "Review item not found.");
      }

      return reply.code(200).send({ success: true, verdict: body.verdict });
    },
  );
}
