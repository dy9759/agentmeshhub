import type { FastifyInstance } from "fastify";
import { CreateChannelRequestSchema } from "@agentmesh/shared";
import type { ChannelService } from "../services/channel.service.js";
import type { MessageBusService } from "../services/message-bus.service.js";
import { getAuth } from "../auth/middleware.js";

export function channelRoutes(
  app: FastifyInstance,
  channelService: ChannelService,
  messageBus: MessageBusService,
) {
  // Create channel (agent or owner)
  app.post("/api/channels", async (request, reply) => {
    const auth = getAuth(request);
    const createdBy = auth.agentId ?? auth.ownerId;
    if (!createdBy) {
      reply.code(400).send({ error: "Authentication required" });
      return;
    }
    const body = CreateChannelRequestSchema.parse(request.body);
    const channel = await channelService.create(
      body.name,
      createdBy,
      body.description,
    );
    reply.code(201).send(channel);
  });

  // List channels
  app.get("/api/channels", async () => {
    const channels = await channelService.list();
    return { channels };
  });

  // Join channel (agent or owner)
  app.post("/api/channels/:name/join", async (request, reply) => {
    const auth = getAuth(request);
    const memberId = auth.agentId ?? auth.ownerId;
    if (!memberId) {
      reply.code(400).send({ error: "Authentication required" });
      return;
    }
    const { name } = request.params as { name: string };
    await channelService.join(name, memberId);
    reply.code(204).send();
  });

  // Get channel messages
  app.get("/api/channels/:name/messages", async (request) => {
    const { name } = request.params as { name: string };
    const query = request.query as Record<string, string>;
    const messages = await messageBus.getChannelMessages(name, {
      afterId: query.afterId,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
    return { interactions: messages };
  });
}
