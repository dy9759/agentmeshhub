import type { Agent } from "@agentmesh/shared";

/**
 * A2A AgentCard — the published identity document for an agent.
 * Served at GET /.well-known/agent.json
 */
export interface AgentCard {
  name: string;
  description?: string;
  url: string;
  version: string;
  capabilities: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  skills: Array<{
    id: string;
    name: string;
    description?: string;
    tags?: string[];
  }>;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  authentication?: {
    schemes: string[];
  };
}

/**
 * Build an A2A AgentCard from an AgentMesh Agent record.
 */
export function buildAgentCard(agent: Agent, baseUrl: string): AgentCard {
  return {
    name: agent.name,
    description: `AgentMesh agent of type '${agent.type}'`,
    url: baseUrl,
    version: agent.version ?? "0.1.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    skills: agent.state.capabilities.map((cap) => ({
      id: cap,
      name: cap
        .split(/[-_]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      description: `Capability: ${cap}`,
      tags: [cap],
    })),
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    authentication: {
      schemes: ["Bearer"],
    },
  };
}
