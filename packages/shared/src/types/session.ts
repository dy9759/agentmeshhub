export type SessionStatus = "active" | "waiting" | "completed" | "failed" | "archived";

export interface SessionParticipant {
  id: string;
  type: "agent" | "owner";
  role: "creator" | "participant";
  joinedAt: string;
}

export interface SessionContext {
  topic: string;
  files?: Array<{ name: string; content?: string; fileId?: string }>;
  codeSnippets?: Array<{ language: string; code: string; description: string }>;
  decisions?: Array<{ decision: string; by: string; at: string }>;
  summary?: string;
}

export interface Session {
  id: string;
  title: string;
  creatorId: string;
  creatorType: "agent" | "owner";
  status: SessionStatus;
  participants: SessionParticipant[];
  maxTurns: number;
  currentTurn: number;
  context?: SessionContext;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionRequest {
  title: string;
  participants: Array<{ id: string; type: "agent" | "owner" }>;
  maxTurns?: number;
  context?: SessionContext;
}
