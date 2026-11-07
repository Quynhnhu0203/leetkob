import Fastify, { type FastifyInstance } from "fastify";
import { sendProblem } from "./problems.js";
import type { Store } from "./store.js";

export interface AppOptions {
  store: Store;
  now?: () => Date;
  logger?: boolean;
}

// `store` and `now` are wired into the routes as they are added (first one: publish).
export function buildApp({ logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });

  // Keep the raw body; each route parses it itself so that the order of checks
  // in the contract (auth before body) holds.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => done(null, body));

  app.setNotFoundHandler((_req, reply) => sendProblem(reply, "not-found", "No such resource."));

  app.setErrorHandler((err, req, reply) => {
    req.log.error(err);
    return sendProblem(reply, "internal", "Something went wrong on our side.");
  });

  return app;
}
