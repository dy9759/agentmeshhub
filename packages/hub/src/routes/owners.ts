import type { FastifyInstance } from "fastify";
import { CreateOwnerRequestSchema } from "@agentmesh/shared";
import type { OwnerService } from "../services/owner.service.js";
import { getAuth } from "../auth/middleware.js";

const createOwnerRateLimit = new Map<string, number>(); // IP -> last create time

export function ownerRoutes(app: FastifyInstance, ownerService: OwnerService) {
  // Create owner (public endpoint)
  app.post("/api/owners", async (request, reply) => {
    // Rate limit: 1 creation per 10 seconds per IP
    const ip = request.ip;
    const lastCreate = createOwnerRateLimit.get(ip) ?? 0;
    if (Date.now() - lastCreate < 10000) {
      reply.code(429).send({ error: "Too many requests. Wait 10 seconds." });
      return;
    }
    createOwnerRateLimit.set(ip, Date.now());

    const body = CreateOwnerRequestSchema.parse(request.body);
    const result = await ownerService.create(body.name);
    reply.code(201).send(result);
  });

  // Rotate API key
  app.post("/api/owners/rotate-key", async (request, reply) => {
    const auth = getAuth(request);
    if (!auth?.ownerId) {
      reply.code(401).send({ error: "Owner authentication required" });
      return;
    }
    const result = await ownerService.rotateApiKey(auth.ownerId);
    reply.send(result);
  });

  // Get current owner info (whoami)
  app.get("/api/owners/me", async (request, reply) => {
    const auth = getAuth(request);
    if (!auth?.ownerId) {
      reply.code(401).send({ error: "Owner authentication required" });
      return;
    }
    const owner = await ownerService.findById(auth.ownerId);
    if (!owner) {
      reply.code(404).send({ error: "Owner not found" });
      return;
    }
    return owner;
  });
}
