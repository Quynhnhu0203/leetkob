import type { FastifyInstance } from "fastify";
import { sendProblem } from "../problems.js";
import { authenticate } from "../auth.js";
import type { Store } from "../store.js";
import type { SubmissionQueue } from "../queue/queue.js";
import type { JudgeWorker } from "../queue/worker.js";

type LabParams = { Params: { labId: string } };
type SubmissionParams = { Params: { submissionId: string } };

function parseId(raw: string): number | undefined {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return undefined;
  const id = Number(raw);
  return id <= 2_147_483_647 ? id : undefined;
}

export function registerSubmissionRoutes(
  app: FastifyInstance,
  store: Store,
  queue: SubmissionQueue,
  worker?: JudgeWorker,
): void {
  // POST /v1/labs/:labId/submissions — Student submits C++ code
  app.post<LabParams>("/v1/labs/:labId/submissions", async (req, reply) => {
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

    let body: { code?: string };
    try {
      const parsed: unknown = JSON.parse(typeof req.body === "string" ? req.body : "{}");
      body = parsed as { code?: string };
    } catch {
      return sendProblem(reply, "invalid-json", "Malformed JSON body.");
    }

    if (!body.code || typeof body.code !== "string") {
      return sendProblem(reply, "validation", "code must be a non-empty string.");
    }

    const sub = await store.createSubmission({
      labId: lab.id,
      studentId: user.id,
      code: body.code,
    });

    await queue.enqueue({
      submissionId: sub.id,
      labId: lab.id,
      code: body.code,
    });

    // If worker is running in inline / background mode, process job
    if (worker) {
      void worker.processNext();
    }

    return reply.code(202).send({
      id: sub.id,
      labId: lab.id,
      status: "queued",
      submittedAt: sub.submittedAt.toISOString(),
    });
  });

  // GET /v1/submissions/:submissionId — Read submission
  app.get<SubmissionParams>("/v1/submissions/:submissionId", async (req, reply) => {
    const user = await authenticate(req, store);
    if (!user) {
      void reply.header("WWW-Authenticate", 'Bearer realm="leetkob"');
      return sendProblem(reply, "unauthenticated", "A valid bearer token is required.");
    }

    const subId = parseId(req.params.submissionId);
    const sub = subId === undefined ? undefined : await store.submission(subId);
    if (!sub) {
      return sendProblem(reply, "not-found", "Submission not found.");
    }

    const lab = await store.lab(sub.labId);
    if (!lab) {
      return sendProblem(reply, "not-found", "Lab not found.");
    }

    // Role check and ownership check
    if (user.role === "student") {
      // A student can only view their own submission
      // Other submissions return 404 identical to non-existent (FAQ-01, Threat A1)
      if (sub.studentId !== user.id) {
        return sendProblem(reply, "not-found", "Submission not found.");
      }

      // Check if lab has been published
      const pub = await store.publication(lab.id);
      const isPublished = Boolean(pub);

      // As per FAQ-08: Before publishing, student sees ONLY test status (AC, WA, etc.)
      // Constraint review results and evidence remain hidden!
      return reply.code(200).send({
        id: sub.id,
        labId: sub.labId,
        status: sub.status,
        testVerdict: sub.testVerdict,
        submittedAt: sub.submittedAt.toISOString(),
        published: isPublished,
        // Before publish, constraint review is hidden
        constraintReview: isPublished ? "published" : "hidden_until_published",
      });
    }

    if (user.role === "ta") {
      // A TA of another class gets 404 (Threat A2, Rubric Criterion 1)
      if (!(await store.isTaOfClass(user.id, lab.classId))) {
        return sendProblem(reply, "not-found", "Submission not found in your classes.");
      }

      const reviewItems = await store.getReviewQueue(lab.id);
      const subReviews = reviewItems.filter((r) => r.submissionId === sub.id);

      return reply.code(200).send({
        id: sub.id,
        labId: sub.labId,
        studentId: sub.studentId,
        code: sub.code,
        status: sub.status,
        testVerdict: sub.testVerdict,
        submittedAt: sub.submittedAt.toISOString(),
        reviews: subReviews,
      });
    }

    // Admin can see everything
    return reply.code(200).send(sub);
  });
}
