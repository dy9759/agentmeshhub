import type { FastifyInstance } from "fastify";
import { CreateOwnerRequestSchema } from "@agentmesh/shared";
import type { OwnerService } from "../services/owner.service.js";
import { getAuth } from "../auth/middleware.js";

export function ownerRoutes(app: FastifyInstance, ownerService: OwnerService) {
  // Create owner (public endpoint)
  app.post("/api/owners", async (request, reply) => {
    const body = CreateOwnerRequestSchema.parse(request.body);
    const result = await ownerService.create(body.name);
    reply.code(201).send(result);
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
