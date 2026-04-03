import Fastify from "fastify";
import cors from "@fastify/cors";
import { createDatabase, initializeDatabase, type DB } from "./db/connection.js";
import { OwnerService } from "./services/owner.service.js";
import { RegistryService } from "./services/registry.service.js";
import { MessageBusService } from "./services/message-bus.service.js";
import { ChannelService } from "./services/channel.service.js";
import { TaskEngineService } from "./services/task-engine.service.js";
import { createAuthMiddleware } from "./auth/middleware.js";
import { healthRoutes } from "./routes/health.js";
import { ownerRoutes } from "./routes/owners.js";
import { agentRoutes } from "./routes/agents.js";
import { interactionRoutes } from "./routes/interactions.js";
import { channelRoutes } from "./routes/channels.js";
import { taskRoutes } from "./routes/tasks.js";
import { FileService } from "./services/file.service.js";
import { fileRoutes } from "./routes/files.js";
import { SessionService } from "./services/session.service.js";
import { sessionRoutes } from "./routes/sessions.js";
import { RemoteSessionService } from "./services/remote-session.service.js";
import { remoteSessionRoutes } from "./routes/remote-sessions.js";
import { TeamService } from "./services/team.service.js";
import { AutoReplyService } from "./services/auto-reply.service.js";
import { teamRoutes } from "./routes/teams.js";
import { startStaleAgentReaper } from "./tasks/stale-agent-reaper.js";
import { startFileExpiryReaper } from "./tasks/file-expiry-reaper.js";
import { startInteractionReaper } from "./tasks/interaction-reaper.js";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { WebSocketManager } from "./services/websocket-manager.js";
import { websocketRoutes } from "./routes/websocket.js";
import { getAuth } from "./auth/middleware.js";
import { join } from "node:path";

export interface AppConfig {
  dbUrl?: string;
  port?: number;
  host?: string;
}

export function createApp(config: AppConfig = {}) {
  const app = Fastify({
    logger: {
      level: "info",
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            remoteAddress: request.ip,
          };
        },
        res(reply) {
          return {
            statusCode: reply.statusCode,
          };
        },
      },
    },
  });
  const db = createDatabase(config.dbUrl);

  // Initialize database tables
  initializeDatabase(db);

  // Services
  const ownerService = new OwnerService(db);
  const registryService = new RegistryService(db);
  const wsManager = new WebSocketManager();
  const messageBusService = new MessageBusService(db, registryService);
  messageBusService.setWebSocketManager(wsManager);
  const channelService = new ChannelService(db);
  const taskEngineService = new TaskEngineService(db, registryService);

  // File service
  const uploadsDir = join(process.cwd(), "uploads");
  const fileService = new FileService(db, uploadsDir);

  // Session service
  const sessionService = new SessionService(db);
  sessionService.setWebSocketManager(wsManager);
  messageBusService.setSessionService(sessionService);

  // Remote session service
  const remoteSessionService = new RemoteSessionService(db);

  // Auto-reply service (5-second poll daemon, default ON)
  const autoReplyService = new AutoReplyService(db);
  autoReplyService.setMessageBus(messageBusService);
  autoReplyService.setSessionService(sessionService);
  messageBusService.setAutoReplyService(autoReplyService);
  // Start poll daemon by default (disable via AUTO_REPLY_POLL=false env)
  if (process.env.AUTO_REPLY_POLL !== "false") {
    autoReplyService.startPollDaemon();
  }

  // Team service
  const teamService = new TeamService(db);

  // Middleware
  const webOrigin = process.env.WEB_UI_ORIGIN ?? "*";
  app.register(cors, { origin: webOrigin, credentials: true });
  app.register(websocket);
  app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB
  app.addHook("onRequest", createAuthMiddleware(ownerService));

  // Error handler — logs rejection reason
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error.name === "ZodError") {
      request.log.warn({ method: request.method, url: request.url, status: 400 }, `REJECTED 400 ${request.method} ${request.url} — Validation error: ${error.message}`);
      reply.code(400).send({ error: "Validation error", details: error });
      return;
    }
    if (error.statusCode) {
      request.log.warn({ method: request.method, url: request.url, status: error.statusCode, reason: error.message }, `REJECTED ${error.statusCode} ${request.method} ${request.url} — ${error.message}`);
      reply.code(error.statusCode).send({ error: error.message });
      return;
    }
    request.log.error({ err: error, method: request.method, url: request.url }, `ERROR 500 ${request.method} ${request.url} — ${error.message}`);
    reply.code(500).send({ error: "Internal server error" });
  });

  // Log all 4xx/5xx responses with request context
  app.addHook("onResponse", (request, reply, done) => {
    const status = reply.statusCode;
    if (status >= 400) {
      const level = status >= 500 ? "error" : "warn";
      request.log[level](
        { method: request.method, url: request.url, status },
        `${status} ${request.method} ${request.url}`,
      );
    }
    done();
  });

  // Routes
  healthRoutes(app, registryService);
  ownerRoutes(app, ownerService);
  agentRoutes(app, registryService);
  interactionRoutes(app, messageBusService);
  channelRoutes(app, channelService, messageBusService, registryService);
  taskRoutes(app, taskEngineService);
  fileRoutes(app, fileService);
  sessionRoutes(app, sessionService, messageBusService);
  websocketRoutes(app, wsManager, ownerService);
  remoteSessionRoutes(app, remoteSessionService);
  teamRoutes(app, teamService, messageBusService);

  // Expose autoReplyService to routes (avoiding parameter changes)
  (app as any).__autoReplyService = autoReplyService;

  // Auto-reply poll daemon control
  app.post("/api/auto-reply/start", async (_request, reply) => {
    autoReplyService.startPollDaemon();
    reply.send({ polling: true, message: "Auto-reply poll daemon started (5s interval)" });
  });
  app.post("/api/auto-reply/stop", async (_request, reply) => {
    autoReplyService.stopPollDaemon();
    reply.send({ polling: false, message: "Auto-reply poll daemon stopped" });
  });
  app.get("/api/auto-reply/status", async (_request, reply) => {
    reply.send({ polling: autoReplyService["pollTimer"] !== null });
  });

  // Typing indicator (lightweight, no DB persistence)
  app.post("/api/typing", async (request, reply) => {
    const auth = getAuth(request);
    const body = request.body as { targetAgentId: string; sessionId?: string; isTyping: boolean };
    const fromId = auth.agentId ?? auth.ownerId;
    const fromType: "agent" | "owner" = auth.agentId ? "agent" : "owner";
    if (fromId && body.targetAgentId) {
      wsManager.pushTyping(body.targetAgentId, {
        fromId,
        fromType,
        sessionId: body.sessionId,
        isTyping: body.isTyping ?? true,
      });
    }
    reply.code(204).send();
  });

  // Background tasks
  const reaper = startStaleAgentReaper(registryService);
  const fileReaper = startFileExpiryReaper(fileService);
  const interactionReaper = startInteractionReaper(messageBusService);
  app.addHook("onClose", () => {
    clearInterval(reaper);
    clearInterval(fileReaper);
    clearInterval(interactionReaper);
    autoReplyService.destroy();
    wsManager.destroy();
  });

  return {
    app,
    db,
    services: {
      ownerService,
      registryService,
      messageBusService,
      channelService,
      taskEngineService,
      fileService,
      sessionService,
      remoteSessionService,
      teamService,
      autoReplyService,
    },
  };
}
