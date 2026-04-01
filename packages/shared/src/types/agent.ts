export type AgentType = "claude-code" | "openclaw" | "gemini" | "generic";
export type AgentStatus = "online" | "offline" | "busy";

export interface AgentState {
  status: AgentStatus;
  load: number; // 0~1
  currentTaskId?: string;
  currentTaskType?: string; // coding | reviewing | idle
  capabilities: string[];
  availableCapacity: number; // remaining task slots (0 = full)
  lastActiveAt: string;
}

export interface Agent {
  agentId: string;
  ownerId: string;
  name: string;
  type: AgentType;
  version?: string;
  machineId?: string;
  state: AgentState;
  endpoint?: string;
  registeredAt: string;
  lastHeartbeat: string;
}

export interface AgentRegistration {
  name: string;
  type: AgentType;
  version?: string;
  machineId?: string;
  capabilities?: string[];
}

export interface AgentHeartbeat {
  agentId: string;
  load?: number;
  currentTaskId?: string;
  currentTaskType?: string;
  availableCapacity?: number;
}

export interface AgentFilter {
  type?: AgentType;
  capability?: string;
  status?: AgentStatus;
  maxLoad?: number;
  ownerId?: string;
}
