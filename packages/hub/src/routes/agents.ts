import type { FastifyInstance } from "fastify";
import { AgentRegistrationSchema, AgentHeartbeatSchema, AgentFilterSchema } from "@agentmesh/shared";
import type { RegistryService } from "../services/registry.service.js";
import { signAgentToken } from "../auth/agent-token.js";
import { getAuth } from "../auth/middleware.js";

export function agentRoutes(app: FastifyInstance, registry: RegistryService) {
  // Register agent
  app.post("/api/register", async (request, reply) => {
    const auth = getAuth(request);
    const body = AgentRegistrationSchema.parse(request.body);
    const agent = await registry.register(auth.ownerId, body);

    // Sign agent token
    const { token, expiresIn } = await signAgentToken(
      agent.agentId,
      auth.ownerId,
      agent.state.capabilities,
    );

    reply.code(201).send({
      agentId: agent.agentId,
      ownerId: auth.ownerId,
      agentToken: token,
      expiresIn,
    });
  });

  // Heartbeat
  app.post("/api/heartbeat", async (request) => {
    const body = AgentHeartbeatSchema.parse(request.body);
    const agent = await registry.heartbeat(body);
    return agent;
  });

  // List agents
  app.get("/api/agents", async (request) => {
    const query = request.query as Record<string, string>;
    const filter = AgentFilterSchema.parse({
      type: query.type || undefined,
      capability: query.capability || undefined,
      status: query.status || undefined,
      maxLoad: query.maxLoad ? parseFloat(query.maxLoad) : undefined,
    });
    const agents = await registry.find(filter);
    return { agents };
  });

  // Get agent by ID
  app.get("/api/agents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = await registry.findById(id);
    if (!agent) {
      reply.code(404).send({ error: "Agent not found" });
      return;
    }
    return agent;
  });

  // Match by capability
  app.get("/api/agents/match", async (request) => {
    const query = request.query as Record<string, string>;
    const capability = query.capability;
    const maxLoad = query.maxLoad ? parseFloat(query.maxLoad) : undefined;
    if (!capability) {
      return { agents: [] };
    }
    const agents = await registry.matchByCapability(capability, { maxLoad });
    return { agents };
  });

  // Unregister
  app.delete("/api/agents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await registry.unregister(id);
    reply.code(204).send();
  });
}
