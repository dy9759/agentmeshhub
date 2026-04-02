import type { FastifyInstance } from "fastify";
import {
  CreateSessionRequestSchema,
  SessionStatusSchema,
  type SessionContext,
} from "@agentmesh/shared";
import type { SessionService } from "../services/session.service.js";
import type { MessageBusService } from "../services/message-bus.service.js";
import { getAuth } from "../auth/middleware.js";
import type { AuthContext } from "../auth/types.js";

function canAccessSession(auth: AuthContext, session: any): boolean {
  if (auth.agentId === session.creatorId) return true;
  if (auth.ownerId === session.creatorId) return true;
  const participants = session.participants ?? [];
  return participants.some((p: any) => p.id === auth.agentId || p.id === auth.ownerId);
}

export function sessionRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  _messageBus: MessageBusService,
) {
  // Create session
  app.post("/api/sessions", async (request, reply) => {
    const auth = getAuth(request);
    const creatorId = auth.agentId ?? auth.ownerId!;
    const creatorType = auth.agentId ? "agent" : "owner";
    const body = CreateSessionRequestSchema.parse(request.body);
    const session = await sessionService.create(creatorId, creatorType, body);
    reply.code(201).send(session);
  });

  // Get session by ID
  app.get("/api/sessions/:id", async (request, reply) => {
    const auth = getAuth(request);
    const { id } = request.params as { id: string };
    const session = await sessionService.findById(id);
    if (!session) {
      reply.code(404).send({ error: "Session not found" });
      return;
    }
    if (!canAccessSession(auth, session)) {
      reply.code(403).send({ error: "Forbidden" });
      return;
    }
    return session;
  });

  // Update session (status or context)
  app.patch("/api/sessions/:id", async (request, reply) => {
    const auth = getAuth(request);
    const { id } = request.params as { id: string };
    const body = request.body as { status?: string; context?: SessionContext };

    let session = await sessionService.findById(id);
    if (!session) {
      reply.code(404).send({ error: "Session not found" });
      return;
    }
    if (!canAccessSession(auth, session)) {
      reply.code(403).send({ error: "Forbidden" });
      return;
    }

    if (body.status) {
      const status = SessionStatusSchema.parse(body.status);
      session = await sessionService.updateStatus(id, status);
    }
    if (body.context) {
      session = await sessionService.updateContext(id, body.context as SessionContext);
    }

    return session;
  });

  // Get session messages
  app.get("/api/sessions/:id/messages", async (request, reply) => {
    const auth = getAuth(request);
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;

    const session = await sessionService.findById(id);
    if (!session) {
      reply.code(404).send({ error: "Session not found" });
      return;
    }
    if (!canAccessSession(auth, session)) {
      reply.code(403).send({ error: "Forbidden" });
      return;
    }

    const messages = await sessionService.getMessages(id, {
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      afterId: query.afterId,
    });
    return { messages };
  });

  // Join session
  app.post("/api/sessions/:id/join", async (request, reply) => {
    const { id } = request.params as { id: string };
    const auth = getAuth(request);
    const participantId = auth.agentId ?? auth.ownerId!;
    const participantType = auth.agentId ? "agent" : "owner";

    const session = await sessionService.join(id, participantId, participantType);
    return session;
  });

  // List sessions
  app.get("/api/sessions", async (request) => {
    const auth = getAuth(request);
    const query = request.query as Record<string, string>;
    const callerId = auth.agentId ?? auth.ownerId!;
    const list = await sessionService.list({
      status: query.status,
      creatorId: query.creatorId ?? callerId,
    });
    // Filter to sessions the caller can access
    const filtered = list.filter((s) => canAccessSession(auth, s));
    return { sessions: filtered };
  });
}
