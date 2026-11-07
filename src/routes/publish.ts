import type { FastifyInstance } from "fastify";
import { sendProblem, type FieldError } from "../problems.js";
import { authenticate } from "../auth.js";
import type { Store } from "../store.js";

const MAX_ID = 2_147_483_647;

function parseId(raw: string): number | undefined {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return undefined;
  const id = Number(raw);
  return id <= MAX_ID ? id : undefined;
}

function isJsonContentType(header: string | undefined): boolean {
  if (!header) return false;
  const [mediaType] = header.split(";");
  return mediaType?.trim().toLowerCase() === "application/json";
}

/**
 * POST /v1/labs/{labId}/publish — docs/contract/publish.md §4.
 * The order of the checks below is part of the contract (§4.3). Do not reorder.
 */
export function registerPublish(app: FastifyInstance, store: Store, now: () => Date): void {
  app.post<{ Params: { labId: string } }>("/v1/labs/:labId/publish", async (req, reply) => {
    // 1. Who is calling.
    const user = await authenticate(req, store);
    if (!user) {
      void reply.header("WWW-Authenticate", 'Bearer realm="leetkob"');
      return sendProblem(reply, "unauthenticated", "A valid bearer token is required.");
    }

    // 2. Role.
    if (user.role !== "ta") {
      return sendProblem(reply, "forbidden", "Only a teaching assistant can publish marks.");
    }

    // 3. The lab exists and belongs to one of the caller's classes.
    //    A lab of another class is indistinguishable from a lab that does not exist.
    const labId = parseId(req.params.labId);
    const lab = labId === undefined ? undefined : await store.lab(labId);
    if (!lab) {
      return sendProblem(reply, "not-found", "No lab with this id in your classes.");
    }
    if (!(await store.isTaOfClass(user.id, lab.classId))) {
      return sendProblem(reply, "forbidden", "You are not a TA of this lab's class.");
    }

    // 4. Media type.
    if (!isJsonContentType(req.headers["content-type"])) {
      return sendProblem(reply, "unsupported-media-type", "Send the body as application/json.");
    }

    // 5. Body is JSON.
    let body: unknown;
    try {
      body = JSON.parse(typeof req.body === "string" ? req.body : "");
    } catch {
      return sendProblem(reply, "invalid-json", "The request body is not valid JSON.");
    }

    // 6. Body follows the field rules.
    const errors: FieldError[] = [];
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      errors.push({ pointer: "", detail: "must be a JSON object" });
    } else if ((body as Record<string, unknown>).confirm !== true) {
      errors.push({ pointer: "/confirm", detail: "must be the boolean true" });
    }
    if (errors.length > 0) {
      return sendProblem(reply, "validation", `${errors.length} field(s) are invalid.`, { errors });
    }

    // 7. Already published: replay the stored publication.
    const existing = await store.publication(lab.id);
    if (existing) {
      return reply
        .code(200)
        .header("Idempotent-Replayed", "true")
        .header("Location", `/v1/labs/${lab.id}/publication`)
        .send(existing);
    }

    // 8. Submissions may still arrive.
    const at = now();
    if (at < lab.closesAt) {
      return sendProblem(reply, "lab-still-open", "The lab has not closed yet.", {
        closesAt: lab.closesAt.toISOString(),
      });
    }

    // 9. Every verdict in the review queue has been reviewed.
    const pending = await store.pendingReviewCount(lab.id);
    if (pending > 0) {
      return sendProblem(reply, "reviews-pending", `${pending} verdict(s) still await review.`, {
        pendingReviews: pending,
      });
    }

    // 10. Publish (atomic; a concurrent request that lost the race gets the replay).
    const { created, publication } = await store.publish(lab.id, user.id, at);
    reply.header("Location", `/v1/labs/${lab.id}/publication`);
    if (!created) reply.header("Idempotent-Replayed", "true");
    return reply.code(created ? 201 : 200).send(publication);
  });
}
