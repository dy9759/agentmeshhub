import { HubClient } from "@agentmesh/hub";
import type { Interaction, SendInteractionRequest } from "@agentmesh/shared";
import { HandlerRegistry } from "./handlers/registry.js";
import { DefaultHandler } from "./handlers/default.js";
import type { InteractionHandler, RuntimeConfig } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AgentRuntime {
  private client: HubClient;
  private config: RuntimeConfig;
  private handlers: HandlerRegistry;
  private agentId: string | null = null;
  private running = false;
  private lastSeenId: string | undefined;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private wsActive = false;

  constructor(config: RuntimeConfig) {
    this.config = config;
    this.client = new HubClient({
      hubUrl: config.hubUrl,
      apiKey: config.apiKey,
    });
    this.handlers = new HandlerRegistry();
    this.handlers.setDefaultHandler(new DefaultHandler());
  }

  /**
   * Register a handler for a specific interaction schema
   */
  onInteraction(schema: string, handler: InteractionHandler): void {
    this.handlers.onSchema(schema, handler);
  }

  /**
   * Register a handler for broadcast messages targeting a capability
   */
  onBroadcast(capability: string, handler: InteractionHandler): void {
    this.handlers.onCapability(capability, handler);
  }

  /**
   * Add a generic handler (checked via canHandle)
   */
  addHandler(handler: InteractionHandler): void {
    this.handlers.addHandler(handler);
  }

  /**
   * Set the default handler for unmatched interactions
   */
  setDefaultHandler(handler: InteractionHandler): void {
    this.handlers.setDefaultHandler(handler);
  }

  /**
   * Start the autonomous runtime loop:
   * 1. Register with Hub
   * 2. Start heartbeat
   * 3. Connect WebSocket (if enabled)
   * 4. Start message poll loop (as fallback)
   */
  async start(): Promise<void> {
    if (this.running) return;

    console.log(`[runtime] Starting agent '${this.config.name}'...`);

    // Register
    const result = await this.client.register({
      name: this.config.name,
      type: this.config.type ?? "generic",
      capabilities: this.config.capabilities,
      machineId: this.config.machineId,
    });

    this.agentId = result.agentId;
    this.client.setAgentToken(result.agentToken);

    console.log(`[runtime] Registered as ${this.agentId}`);

    // Start heartbeat
    this.startHeartbeat();

    // Connect WebSocket for real-time messages
    if (this.config.useWebSocket !== false) {
      this.startWebSocket();
    }

    // Start message loop (always runs as fallback, slower when WS is active)
    this.running = true;
    this.messageLoop();
  }

  /**
   * Stop the runtime loop gracefully
   */
  async stop(): Promise<void> {
    console.log(`[runtime] Stopping agent '${this.config.name}'...`);
    this.running = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Disconnect WebSocket
    this.client.disconnectWebSocket();

    if (this.agentId) {
      try {
        await this.client.unregister(this.agentId);
      } catch {
        // Best effort
      }
    }
  }

  getAgentId(): string | null {
    return this.agentId;
  }

  getClient(): HubClient {
    return this.client;
  }

  private startWebSocket(): void {
    if (!this.agentId) return;

    this.client.connectWebSocket(this.agentId);

    // Handle messages received via WebSocket
    this.client.onInteraction(async (interaction) => {
      this.wsActive = true;
      await this.handleInteraction(interaction);
    });

    console.log(`[runtime] WebSocket connecting...`);
  }

  private startHeartbeat(): void {
    const interval = this.config.heartbeatIntervalMs ?? 30_000;

    this.heartbeatTimer = setInterval(async () => {
      if (!this.agentId) return;
      try {
        await this.client.heartbeat({ agentId: this.agentId });
      } catch (err) {
        console.error("[runtime] Heartbeat failed:", err);
      }
    }, interval);
  }

  private async messageLoop(): Promise<void> {
    const basePollInterval = this.config.pollIntervalMs ?? 3000;

    while (this.running) {
      try {
        if (!this.agentId) break;

        const { interactions } = await this.client.pollInteractions(
          this.agentId,
          { afterId: this.lastSeenId },
        );

        for (const interaction of interactions) {
          this.lastSeenId = interaction.id;
          await this.handleInteraction(interaction);
        }
      } catch (err) {
        console.error("[runtime] Poll error:", err);
      }

      // When WS is active, poll less frequently (10s); otherwise normal (3s)
      const interval = this.client.isWebSocketConnected() ? 10_000 : basePollInterval;
      await sleep(interval);
    }
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    // Skip self-sent messages
    if (interaction.fromAgent === this.agentId) return;

    const handler = this.handlers.match(interaction);
    if (!handler) return;

    try {
      const response = await handler.handle(interaction);
      if (response) {
        await this.client.sendInteraction(response);
      }
    } catch (err) {
      console.error(
        `[runtime] Handler error for ${interaction.id}:`,
        err,
      );
    }
  }
}
