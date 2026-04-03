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

  // Get token for owned agent (Owner switches identity)
  app.post("/api/agents/:id/token", async (request, reply) => {
    const auth = getAuth(request);
    const { id } = request.params as { id: string };
    const agent = await registry.findById(id);
    if (!agent) {
      reply.code(404).send({ error: "Agent not found" });
      return;
    }
    if (agent.ownerId !== auth.ownerId) {
      reply.code(403).send({ error: "Not your agent" });
      return;
    }
    const { token, expiresIn } = await signAgentToken(
      agent.agentId,
      auth.ownerId,
      agent.state.capabilities,
    );
    reply.send({ agentId: agent.agentId, agentToken: token, expiresIn });
  });

  // List my agents (owner-filtered)
  app.get("/api/agents/mine", async (request) => {
    const auth = getAuth(request);
    if (!auth.ownerId) return { agents: [] };
    const agents = await registry.find({ ownerId: auth.ownerId });
    return { agents };
  });

  // Configure auto-reply
  app.patch("/api/agents/:id/auto-reply", async (request, reply) => {
    const auth = getAuth(request);
    const { id } = request.params as { id: string };
    const agent = await registry.findById(id);
    if (!agent) { reply.code(404).send({ error: "Agent not found" }); return; }
    if (agent.ownerId !== auth.ownerId) { reply.code(403).send({ error: "Not your agent" }); return; }

    const body = request.body as Record<string, unknown>;
    const autoReplyService = (app as any).__autoReplyService;
    if (autoReplyService) {
      await autoReplyService.updateConfig(id, body);
    }
    reply.send({ agentId: id, autoReplyConfig: body });
  });

  // Get auto-reply config
  app.get("/api/agents/:id/auto-reply", async (request, reply) => {
    const auth = getAuth(request);
    const { id } = request.params as { id: string };
    const agent = await registry.findById(id);
    if (!agent) { reply.code(404).send({ error: "Agent not found" }); return; }
    if (agent.ownerId !== auth.ownerId) { reply.code(403).send({ error: "Not your agent" }); return; }

    const autoReplyService = (app as any).__autoReplyService;
    const config = autoReplyService?.getConfig(id) ?? { enabled: false };
    reply.send({ agentId: id, autoReplyConfig: config });
  });

  // Update agent profile
  app.patch("/api/agents/:id/profile", async (request, reply) => {
    const auth = getAuth(request);
    const { id } = request.params as { id: string };
    const agent = await registry.findById(id);
    if (!agent) { reply.code(404).send({ error: "Agent not found" }); return; }
    if (agent.ownerId !== auth.ownerId && auth.agentId !== id) {
      reply.code(403).send({ error: "Not your agent" }); return;
    }

    const body = request.body as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (body.displayName !== undefined) updates.displayName = body.displayName;
    if (body.avatar !== undefined) updates.avatar = body.avatar;
    if (body.bio !== undefined) updates.bio = body.bio;
    if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags);
    if (body.metadata !== undefined) updates.agentMetadata = JSON.stringify(body.metadata);

    if (Object.keys(updates).length > 0) {
      await registry.updateProfile(id, updates);
    }

    const updated = await registry.findById(id);
    reply.send(updated);
  });

  // Get agent profile
  app.get("/api/agents/:id/profile", async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = await registry.findById(id);
    if (!agent) { reply.code(404).send({ error: "Agent not found" }); return; }
    reply.send({
      agentId: agent.agentId,
      name: agent.name,
      type: agent.type,
      profile: (agent as any).profile ?? {},
      state: agent.state,
    });
  });

  // Refresh agent token (extend expiration)
  app.post("/api/agents/:id/refresh-token", async (request, reply) => {
    const auth = getAuth(request);
    const { id } = request.params as { id: string };

    // Allow both owner and agent to refresh
    if (auth.agentId !== id && auth.ownerId) {
      const agent = await registry.findById(id);
      if (!agent || agent.ownerId !== auth.ownerId) {
        reply.code(403).send({ error: "Not your agent" });
        return;
      }
    } else if (!auth.agentId) {
      reply.code(401).send({ error: "Auth required" });
      return;
    }

    const agent = await registry.findById(id);
    if (!agent) { reply.code(404).send({ error: "Agent not found" }); return; }

    const { token, expiresIn } = await signAgentToken(
      agent.agentId,
      agent.ownerId,
      agent.state.capabilities,
    );

    reply.send({ agentId: agent.agentId, agentToken: token, expiresIn });
  });

  // Unregister
  app.delete("/api/agents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await registry.unregister(id);
    reply.code(204).send();
  });
}
