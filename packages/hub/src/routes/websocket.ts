import type { FastifyInstance } from "fastify";
import type { WebSocketManager } from "../services/websocket-manager.js";
import { verifyAgentToken } from "../auth/agent-token.js";
import type { WSMessage, WSHelloPayload } from "@agentmesh/shared";

const HELLO_TIMEOUT_MS = 5000;

export function websocketRoutes(
  app: FastifyInstance,
  wsManager: WebSocketManager,
) {
  app.register(async function (fastify) {
    fastify.get("/ws", { websocket: true }, (socket, _req) => {
      let authenticated = false;
      let agentId: string | null = null;

      // Set hello timeout
      const helloTimeout = setTimeout(() => {
        if (!authenticated) {
          socket.send(JSON.stringify({ type: "error", payload: { message: "Hello timeout" } }));
          socket.close(4001, "Hello timeout");
        }
      }, HELLO_TIMEOUT_MS);

      socket.on("message", async (data: Buffer) => {
        let msg: WSMessage;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          socket.send(JSON.stringify({ type: "error", payload: { message: "Invalid JSON" } }));
          return;
        }

        if (!authenticated) {
          // Expect hello message
          if (msg.type !== "hello") {
            socket.send(JSON.stringify({ type: "error", payload: { message: "Expected hello" } }));
            socket.close(4002, "Expected hello");
            return;
          }

          const hello = msg.payload as WSHelloPayload;
          if (!hello?.agentId || !hello?.agentToken) {
            socket.send(JSON.stringify({ type: "error", payload: { message: "Missing agentId or agentToken" } }));
            socket.close(4003, "Invalid hello");
            return;
          }

          // Verify JWT
          const tokenPayload = await verifyAgentToken(hello.agentToken);
          if (!tokenPayload || tokenPayload.sub !== hello.agentId) {
            socket.send(JSON.stringify({ type: "error", payload: { message: "Invalid token" } }));
            socket.close(4004, "Authentication failed");
            return;
          }

          clearTimeout(helloTimeout);
          authenticated = true;
          agentId = hello.agentId;
          wsManager.register(agentId, socket as any);

          socket.send(JSON.stringify({
            type: "ack",
            payload: { message: "Authenticated", agentId },
          }));
          return;
        }

        // Authenticated message handling
        switch (msg.type) {
          case "pong":
            wsManager.handlePong(agentId!);
            break;
          case "ack":
            break;
          default:
            break;
        }
      });

      socket.on("close", () => {
        clearTimeout(helloTimeout);
      });

      socket.on("error", (err: Error) => {
        console.error(`[ws] Error for agent ${agentId}:`, err.message);
      });
    });
  });
}
