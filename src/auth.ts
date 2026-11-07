import type { FastifyRequest } from "fastify";
import type { Store, User } from "./store.js";

/** Returns the caller, or undefined when the bearer token is missing, malformed or unknown. */
export async function authenticate(req: FastifyRequest, store: Store): Promise<User | undefined> {
  const header = req.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header);
  if (!match?.[1]) return undefined;
  return store.userByToken(match[1]);
}
