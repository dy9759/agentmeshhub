import type { FastifyInstance } from "fastify";
import type { RemoteSessionService } from "../services/remote-session.service.js";
import { getAuth } from "../auth/middleware.js";

export function remoteSessionRoutes(app: FastifyInstance, service: RemoteSessionService) {
  app.post("/api/remote-sessions", async (request, reply) => {
    const auth = getAuth(request);
    const body = request.body as { agentId: string; title?: string; environment?: Record<string, unknown> };
    if (!auth.ownerId) { reply.code(400).send({ error: "Owner auth required" }); return; }
    const session = await service.create(body.agentId, auth.ownerId, body.title, body.environment);
    reply.code(201).send(session);
  });

  app.get("/api/remote-sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await service.findById(id);
    if (!session) { reply.code(404).send({ error: "Not found" }); return; }
    return session;
  });

  app.patch("/api/remote-sessions/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { status: string };
    try {
      const session = await service.updateStatus(id, body.status);
      return session;
    } catch (err: any) {
      if (err.statusCode) { reply.code(err.statusCode).send({ error: err.message }); return; }
      throw err;
    }
  });

  app.post("/api/remote-sessions/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { type: string; data?: unknown };
    try {
      const session = await service.addEvent(id, body.type, body.data);
      return session;
    } catch (err: any) {
      if (err.statusCode) { reply.code(err.statusCode).send({ error: err.message }); return; }
      throw err;
    }
  });

  app.get("/api/remote-sessions", async (request) => {
    const auth = getAuth(request);
    const query = request.query as Record<string, string>;
    if (query.agentId) {
      return { sessions: await service.listByAgent(query.agentId) };
    }
    if (auth.ownerId) {
      return { sessions: await service.listByOwner(auth.ownerId) };
    }
    return { sessions: [] };
  });
}
