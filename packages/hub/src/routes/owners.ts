import type { FastifyInstance } from "fastify";
import { CreateOwnerRequestSchema } from "@agentmesh/shared";
import type { OwnerService } from "../services/owner.service.js";

export function ownerRoutes(app: FastifyInstance, ownerService: OwnerService) {
  app.post("/api/owners", async (request, reply) => {
    const body = CreateOwnerRequestSchema.parse(request.body);
    const result = await ownerService.create(body.name);
    reply.code(201).send(result);
  });
}
