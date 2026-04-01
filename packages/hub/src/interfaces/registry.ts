import type {
  Agent,
  AgentRegistration,
  AgentHeartbeat,
  AgentFilter,
} from "@agentmesh/shared";

export interface Registry {
  register(
    ownerId: string,
    registration: AgentRegistration,
  ): Promise<Agent>;

  heartbeat(heartbeat: AgentHeartbeat): Promise<Agent>;

  unregister(agentId: string): Promise<void>;

  find(filter: AgentFilter): Promise<Agent[]>;

  findById(agentId: string): Promise<Agent | null>;

  matchByCapability(
    capability: string,
    opts?: { maxLoad?: number; limit?: number },
  ): Promise<Agent[]>;

  markStaleOffline(thresholdSeconds: number): Promise<number>;
}
