import { eq } from "drizzle-orm";
import type { DB } from "../db/connection.js";
import { agents } from "../db/schema.js";
import type { Interaction } from "@agentmesh/shared";

export interface AutoReplyConfig {
  enabled: boolean;
  permissions?: {
    autoCreateSession?: boolean;
    autoShareFiles?: boolean;
    autoInviteAgents?: boolean;
    maxCostPerSession?: number;
  };
  llmEndpoint?: string; // e.g. "https://api.anthropic.com/v1/messages"
  llmApiKey?: string;
  model?: string; // e.g. "claude-sonnet-4-20250514"
  systemPrompt?: string;
}

function safeJsonParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; } catch { return fallback; }
}

export class AutoReplyService {
  private activeLoops = new Set<string>(); // sessionIds with active auto-reply loops
  private messageBus: any; // set later to avoid circular deps
  private sessionService: any;

  constructor(private db: DB) {}

  setMessageBus(bus: any): void { this.messageBus = bus; }
  setSessionService(svc: any): void { this.sessionService = svc; }

  getConfig(agentId: string): AutoReplyConfig | null {
    const row = this.db
      .select({ config: agents.autoReplyConfig })
      .from(agents)
      .where(eq(agents.agentId, agentId))
      .get();
    if (!row?.config) return null;
    return safeJsonParse<AutoReplyConfig>(row.config, { enabled: false });
  }

  async updateConfig(agentId: string, config: AutoReplyConfig): Promise<void> {
    this.db
      .update(agents)
      .set({ autoReplyConfig: JSON.stringify(config) })
      .where(eq(agents.agentId, agentId))
      .run();
  }

  shouldAutoReply(agentId: string, interaction: Interaction): boolean {
    const config = this.getConfig(agentId);
    if (!config?.enabled) return false;
    // Only auto-reply to session messages
    if (!interaction.target?.sessionId) return false;
    // Don't reply to own messages
    if (interaction.fromId === agentId) return false;
    return true;
  }

  async generateReply(
    config: AutoReplyConfig,
    sessionMessages: Interaction[],
    sessionContext: any,
    agentName: string,
  ): Promise<string> {
    const endpoint = config.llmEndpoint ?? "https://api.anthropic.com/v1/messages";
    const apiKey = config.llmApiKey;
    const model = config.model ?? "claude-sonnet-4-20250514";

    if (!apiKey) {
      return "[AutoReply] No LLM API key configured. Please set llmApiKey in auto-reply config.";
    }

    // Build conversation for LLM
    const systemPrompt = config.systemPrompt ??
      `You are ${agentName}, an AI agent participating in a collaborative discussion. ` +
      `Respond thoughtfully to the conversation. When the discussion has reached a conclusion ` +
      `or there's nothing more to add, end your message with [END].`;

    const messages = sessionMessages.map(m => ({
      role: m.fromId === agentName ? "assistant" as const : "user" as const,
      content: m.payload?.text ?? JSON.stringify(m.payload?.data) ?? "",
    }));

    // Add context if available
    if (sessionContext?.topic) {
      messages.unshift({ role: "user", content: `[Session topic: ${sessionContext.topic}]` });
    }

    try {
      // Call Claude API (or compatible endpoint)
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system: systemPrompt,
          messages: messages.length > 0 ? messages : [{ role: "user", content: "Start the discussion." }],
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`[auto-reply] LLM call failed: ${res.status} ${err}`);
        return `[AutoReply Error] LLM returned ${res.status}. Will retry.`;
      }

      const data = await res.json() as any;
      const text = data.content?.[0]?.text ?? data.choices?.[0]?.message?.content ?? "";
      return text;
    } catch (err: any) {
      console.error(`[auto-reply] LLM call error:`, err.message);
      return `[AutoReply Error] ${err.message}`;
    }
  }

  async executeAutoReply(agentId: string, sessionId: string, triggerInteraction: Interaction): Promise<void> {
    if (!this.messageBus || !this.sessionService) return;

    // Prevent concurrent loops for same session
    const loopKey = `${sessionId}:${agentId}`;
    if (this.activeLoops.has(loopKey)) return;
    this.activeLoops.add(loopKey);

    try {
      const config = this.getConfig(agentId);
      if (!config?.enabled) return;

      // Get session info
      const session = await this.sessionService.findById(sessionId);
      if (!session || session.status !== "active") return;

      // Get session messages for context
      const messagesResult = await this.sessionService.getMessages(sessionId);
      const messages = Array.isArray(messagesResult) ? messagesResult : [];

      // Get agent name
      const agentRow = this.db
        .select({ name: agents.name })
        .from(agents)
        .where(eq(agents.agentId, agentId))
        .get();
      const agentName = agentRow?.name ?? agentId;

      // Rate limit: wait 2 seconds
      await new Promise(r => setTimeout(r, 2000));

      // Generate reply
      const replyText = await this.generateReply(config, messages, session.context, agentName);

      if (!replyText || replyText.trim() === "") return;

      // Determine target (the sender of the trigger message)
      const targetId = triggerInteraction.fromId;
      const targetType = triggerInteraction.fromType;

      const target: any = { sessionId };
      if (targetType === "agent") target.agentId = targetId;
      else target.ownerId = targetId;

      // Send reply as the agent
      await this.messageBus.send(agentId, "agent", {
        type: "message",
        contentType: "text",
        target,
        payload: { text: replyText.replace(/\[END\]\s*$/, "").trim() },
      });

      // Check if conversation should end
      if (replyText.includes("[END]") || replyText.includes("[DONE]")) {
        await this.sessionService.updateStatus(sessionId, "completed");
      }

      console.log(`[auto-reply] ${agentName} replied in session ${sessionId}`);
    } catch (err: any) {
      console.error(`[auto-reply] Error for ${agentId} in ${sessionId}:`, err.message);
    } finally {
      this.activeLoops.delete(loopKey);
    }
  }

  // Start auto-discussion: both agents auto-reply in a session
  async startAutoDiscussion(sessionId: string): Promise<{ started: boolean; reason?: string }> {
    if (!this.sessionService) return { started: false, reason: "Service not available" };

    const session = await this.sessionService.findById(sessionId);
    if (!session) return { started: false, reason: "Session not found" };
    if (session.status !== "active") return { started: false, reason: `Session is ${session.status}` };

    // Check if at least one participant has auto-reply enabled
    let hasAutoReply = false;
    for (const p of session.participants) {
      if (p.type === "agent") {
        const config = this.getConfig(p.id);
        if (config?.enabled) hasAutoReply = true;
      }
    }

    if (!hasAutoReply) return { started: false, reason: "No participants have auto-reply enabled" };
    return { started: true };
  }

  stopAutoDiscussion(sessionId: string): void {
    // Remove all active loops for this session
    for (const key of this.activeLoops) {
      if (key.startsWith(sessionId + ":")) {
        this.activeLoops.delete(key);
      }
    }
  }

  isLoopActive(sessionId: string): boolean {
    for (const key of this.activeLoops) {
      if (key.startsWith(sessionId + ":")) return true;
    }
    return false;
  }
}
