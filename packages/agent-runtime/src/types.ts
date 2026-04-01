import type { Interaction, SendInteractionRequest, AgentType } from "@agentmesh/shared";

export interface InteractionHandler {
  canHandle(interaction: Interaction): boolean;
  handle(interaction: Interaction): Promise<SendInteractionRequest | null>;
}

export interface RuntimeConfig {
  hubUrl: string;
  apiKey: string;
  name: string;
  type?: AgentType;
  capabilities?: string[];
  machineId?: string;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  useWebSocket?: boolean; // default: true
}
