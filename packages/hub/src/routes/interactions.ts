import type { FastifyInstance } from "fastify";
import { SendInteractionRequestSchema, type SenderType } from "@agentmesh/shared";
import type { MessageBusService } from "../services/message-bus.service.js";
import { getAuth } from "../auth/middleware.js";

export function interactionRoutes(
  app: FastifyInstance,
  messageBus: MessageBusService,
) {
  // Send interaction (unified: DM, channel, broadcast)
  // Supports both Agent and Owner auth
  app.post("/api/interactions", async (request, reply) => {
    const auth = getAuth(request);
    const body = SendInteractionRequestSchema.parse(request.body);

    let fromId: string;
    let fromType: SenderType;

    if (auth.agentId) {
      fromId = auth.agentId;
      fromType = "agent";
    } else if (auth.ownerId) {
      fromId = auth.ownerId;
      fromType = "owner";
    } else {
      reply.code(400).send({ error: "Authentication required to send interactions" });
      return;
    }

    // Route by target type
    if (body.type === "broadcast" && body.target.capability) {
      const results = await messageBus.broadcast(fromId, fromType, body);
      reply.code(201).send({ interactions: results, delivered: results.length });
    } else if (body.target.channel) {
      const result = await messageBus.sendToChannel(
        fromId,
        fromType,
        body.target.channel,
        body,
      );
      reply.code(201).send({ id: result.id, delivered: true });
    } else if (body.target.agentId || body.target.ownerId) {
      const result = await messageBus.send(fromId, fromType, body);
      reply.code(201).send({ id: result.id, delivered: true });
    } else {
      reply.code(400).send({ error: "Target must specify agentId, ownerId, channel, or capability" });
    }
  });

  // Conversation list — agents/owners you've chatted with
  app.get("/api/conversations", async (request) => {
    const query = request.query as Record<string, string>;
    const agentId = query.agentId;
    const ownerId = query.ownerId;

    if (ownerId) {
      const conversations = await messageBus.getOwnerConversations(ownerId);
      return { conversations };
    }
    if (agentId) {
      const conversations = await messageBus.getConversations(agentId);
      return { conversations };
    }
    return { conversations: [] };
  });

  // Chat history with a specific entity
  app.get("/api/conversations/:otherId/messages", async (request) => {
    const params = request.params as Record<string, string>;
    const query = request.query as Record<string, string>;
    const myId = query.agentId ?? query.ownerId;
    const otherId = params.otherId;

    if (!myId) {
      return { messages: [] };
    }

    const messages = await messageBus.getChatHistory(myId, otherId, {
      afterId: query.afterId,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
    return { messages };
  });

  // Poll inbox (agent)
  app.get("/api/interactions", async (request) => {
    const query = request.query as Record<string, string>;
    const agentId = query.agentId;
    const ownerId = query.ownerId;
    const afterId = query.afterId;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;

    if (ownerId) {
      const results = await messageBus.pollOwner(ownerId, { afterId, limit });
      return { interactions: results };
    }
    if (agentId) {
      const results = await messageBus.poll(agentId, { afterId, limit });
      return { interactions: results };
    }
    return { interactions: [] };
  });
}
