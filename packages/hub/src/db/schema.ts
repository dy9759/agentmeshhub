import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Owner table — one owner = one API key
export const owners = sqliteTable("owners", {
  ownerId: text("owner_id").primaryKey(),
  name: text("name").notNull(),
  apiKey: text("api_key").notNull().unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Invite codes — one-time auth codes for OAuth flow
export const inviteCodes = sqliteTable("invite_codes", {
  code: text("code").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => owners.ownerId),
  label: text("label"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  usedAt: text("used_at"),
  usedBy: text("used_by"),
});

// Agent registration table
export const agents = sqliteTable("agents", {
  agentId: text("agent_id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => owners.ownerId),
  name: text("name").notNull(),
  type: text("type").notNull(), // claude-code | openclaw | gemini | generic
  version: text("version"),
  machineId: text("machine_id"),
  status: text("status").notNull().default("online"),
  load: real("load").notNull().default(0),
  currentTaskId: text("current_task_id"),
  currentTaskType: text("current_task_type"),
  capabilities: text("capabilities").notNull().default("[]"), // JSON array
  availableCapacity: integer("available_capacity").notNull().default(5),
  tokenHash: text("token_hash"),
  tokenExpiresAt: text("token_expires_at"),
  registeredAt: text("registered_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  lastHeartbeat: text("last_heartbeat")
    .notNull()
    .default(sql`(datetime('now'))`),
  autoReplyConfig: text("auto_reply_config"), // JSON: { enabled, permissions, llmEndpoint, llmApiKey, model, systemPrompt }
});

// Interactions table (unified messages)
export const interactions = sqliteTable("interactions", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // message | task | query | event | broadcast
  fromId: text("from_id").notNull(), // agentId or ownerId
  fromType: text("from_type").notNull().default("agent"), // "agent" | "owner"
  fromAgent: text("from_agent"), // deprecated, kept for compat
  toAgent: text("to_agent"), // DM target (agentId)
  toOwner: text("to_owner"), // DM target (ownerId)
  channel: text("channel"), // channel target
  capability: text("capability"), // broadcast target
  sessionId: text("session_id"), // links interaction to a session
  contentType: text("content_type").notNull().default("text"),
  schema: text("schema"), // interaction schema name
  payload: text("payload").notNull(), // JSON
  metadata: text("metadata"), // JSON
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Channels
export const channels = sqliteTable("channels", {
  name: text("name").primaryKey(),
  description: text("description"),
  createdBy: text("created_by").notNull(), // agentId or ownerId
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Channel members
export const channelMembers = sqliteTable("channel_members", {
  channel: text("channel")
    .notNull()
    .references(() => channels.name),
  agentId: text("agent_id").notNull(), // agentId or ownerId (renamed kept for compat)
  joinedAt: text("joined_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Files (file transfer storage)
export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  storagePath: text("storage_path").notNull(),
  fromAgent: text("from_agent")
    .notNull()
    .references(() => agents.agentId),
  ownerId: text("owner_id")
    .notNull()
    .references(() => owners.ownerId),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  expiresAt: text("expires_at").notNull(),
});

// Sessions (multi-turn collaboration)
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  creatorId: text("creator_id").notNull(),
  creatorType: text("creator_type").notNull(),
  status: text("status").notNull().default("active"),
  participants: text("participants").notNull(), // JSON array
  maxTurns: integer("max_turns").notNull().default(20),
  currentTurn: integer("current_turn").notNull().default(0),
  context: text("context"), // JSON
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Teams (team orchestration)
export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  leaderId: text("leader_id").notNull(),
  leaderType: text("leader_type").notNull(),
  members: text("members").notNull().default("[]"), // JSON array
  description: text("description"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Remote Sessions (teleport/remote agent tracking)
export const remoteSessions = sqliteTable("remote_sessions", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  ownerId: text("owner_id").notNull(),
  status: text("status").notNull().default("created"),
  // created | running | idle | completed | failed | archived
  title: text("title"),
  environment: text("environment"), // JSON: machine info
  events: text("events").notNull().default("[]"), // JSON array of events
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// Tasks (collaboration model)
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  requiredCapabilities: text("required_capabilities").notNull(), // JSON array
  createdBy: text("created_by")
    .notNull()
    .references(() => agents.agentId),
  assignedTo: text("assigned_to"),
  candidates: text("candidates"), // JSON array of agent IDs
  status: text("status").notNull().default("pending"),
  payload: text("payload").notNull(), // JSON
  result: text("result"), // JSON
  timeoutMs: integer("timeout_ms").notNull().default(30000),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
