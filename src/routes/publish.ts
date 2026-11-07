import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendProblem, type FieldError } from "../problems.js";
import { authenticate } from "../auth.js";
import type { Lab, Store, User } from "../store.js";

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

/** Contract §4.2: the whole body is at most this many bytes (step 0 of §4.3). */
export const PUBLISH_BODY_LIMIT = 1024;

type LabParams = { Params: { labId: string } };

/**
 * Steps 1–3 of §4.3, shared by both routes so their access rules cannot drift apart.
 * Sends the problem and returns undefined when a step fails.
 */
async function taLab(
  req: FastifyRequest<LabParams>,
  reply: FastifyReply,
  store: Store,
): Promise<{ user: User; lab: Lab } | undefined> {
  // 1. Who is calling.
  const user = await authenticate(req, store);
  if (!user) {
    void reply.header("WWW-Authenticate", 'Bearer realm="leetkob"');
    void sendProblem(reply, "unauthenticated", "A valid bearer token is required.");
    return undefined;
  }

  // 2. Role.
  if (user.role !== "ta") {
    void sendProblem(reply, "forbidden", "Only a teaching assistant can publish marks.");
    return undefined;
  }

  // 3. The lab exists and belongs to one of the caller's classes.
  //    A lab of another class is indistinguishable from a lab that does not exist.
  const labId = parseId(req.params.labId);
  const lab = labId === undefined ? undefined : await store.lab(labId);
  if (!lab || !(await store.isTaOfClass(user.id, lab.classId))) {
    void sendProblem(reply, "not-found", "No lab with this id in your classes.");
    return undefined;
  }
  return { user, lab };
}

/**
 * POST /v1/labs/{labId}/publish and GET /v1/labs/{labId}/publication —
 * docs/contract/publish.md §4. The order of the checks is part of the contract (§4.3).
 */
export function registerPublish(app: FastifyInstance, store: Store, now: () => Date): void {
  // §4.8 — read the publication.
  app.get<LabParams>("/v1/labs/:labId/publication", async (req, reply) => {
    const found = await taLab(req, reply, store);
    if (!found) return reply;
    const publication = await store.publication(found.lab.id);
    if (!publication) {
      return sendProblem(reply, "not-found", "This lab has not been published yet.");
    }
    return reply.code(200).send(publication);
  });

  // §4.2–§4.7 — publish. Step 0 (body size) is enforced by Fastify via bodyLimit.
  app.post<LabParams>(
    "/v1/labs/:labId/publish",
    { bodyLimit: PUBLISH_BODY_LIMIT },
    async (req, reply) => {
      const found = await taLab(req, reply, store);
      if (!found) return reply;
      const { user, lab } = found;

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
        return sendProblem(reply, "validation", `${errors.length} field(s) are invalid.`, {
          errors,
        });
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
    },
  );
}
