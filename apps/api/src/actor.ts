import type { FastifyRequest } from 'fastify';
import type { Actor } from './db.js';
import { requireCondition } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

// The signed-in caller, or 401. A leaf module so the auth, MFA and password modules can all
// use it without importing each other in a cycle.
export function authenticated(req: FastifyRequest): Actor {
  requireCondition(req.actor, 'UNAUTHENTICATED', 401);
  return req.actor;
}
