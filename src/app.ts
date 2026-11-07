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
    req.log.error(err);
    return sendProblem(reply, "internal", "Something went wrong on our side.");
  });

  return app;
}
