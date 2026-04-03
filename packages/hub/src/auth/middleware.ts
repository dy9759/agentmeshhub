import type { FastifyRequest, FastifyReply } from "fastify";
import type { AuthContext } from "./types.js";
import { verifyAgentToken } from "./agent-token.js";
import type { ApiKeyStore } from "./api-key.js";
import { safeCompare } from "./api-key.js";

/**
 * Fastify authentication middleware
 *
 * 3-layer auth resolution:
 * 1. Agent Token (JWT) — per-agent identity
 * 2. Owner API Key — owner-level access
 * 3. Static API Key (env) — dev/single-user fallback
 *
 * Skips auth for public endpoints: /health, /api/owners (POST)
 */

const PUBLIC_PATHS = new Set(["/health", "/ws"]);

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  // POST /api/owners is public (create owner to get API key)
  return false;
}

export function createAuthMiddleware(apiKeyStore: ApiKeyStore) {
  return async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (isPublicPath(request.url)) return;

    // Allow POST /api/owners without auth
    if (request.url === "/api/owners" && request.method === "POST") return;

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      request.log.warn({ method: request.method, url: request.url }, `AUTH REJECTED 401 ${request.method} ${request.url} — Missing or invalid Authorization header`);
      reply.code(401).send({ error: "Missing or invalid Authorization header" });
      return;
    }

    const token = authHeader.slice(7);

    // Layer 1: Try Agent Token (JWT)
    const agentPayload = await verifyAgentToken(token);
    if (agentPayload) {
      const auth: AuthContext = {
        type: "agent",
        ownerId: agentPayload.ownerId,
        agentId: agentPayload.sub,
      };
      (request as FastifyRequest & { auth: AuthContext }).auth = auth;
      if (request.url !== "/health") {
        request.log.info({ method: request.method, url: request.url, authType: auth.type, ownerId: auth.ownerId, agentId: auth.agentId }, "AUTH OK");
      }
      return;
    }

    // Layer 2: Try Owner API Key
    const owner = await apiKeyStore.findOwnerByApiKey(token);
    if (owner) {
      const auth: AuthContext = {
        type: "owner",
        ownerId: owner.ownerId,
      };
      (request as FastifyRequest & { auth: AuthContext }).auth = auth;
      if (request.url !== "/health") {
        request.log.info({ method: request.method, url: request.url, authType: auth.type, ownerId: auth.ownerId }, "AUTH OK");
      }
      return;
    }

    // Layer 3: Static API Key from env (dev fallback)
    const staticKey = process.env.AGENTMESH_API_KEY;
    if (staticKey && safeCompare(token, staticKey)) {
      const auth: AuthContext = {
        type: "owner",
        ownerId: "static-owner",
      };
      (request as FastifyRequest & { auth: AuthContext }).auth = auth;
      if (request.url !== "/health") {
        request.log.info({ method: request.method, url: request.url, authType: auth.type, ownerId: auth.ownerId }, "AUTH OK");
      }
      return;
    }

    const tokenPreview = token.slice(0, 8) + "...";
    request.log.warn({ method: request.method, url: request.url, tokenPreview }, `AUTH REJECTED 401 ${request.method} ${request.url} — Invalid token or API key (${tokenPreview})`);
    reply.code(401).send({ error: "Invalid token or API key" });
  };
}

/**
 * Extract auth context from request (use after middleware)
 */
export function getAuth(request: FastifyRequest): AuthContext {
  return (request as FastifyRequest & { auth: AuthContext }).auth;
}
