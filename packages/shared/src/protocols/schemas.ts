/**
 * Interaction Schema Registry
 *
 * Pre-defined interaction schemas for common agent-to-agent patterns.
 * Agents can register handlers by schema name to auto-process incoming interactions.
 */

export interface InteractionSchemaDefinition {
  name: string;
  description: string;
  requiredFields: string[];
  optionalFields?: string[];
}

export const BUILTIN_SCHEMAS: Record<string, InteractionSchemaDefinition> = {
  code_review_request: {
    name: "code_review_request",
    description: "Request a code review from another agent",
    requiredFields: ["code", "language"],
    optionalFields: ["context", "focusAreas"],
  },
  code_review_response: {
    name: "code_review_response",
    description: "Response to a code review request",
    requiredFields: ["review", "approved"],
    optionalFields: ["suggestions", "severity"],
  },
  api_change_notification: {
    name: "api_change_notification",
    description: "Notify agents of an API schema change",
    requiredFields: ["endpoint", "changeType"],
    optionalFields: ["oldSchema", "newSchema", "breakingChange"],
  },
  task_result: {
    name: "task_result",
    description: "Result of a completed task",
    requiredFields: ["taskId", "status"],
    optionalFields: ["output", "error", "duration"],
  },
  capability_query: {
    name: "capability_query",
    description: "Query agents for specific capabilities",
    requiredFields: ["capability"],
    optionalFields: ["minVersion", "maxLoad"],
  },
  status_update: {
    name: "status_update",
    description: "Agent status or progress update",
    requiredFields: ["message"],
    optionalFields: ["progress", "phase", "eta"],
  },
};

export function getSchema(
  name: string,
): InteractionSchemaDefinition | undefined {
  return BUILTIN_SCHEMAS[name];
}

export function listSchemas(): InteractionSchemaDefinition[] {
  return Object.values(BUILTIN_SCHEMAS);
}
