import type { Interaction, SendInteractionRequest } from "@agentmesh/shared";
import type { InteractionHandler } from "../types.js";

/**
 * Default handler: logs unhandled interactions.
 * In a full implementation, this could forward to an LLM for decision-making.
 */
export class DefaultHandler implements InteractionHandler {
  canHandle(_interaction: Interaction): boolean {
    return true;
  }

  async handle(interaction: Interaction): Promise<SendInteractionRequest | null> {
    console.log(
      `[runtime] Unhandled interaction: type=${interaction.type} schema=${interaction.metadata?.schema ?? "none"} from=${interaction.fromAgent}`,
    );

    // If reply expected, send a generic acknowledgement
    if (interaction.metadata?.expectReply) {
      return {
        type: "message",
        contentType: "text",
        target: { agentId: interaction.fromAgent },
        payload: {
          text: `Received your ${interaction.type}, but I don't have a handler for schema '${interaction.metadata?.schema ?? "unknown"}'.`,
        },
        metadata: {
          correlationId: interaction.metadata?.correlationId ?? interaction.id,
        },
      };
    }

    return null;
  }
}
