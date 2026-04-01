import type { Interaction } from "@agentmesh/shared";
import type { InteractionHandler } from "../types.js";

/**
 * HandlerRegistry: maps interaction schemas/types to handlers.
 *
 * Matching priority:
 * 1. Exact schema match (metadata.schema)
 * 2. Capability match (for broadcasts)
 * 3. canHandle() check on each handler
 * 4. Default handler (if set)
 */
export class HandlerRegistry {
  private schemaHandlers = new Map<string, InteractionHandler>();
  private capabilityHandlers = new Map<string, InteractionHandler>();
  private genericHandlers: InteractionHandler[] = [];
  private defaultHandler: InteractionHandler | null = null;

  onSchema(schema: string, handler: InteractionHandler): void {
    this.schemaHandlers.set(schema, handler);
  }

  onCapability(capability: string, handler: InteractionHandler): void {
    this.capabilityHandlers.set(capability, handler);
  }

  addHandler(handler: InteractionHandler): void {
    this.genericHandlers.push(handler);
  }

  setDefaultHandler(handler: InteractionHandler): void {
    this.defaultHandler = handler;
  }

  match(interaction: Interaction): InteractionHandler | null {
    // 1. Schema match
    const schema = interaction.metadata?.schema;
    if (schema && this.schemaHandlers.has(schema)) {
      return this.schemaHandlers.get(schema)!;
    }

    // 2. Capability match (for broadcasts)
    const capability = interaction.target.capability;
    if (capability && this.capabilityHandlers.has(capability)) {
      return this.capabilityHandlers.get(capability)!;
    }

    // 3. Generic handlers
    for (const handler of this.genericHandlers) {
      if (handler.canHandle(interaction)) {
        return handler;
      }
    }

    // 4. Default
    return this.defaultHandler;
  }
}
