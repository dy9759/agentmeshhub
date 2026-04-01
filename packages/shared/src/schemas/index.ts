import { z } from "zod";

// Agent schemas
export const AgentTypeSchema = z.enum([
  "claude-code",
  "openclaw",
  "gemini",
  "generic",
]);

export const AgentStatusSchema = z.enum(["online", "offline", "busy"]);

export const AgentRegistrationSchema = z.object({
  name: z.string().min(1).max(64),
  type: AgentTypeSchema,
  version: z.string().optional(),
  machineId: z.string().optional(),
  capabilities: z.array(z.string()).optional().default([]),
});

export const AgentHeartbeatSchema = z.object({
  agentId: z.string(),
  load: z.number().min(0).max(1).optional(),
  currentTaskId: z.string().optional(),
  currentTaskType: z.string().optional(),
  availableCapacity: z.number().int().min(0).optional(),
});

export const AgentFilterSchema = z.object({
  type: AgentTypeSchema.optional(),
  capability: z.string().optional(),
  status: AgentStatusSchema.optional(),
  maxLoad: z.number().min(0).max(1).optional(),
  ownerId: z.string().optional(),
});

// Interaction schemas
export const InteractionTypeSchema = z.enum([
  "message",
  "task",
  "query",
  "event",
  "broadcast",
]);

export const ContentTypeSchema = z.enum(["text", "json", "action"]);

export const PrioritySchema = z.enum(["low", "normal", "high"]);

export const SenderTypeSchema = z.enum(["agent", "owner"]);

export const InteractionTargetSchema = z
  .object({
    agentId: z.string().optional(),
    ownerId: z.string().optional(),
    channel: z.string().optional(),
    capability: z.string().optional(),
  })
  .refine(
    (t) => t.agentId || t.ownerId || t.channel || t.capability,
    "At least one target (agentId, ownerId, channel, or capability) is required",
  );

export const InteractionMetadataSchema = z.object({
  expectReply: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  priority: PrioritySchema.optional(),
  schema: z.string().optional(),
  correlationId: z.string().optional(),
});

export const FileAttachmentSchema = z.object({
  fileId: z.string().optional(),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
  base64: z.string().optional(),
});

export const InteractionPayloadSchema = z.object({
  text: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  file: FileAttachmentSchema.optional(),
});

export const SendInteractionRequestSchema = z.object({
  type: InteractionTypeSchema,
  contentType: ContentTypeSchema,
  target: InteractionTargetSchema,
  payload: InteractionPayloadSchema,
  metadata: InteractionMetadataSchema.optional(),
});

export const InteractionSchema = z.object({
  id: z.string(),
  type: InteractionTypeSchema,
  contentType: ContentTypeSchema,
  fromId: z.string(),
  fromType: SenderTypeSchema,
  fromAgent: z.string(), // deprecated, kept for compat
  target: InteractionTargetSchema,
  payload: InteractionPayloadSchema,
  metadata: InteractionMetadataSchema.optional(),
  status: z.enum(["pending", "delivered", "read"]),
  createdAt: z.string(),
});

// Channel schemas
export const CreateChannelRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9][a-z0-9_-]*$/,
      "Channel name must be lowercase alphanumeric with hyphens/underscores",
    ),
  description: z.string().max(256).optional(),
});

// Task schemas
export const TaskStatusSchema = z.enum([
  "pending",
  "assigned",
  "running",
  "done",
  "failed",
]);

export const CreateTaskRequestSchema = z.object({
  type: z.string().min(1),
  requiredCapabilities: z.array(z.string()).min(1),
  payload: z.record(z.unknown()),
  timeoutMs: z.number().int().positive().optional().default(30000),
});

export const UpdateTaskStatusRequestSchema = z.object({
  status: TaskStatusSchema,
  result: z.record(z.unknown()).optional(),
});

// Owner schemas
export const CreateOwnerRequestSchema = z.object({
  name: z.string().min(1).max(128),
});
