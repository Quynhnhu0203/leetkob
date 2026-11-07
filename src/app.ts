import Fastify, { type FastifyInstance } from "fastify";
import { sendProblem } from "./problems.js";
import { registerPublish } from "./routes/publish.js";
import type { Store } from "./store.js";

export interface AppOptions {
  store: Store;
  now?: () => Date;
  logger?: boolean;
}

export function buildApp({
  store,
  now = () => new Date(),
  logger = false,
}: AppOptions): FastifyInstance {
  const app = Fastify({ logger });

  // Keep the raw body; each route parses it itself so that the order of checks
  // in the contract (auth before body) holds.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => done(null, body));

  registerPublish(app, store, now);

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
