import Fastify, { type FastifyInstance } from "fastify";
import { sendProblem } from "./problems.js";
import { registerPublish } from "./routes/publish.js";
import { registerLabRoutes } from "./routes/labs.js";
import { registerSubmissionRoutes } from "./routes/submissions.js";
import { InMemorySubmissionQueue, type SubmissionQueue } from "./queue/queue.js";
import { JudgeWorker } from "./queue/worker.js";
import { reviewConstraints } from "./reviewer/limits.js";
import { OfflineFakeModelClient, GeminiModelClient } from "./model/client.js";
import { renderAppHtml } from "./ui/html.js";
import type { Store } from "./store.js";

export interface AppOptions {
  store: Store;
  queue?: SubmissionQueue;
  worker?: JudgeWorker;
  now?: () => Date;
  logger?: boolean;
}

export function buildApp({
  store,
  queue,
  worker,
  now = () => new Date(),
  logger = false,
}: AppOptions): FastifyInstance {
  const app = Fastify({ logger });

  const activeQueue = queue ?? new InMemorySubmissionQueue();

  const modelClient = process.env.GEMINI_API_KEY
    ? new GeminiModelClient()
    : new OfflineFakeModelClient({
        "C2:void mergeSort(int l, int r)": {
          verdict: "pass",
          evidence: [],
        },
      });

  const activeWorker =
    worker ??
    new JudgeWorker({
      queue: activeQueue,
      store,
      reviewerFn: (code, lab, constraints) =>
        reviewConstraints(code, lab, constraints, modelClient),
    });

  // Keep the raw body; each route parses it itself so that the order of checks
  // in the contract (auth before body) holds.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => done(null, body));

  // 1. Interactive Web UI
  app.get("/", (_req, reply) => reply.type("text/html").send(renderAppHtml()));
  app.get("/ui", (_req, reply) => reply.type("text/html").send(renderAppHtml()));

  // 2. API Routes
  registerPublish(app, store, now);
  registerLabRoutes(app, store);
  registerSubmissionRoutes(app, store, activeQueue, activeWorker);

  app.setNotFoundHandler((_req, reply) => sendProblem(reply, "not-found", "No such resource."));

  app.setErrorHandler((err, req, reply) => {
    // Contract §4.3 step 0: Fastify rejects an over-limit body before the handler runs.
    if ((err as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return sendProblem(reply, "payload-too-large", "The request body is too large.");
    }
    req.log.error(err);
    return sendProblem(reply, "internal", "Something went wrong on our side.");
  });

  return app;
}
