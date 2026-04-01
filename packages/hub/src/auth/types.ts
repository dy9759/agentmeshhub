export interface AuthContext {
  type: "owner" | "agent" | "oauth";
  ownerId: string;
  agentId?: string;
}

export interface AgentTokenPayload {
  sub: string; // agentId
  ownerId: string;
  capabilities: string[];
  iat: number;
  exp: number;
}
