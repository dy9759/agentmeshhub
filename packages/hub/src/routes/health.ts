import type { FastifyInstance } from "fastify";
import type { RegistryService } from "../services/registry.service.js";

export function healthRoutes(app: FastifyInstance, registry: RegistryService) {
  app.get("/health", async () => {
    const onlineAgents = await registry.find({ status: "online" });
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      agentsOnline: onlineAgents.length,
    };
  });
}
