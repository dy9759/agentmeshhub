import { HubClient } from "@agentmesh/hub";
import type { SendInteractionRequest } from "@agentmesh/shared";

/**
 * A2A Task states (per A2A spec)
 */
export type A2ATaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed"
  | "unknown";

export interface A2ATask {
  id: string;
  sessionId?: string;
  status: {
    state: A2ATaskState;
    message?: A2APart[];
    timestamp: string;
  };
  artifacts?: A2AArtifact[];
  history?: Array<{ role: string; parts: A2APart[] }>;
  metadata?: Record<string, unknown>;
}

export interface A2APart {
  type: "text" | "data" | "file";
  text?: string;
  data?: Record<string, unknown>;
  mimeType?: string;
}

export interface A2AArtifact {
  name?: string;
  description?: string;
  parts: A2APart[];
  index: number;
}

export interface A2AMessage {
  role: "user" | "agent";
  parts: A2APart[];
}

/**
 * Executor: bridges A2A task requests to AgentMesh interactions.
 *
 * Flow:
 * 1. A2A client sends a task (message parts → text/json)
 * 2. Executor converts to AgentMesh Interaction and sends via Hub
 * 3. Executor polls for a reply (correlation ID based)
 * 4. Converts reply back to A2A task response
 */
export class A2AExecutor {
  private client: HubClient;
  private agentId: string;
  private pollIntervalMs: number;
  private pollTimeoutMs: number;

  constructor(options: {
    client: HubClient;
    agentId: string;
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
  }) {
    this.client = options.client;
    this.agentId = options.agentId;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 30_000;
  }

  /**
   * Execute an A2A task:
   * - Convert the A2A message parts to an interaction
   * - Send to the target agent via Hub
   * - Poll for reply up to timeout
   * - Return the A2A task result
   */
  async executeTask(
    taskId: string,
    targetAgentId: string,
    message: A2AMessage,
    sessionId?: string,
  ): Promise<A2ATask> {
    const correlationId = taskId;

    // Convert A2A message to interaction payload
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("\n");

    const dataPayload = message.parts.find((p) => p.type === "data");

    const request: SendInteractionRequest = {
      type: "query",
      contentType: dataPayload ? "json" : "text",
      target: { agentId: targetAgentId },
      payload: {
        text: text || undefined,
        data: dataPayload?.data,
      },
      metadata: {
        expectReply: true,
        correlationId,
        schema: "a2a_task",
      },
    };

    await this.client.sendInteraction(request);

    // Poll for reply
    const deadline = Date.now() + this.pollTimeoutMs;
    let lastSeenId: string | undefined;

    while (Date.now() < deadline) {
      await sleep(this.pollIntervalMs);

      const { interactions } = await this.client.pollInteractions(
        this.agentId,
        { afterId: lastSeenId },
      );

      for (const interaction of interactions) {
        lastSeenId = interaction.id;

        if (interaction.metadata?.correlationId === correlationId) {
          // Found the reply
          const replyText =
            typeof interaction.payload.text === "string"
              ? interaction.payload.text
              : undefined;
          const replyData =
            interaction.payload.data as Record<string, unknown> | undefined;

          const parts: A2APart[] = [];
          if (replyText) parts.push({ type: "text", text: replyText });
          if (replyData) parts.push({ type: "data", data: replyData });

          return {
            id: taskId,
            sessionId,
            status: {
              state: "completed",
              message: parts,
              timestamp: new Date().toISOString(),
            },
            artifacts: [
              {
                name: "response",
                parts,
                index: 0,
              },
            ],
          };
        }
      }
    }

    // Timeout
    return {
      id: taskId,
      sessionId,
      status: {
        state: "failed",
        message: [
          {
            type: "text",
            text: `Task timed out after ${this.pollTimeoutMs}ms`,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
