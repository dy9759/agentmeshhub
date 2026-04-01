import type { Agent, AgentRegistration, AgentHeartbeat } from "./agent.js";
import type { Interaction } from "./interaction.js";
import type { Channel } from "./channel.js";
import type { Task } from "./task.js";

// Auth
export interface AuthContext {
  type: "owner" | "agent" | "oauth";
  ownerId: string;
  agentId?: string;
}

// Agent Registration
export interface RegisterResponse {
  agentId: string;
  ownerId: string;
  agentToken: string;
  expiresIn: number;
}

// Agent List
export interface ListAgentsResponse {
  agents: Agent[];
}

// Interaction
export interface SendInteractionResponse {
  id: string;
  delivered: boolean;
}

export interface ListInteractionsResponse {
  interactions: Interaction[];
}

// Channel
export interface ListChannelsResponse {
  channels: Channel[];
}

// Task
export interface CreateTaskResponse {
  task: Task;
  matchedAgents: number;
}

export interface ListTasksResponse {
  tasks: Task[];
}

// Health
export interface HealthResponse {
  status: "ok" | "degraded";
  timestamp: string;
  agentsOnline: number;
}

// Owner
export interface CreateOwnerRequest {
  name: string;
}

export interface CreateOwnerResponse {
  ownerId: string;
  apiKey: string;
}
