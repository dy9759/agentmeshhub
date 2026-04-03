export type InteractionType =
  | "message"
  | "task"
  | "query"
  | "event"
  | "broadcast"
  | "session_invite"
  | "session_complete"
  | "plan_request"
  | "plan_response";

export type ContentType = "text" | "json" | "action";

export type Priority = "low" | "normal" | "high";

export type SenderType = "agent" | "owner";

export interface InteractionTarget {
  agentId?: string; // DM to agent
  ownerId?: string; // DM to owner
  channel?: string; // channel message
  capability?: string; // broadcast by capability
  sessionId?: string; // link to a session
}

export interface InteractionMetadata {
  expectReply?: boolean;
  timeoutMs?: number;
  priority?: Priority;
  schema?: string; // named interaction schema
  correlationId?: string; // link request ↔ response
}

export interface FileAttachment {
  fileId?: string; // reference to uploaded file (for large files >=5MB)
  fileName: string;
  contentType: string;
  size: number;
  base64?: string; // inline content (for small files <5MB)
}

export interface InteractionPayload {
  text?: string; // natural language (first-class)
  data?: Record<string, unknown>; // structured data
  file?: FileAttachment; // file attachment
}

export interface Interaction {
  id: string;
  type: InteractionType;
  contentType: ContentType;
  fromId: string; // agentId or ownerId
  fromType: SenderType;
  /** @deprecated Use fromId instead */
  fromAgent: string;
  target: InteractionTarget;
  payload: InteractionPayload;
  metadata?: InteractionMetadata;
  status?: "pending" | "delivered" | "read";
  createdAt: string;
}

export interface SendInteractionRequest {
  type: InteractionType;
  contentType: ContentType;
  target: InteractionTarget;
  payload: InteractionPayload;
  metadata?: InteractionMetadata;
}

// WebSocket protocol
export type WSMessageType =
  | "hello"
  | "ping"
  | "pong"
  | "interaction"
  | "ack"
  | "error"
  | "session_update"
  | "typing"
  | "presence";

export interface WSMessage {
  type: WSMessageType;
  payload?: unknown;
  id?: string;
}

export interface WSHelloPayload {
  agentId?: string;
  agentToken?: string;
  ownerId?: string;
  ownerApiKey?: string;
}

export interface WSInteractionPayload {
  interaction: Interaction;
}

export interface WSSessionUpdatePayload {
  sessionId: string;
  status: string;
  currentTurn: number;
  maxTurns: number;
  updatedBy: string;
}

export interface WSTypingPayload {
  fromId: string;
  fromType: "agent" | "owner";
  sessionId?: string;
  isTyping: boolean;
}

export interface WSPresencePayload {
  agentId: string;
  status: "online" | "offline" | "busy";
}
