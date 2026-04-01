import express, { type Express } from "express";
import type { Server } from "node:http";
import { HubClient } from "@agentmesh/hub";
import { buildAgentCard } from "./agent-card.js";
import { A2AExecutor } from "./executor.js";
import type { A2AMessage } from "./executor.js";

export interface A2AServerConfig {
  hubUrl: string;
  apiKey: string;
  agentName: string;
  capabilities?: string[];
  machineId?: string;
  port?: number;
  host?: string;
  baseUrl?: string;
}

export async function createA2AServer(config: A2AServerConfig): Promise<{ app: Express; server: Server; agentId: string; client: HubClient }> {
  const client = new HubClient({ hubUrl: config.hubUrl, apiKey: config.apiKey });

  // Register with Hub
  const registration = await client.register({
    name: config.agentName,
    type: "openclaw",
    capabilities: config.capabilities,
    machineId: config.machineId,
  });

  client.setAgentToken(registration.agentToken);
  const agentId = registration.agentId;

  console.log(`[a2a-adapter] Registered as ${agentId}`);

  // Fetch our own agent record for the agent card
  const agentRecord = await client.getAgent(agentId);

  const port = config.port ?? 4000;
  const host = config.host ?? "0.0.0.0";
  const baseUrl = config.baseUrl ?? `http://localhost:${port}`;

  const executor = new A2AExecutor({ client, agentId });

  const app = express();
  app.use(express.json());

  // A2A Agent Card
  app.get("/.well-known/agent.json", (_req, res) => {
    res.json(buildAgentCard(agentRecord, baseUrl));
  });

  // A2A JSON-RPC endpoint
  app.post("/", async (req, res) => {
    const { jsonrpc, id, method, params } = req.body as {
      jsonrpc: string;
      id: string | number;
      method: string;
      params: Record<string, unknown>;
    };

    if (jsonrpc !== "2.0") {
      res.status(400).json(jsonRpcError(id, -32600, "Invalid Request"));
      return;
    }

    try {
      switch (method) {
        case "tasks/send": {
          const taskId = (params.id as string | undefined) ?? generateId();
          const sessionId = params.sessionId as string | undefined;
          const message = params.message as A2AMessage | undefined;
          const targetAgentId = (params.metadata as Record<string, unknown> | undefined)
            ?.targetAgentId as string | undefined;

          if (!message) {
            res.json(jsonRpcError(id, -32602, "Missing message"));
            return;
          }

          if (!targetAgentId) {
            res.json(jsonRpcError(id, -32602, "Missing metadata.targetAgentId"));
            return;
          }

          const task = await executor.executeTask(taskId, targetAgentId, message, sessionId);
          res.json({ jsonrpc: "2.0", id, result: task });
          break;
        }

        case "tasks/get": {
          const taskId = params.id as string;
          // We don't persist task state locally — return unknown
          res.json({
            jsonrpc: "2.0",
            id,
            result: {
              id: taskId,
              status: { state: "unknown", timestamp: new Date().toISOString() },
            },
          });
          break;
        }

        case "tasks/cancel": {
          // No-op for now — interactions can't be cancelled
          res.json({ jsonrpc: "2.0", id, result: { canceled: true } });
          break;
        }

        default:
          res.json(jsonRpcError(id, -32601, `Method not found: ${method}`));
      }
    } catch (err) {
      console.error("[a2a-adapter] Handler error:", err);
      res.json(jsonRpcError(id, -32603, "Internal error"));
    }
  });

  const server = app.listen(port, host, () => {
    console.log(`[a2a-adapter] Listening on ${host}:${port}`);
    console.log(`[a2a-adapter] Agent Card: ${baseUrl}/.well-known/agent.json`);
  });

  return { app, server, agentId, client };
}

function jsonRpcError(id: string | number, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

// CLI entrypoint
async function main() {
  const hubUrl = process.env.AGENTMESH_HUB_URL ?? "http://localhost:5555";
  const apiKey = process.env.AGENTMESH_API_KEY ?? "";
  const agentName = process.env.AGENT_NAME ?? "a2a-agent";
  const capabilities = process.env.AGENT_CAPABILITIES?.split(",").filter(Boolean) ?? [];
  const port = parseInt(process.env.PORT ?? "4000", 10);
  const baseUrl = process.env.BASE_URL;

  await createA2AServer({
    hubUrl,
    apiKey,
    agentName,
    capabilities,
    port,
    baseUrl,
  });
}

main().catch((err) => {
  console.error("[a2a-adapter] Fatal error:", err);
  process.exit(1);
});
