import { eq, and, ne, desc, sql } from "drizzle-orm";
import type { DB } from "../db/connection.js";
import { agents, interactions, channelMembers } from "../db/schema.js";
import type { Interaction } from "@agentmesh/shared";

export type LLMProvider = "anthropic" | "openai-compatible";

export interface LLMBackend {
  provider: LLMProvider;
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface AutoReplyConfig {
  enabled: boolean;
  pollIntervalMs?: number; // default 5000 (5 seconds)
  permissions?: {
    autoCreateSession?: boolean;
    autoShareFiles?: boolean;
    autoInviteAgents?: boolean;
    maxCostPerSession?: number;
  };
  // Primary LLM (legacy fields, maps to anthropic)
  llmEndpoint?: string;
  llmApiKey?: string;
  model?: string;
  // Fallback LLM (e.g. 百炼 DashScope)
  fallback?: {
    provider: LLMProvider;
    endpoint: string;
    apiKey: string;
    model: string;
  };
  systemPrompt?: string;
}

function safeJsonParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; } catch { return fallback; }
}

function shouldRespondToChannelMessage(
  agentId: string,
  agentName: string,
  capabilities: string[],
  text: string,
): "forced" | "suggested" | "ignore" {
  const lower = text.toLowerCase();
  // @mention detection (forced response)
  if (lower.includes(`@${agentName.toLowerCase()}`) || lower.includes(`@${agentId.toLowerCase()}`)) {
    return "forced";
  }
  // Capability keyword matching (suggested response)
  for (const cap of capabilities) {
    if (cap && lower.includes(cap.toLowerCase())) {
      return "suggested";
    }
  }
  return "ignore";
}

function rowToInteraction(row: any): Interaction {
  return {
    id: row.id,
    type: row.type,
    contentType: row.contentType ?? "text",
    fromId: row.fromId ?? row.fromAgent ?? "",
    fromType: (row.fromType ?? "agent") as "agent" | "owner",
    fromAgent: row.fromType === "agent" ? (row.fromId ?? "") : "",
    target: {
      agentId: row.toAgent ?? undefined,
      ownerId: row.toOwner ?? undefined,
      channel: row.channel ?? undefined,
      sessionId: row.sessionId ?? undefined,
    },
    payload: safeJsonParse(row.payload, {}),
    metadata: row.metadata ? safeJsonParse(row.metadata, undefined) : undefined,
    status: row.status ?? "pending",
    createdAt: row.createdAt,
  };
}

export class AutoReplyService {
  private activeLoops = new Set<string>();
  private messageBus: any;
  private sessionService: any;

  // Polling daemon state
  private pollTimer: NodeJS.Timeout | null = null;
  private lastCheckedAt = new Map<string, string>(); // agentId → last checked timestamp

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
    // Restart poll daemon if config changed
    this.restartPollDaemon();
  }

  shouldAutoReply(agentId: string, interaction: Interaction): boolean {
    const config = this.getConfig(agentId);
    if (!config?.enabled) return false;
    if (interaction.fromId === agentId) return false;
    // Reply to session messages OR channel messages
    if (interaction.target?.sessionId || interaction.target?.channel) return true;
    // Also reply to direct messages
    return true;
  }

  /**
   * Build the list of LLM backends to try (primary → fallback).
   */
  private getBackends(config: AutoReplyConfig): LLMBackend[] {
    const backends: LLMBackend[] = [];

    // Primary: from legacy fields
    if (config.llmApiKey) {
      const endpoint = config.llmEndpoint ?? "https://api.anthropic.com/v1/messages";
      const isOpenAI = endpoint.includes("dashscope") || endpoint.includes("openai") || endpoint.includes("compatible");
      backends.push({
        provider: isOpenAI ? "openai-compatible" : "anthropic",
        endpoint,
        apiKey: config.llmApiKey,
        model: config.model ?? (isOpenAI ? "qwen-plus" : "claude-sonnet-4-20250514"),
      });
    }

    // Fallback
    if (config.fallback?.apiKey) {
      backends.push({
        provider: config.fallback.provider ?? "openai-compatible",
        endpoint: config.fallback.endpoint,
        apiKey: config.fallback.apiKey,
        model: config.fallback.model,
      });
    }

    return backends;
  }

  /**
   * Call Anthropic API format.
   */
  private async callAnthropic(backend: LLMBackend, systemPrompt: string, messages: Array<{ role: string; content: string }>): Promise<string> {
    const res = await fetch(backend.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": backend.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: backend.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: messages.length > 0 ? messages : [{ role: "user", content: "Start the discussion." }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic ${res.status}: ${err}`);
    }

    const data = await res.json() as any;
    return data.content?.[0]?.text ?? "";
  }

  /**
   * Call OpenAI-compatible API format (百炼 DashScope, OpenAI, etc).
   */
  private async callOpenAICompatible(backend: LLMBackend, systemPrompt: string, messages: Array<{ role: string; content: string }>): Promise<string> {
    const allMessages = [
      { role: "system", content: systemPrompt },
      ...(messages.length > 0 ? messages : [{ role: "user", content: "Start the discussion." }]),
    ];

    const res = await fetch(backend.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${backend.apiKey}`,
      },
      body: JSON.stringify({
        model: backend.model,
        messages: allMessages,
        max_tokens: 2048,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI-compatible ${res.status}: ${err}`);
    }

    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content ?? "";
  }

  async generateReply(
    config: AutoReplyConfig,
    contextMessages: Interaction[],
    context: any,
    agentName: string,
  ): Promise<string> {
    const backends = this.getBackends(config);

    if (backends.length === 0) {
      return "[AutoReply] No LLM configured. Set llmApiKey or fallback.";
    }

    const systemPrompt = config.systemPrompt ??
      `You are ${agentName}, an AI agent participating in a collaborative discussion. ` +
      `Respond naturally based on the conversation context. ` +
      `When the discussion is concluded, end with [END].`;

    const messages = contextMessages.map(m => ({
      role: m.fromId === agentName ? "assistant" as const : "user" as const,
      content: m.payload?.text ?? JSON.stringify(m.payload?.data) ?? "",
    }));

    if (context?.topic) {
      messages.unshift({ role: "user", content: `[Topic: ${context.topic}]` });
    }

    // Try each backend in order (primary → fallback)
    for (const backend of backends) {
      try {
        console.log(`[auto-reply] Trying ${backend.provider} (${backend.model}) for ${agentName}`);

        const text = backend.provider === "anthropic"
          ? await this.callAnthropic(backend, systemPrompt, messages)
          : await this.callOpenAICompatible(backend, systemPrompt, messages);

        if (text?.trim()) {
          return text;
        }
      } catch (err: any) {
        console.error(`[auto-reply] ${backend.provider} failed: ${err.message}`);
        // Continue to fallback
      }
    }

    console.error(`[auto-reply] All LLM backends failed for ${agentName}`);
    return "";
  }

  async executeAutoReply(agentId: string, sessionId: string, triggerInteraction: Interaction): Promise<void> {
    if (!this.messageBus || !this.sessionService) return;

    const loopKey = `${sessionId}:${agentId}`;
    if (this.activeLoops.has(loopKey)) return;
    this.activeLoops.add(loopKey);

    try {
      const config = this.getConfig(agentId);
      if (!config?.enabled) return;

      const session = await this.sessionService.findById(sessionId);
      if (!session || (session.status !== "active" && session.status !== "waiting")) return;

      const messagesResult = await this.sessionService.getMessages(sessionId);
      const messages = Array.isArray(messagesResult) ? messagesResult : [];

      const agentRow = this.db.select({ name: agents.name }).from(agents).where(eq(agents.agentId, agentId)).get();
      const agentName = agentRow?.name ?? agentId;

      const replyText = await this.generateReply(config, messages, session.context, agentName);
      if (!replyText?.trim()) return;

      const targetId = triggerInteraction.fromId;
      const targetType = triggerInteraction.fromType;
      const target: any = { sessionId };
      if (targetType === "agent") target.agentId = targetId;
      else target.ownerId = targetId;

      await this.messageBus.send(agentId, "agent", {
        type: "message",
        contentType: "text",
        target,
        payload: { text: replyText.replace(/\[END\]\s*$/, "").trim() },
      });

      if (replyText.includes("[END]") || replyText.includes("[DONE]")) {
        await this.sessionService.updateStatus(sessionId, "completed");
      }

      console.log(`[auto-reply] ${agentName} replied in session ${sessionId}`);
    } catch (err: any) {
      console.error(`[auto-reply] Error:`, err.message);
    } finally {
      this.activeLoops.delete(loopKey);
    }
  }

  /**
   * Execute auto-reply for a channel message.
   */
  async executeChannelAutoReply(agentId: string, channelName: string, triggerInteraction: Interaction): Promise<void> {
    if (!this.messageBus) return;

    const loopKey = `ch:${channelName}:${agentId}`;
    if (this.activeLoops.has(loopKey)) return;
    this.activeLoops.add(loopKey);

    try {
      const config = this.getConfig(agentId);
      if (!config?.enabled) return;

      // Get recent channel messages for context
      const rows = this.db.select().from(interactions)
        .where(eq(interactions.channel, channelName))
        .orderBy(desc(interactions.createdAt))
        .limit(20)
        .all();
      const messages = rows.reverse().map(rowToInteraction);

      const agentRow = this.db.select({ name: agents.name }).from(agents).where(eq(agents.agentId, agentId)).get();
      const agentName = agentRow?.name ?? agentId;

      const replyText = await this.generateReply(config, messages, { topic: `#${channelName} channel` }, agentName);
      if (!replyText?.trim()) return;

      await this.messageBus.send(agentId, "agent", {
        type: "message",
        contentType: "text",
        target: { channel: channelName },
        payload: { text: replyText.replace(/\[END\]\s*$/, "").trim() },
      });

      console.log(`[auto-reply] ${agentName} replied in #${channelName}`);
    } catch (err: any) {
      console.error(`[auto-reply] Channel error:`, err.message);
    } finally {
      this.activeLoops.delete(loopKey);
    }
  }

  // ─── 5-Second Polling Daemon ───────────────────────────────────

  /**
   * Start the background polling daemon.
   * Every 5 seconds, checks for new unread messages for all auto-reply enabled agents.
   */
  startPollDaemon(): void {
    if (this.pollTimer) return;

    console.log("[auto-reply] Poll daemon started (5s interval)");
    this.pollTimer = setInterval(() => {
      this.pollAndReply().catch(err => {
        console.error("[auto-reply] Poll error:", err.message);
      });
    }, 5000);
  }

  stopPollDaemon(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log("[auto-reply] Poll daemon stopped");
    }
  }

  restartPollDaemon(): void {
    this.stopPollDaemon();
    // Only restart if any agent has auto-reply enabled
    const enabledAgents = this.getEnabledAgents();
    if (enabledAgents.length > 0) {
      this.startPollDaemon();
    }
  }

  private getEnabledAgents(): Array<{ agentId: string; name: string; config: AutoReplyConfig }> {
    const rows = this.db.select({
      agentId: agents.agentId,
      name: agents.name,
      config: agents.autoReplyConfig,
    }).from(agents).where(
      sql`${agents.autoReplyConfig} IS NOT NULL AND json_extract(${agents.autoReplyConfig}, '$.enabled') = 1`
    ).all();

    return rows.map(r => ({
      agentId: r.agentId,
      name: r.name,
      config: safeJsonParse<AutoReplyConfig>(r.config, { enabled: false }),
    })).filter(r => r.config.enabled);
  }

  private async pollAndReply(): Promise<void> {
    const enabledAgents = this.getEnabledAgents();
    if (enabledAgents.length === 0) return;

    for (const agent of enabledAgents) {
      try {
        await this.pollForAgent(agent.agentId, agent.name, agent.config);
      } catch (err: any) {
        console.error(`[auto-reply] Poll for ${agent.name}:`, err.message);
      }
    }
  }

  private async pollForAgent(agentId: string, _agentName: string, config: AutoReplyConfig): Promise<void> {
    // Fetch agent name and capabilities from DB for @mention detection
    const agentRow = this.db.select({ name: agents.name, capabilities: agents.capabilities })
      .from(agents).where(eq(agents.agentId, agentId)).get();
    const agentName = agentRow?.name ?? agentId;
    const agentCaps: string[] = agentRow?.capabilities ? safeJsonParse(agentRow.capabilities, []) : [];

    const lastChecked = this.lastCheckedAt.get(agentId) ?? new Date(0).toISOString();

    // 1. Check direct messages (to this agent, after last check, not from self)
    const directMsgs = this.db.select().from(interactions).where(
      and(
        eq(interactions.toAgent, agentId),
        ne(interactions.fromId, agentId),
        sql`${interactions.createdAt} > ${lastChecked}`,
        eq(interactions.status, "pending"),
      )
    ).orderBy(interactions.createdAt).limit(5).all();

    // 2. Check channel messages (channels this agent is in)
    const memberChannels = this.db.select({ channel: channelMembers.channel })
      .from(channelMembers)
      .where(eq(channelMembers.agentId, agentId))
      .all();

    const channelMsgs: any[] = [];
    for (const { channel } of memberChannels) {
      const msgs = this.db.select().from(interactions).where(
        and(
          eq(interactions.channel, channel),
          ne(interactions.fromId, agentId),
          sql`${interactions.createdAt} > ${lastChecked}`,
        )
      ).orderBy(interactions.createdAt).limit(3).all();
      channelMsgs.push(...msgs.map(m => ({ ...m, _channel: channel })));
    }

    // 3. Check session messages (sessions this agent participates in)
    // Already handled by the trigger in message-bus.send(), but poll catches missed ones
    const sessionMsgs = this.db.select().from(interactions).where(
      and(
        sql`${interactions.sessionId} IS NOT NULL`,
        eq(interactions.toAgent, agentId),
        ne(interactions.fromId, agentId),
        sql`${interactions.createdAt} > ${lastChecked}`,
      )
    ).orderBy(interactions.createdAt).limit(5).all();

    // Update last checked time
    const now = new Date().toISOString();
    this.lastCheckedAt.set(agentId, now);

    // Process direct messages (always respond — forced)
    for (const row of directMsgs) {
      const interaction = rowToInteraction(row);
      console.log(`[auto-reply] DM from ${interaction.fromId} to ${agentName} — forced response`);
      if (interaction.target?.sessionId) {
        // Session message — use session auto-reply
        await this.executeAutoReply(agentId, interaction.target.sessionId, interaction);
      } else {
        // Direct DM — reply directly
        await this.replyToDM(agentId, agentName, config, interaction);
      }
    }

    // Process channel messages (reply in channel only if mentioned or capability match)
    for (const row of channelMsgs) {
      const interaction = rowToInteraction(row);
      const text = interaction.payload?.text ?? "";
      const responseLevel = shouldRespondToChannelMessage(agentId, agentName, agentCaps, text);

      if (responseLevel === "forced" || responseLevel === "suggested") {
        await this.executeChannelAutoReply(agentId, row._channel ?? interaction.target?.channel!, interaction);
      }
      // else: ignore — don't respond to unrelated channel messages
    }

    // Process missed session messages
    for (const row of sessionMsgs) {
      const interaction = rowToInteraction(row);
      if (interaction.target?.sessionId && !directMsgs.some(d => d.id === row.id)) {
        await this.executeAutoReply(agentId, interaction.target.sessionId, interaction);
      }
    }
  }

  private async replyToDM(agentId: string, agentName: string, config: AutoReplyConfig, trigger: Interaction): Promise<void> {
    if (!this.messageBus) return;

    const loopKey = `dm:${trigger.id}`;
    if (this.activeLoops.has(loopKey)) return;
    this.activeLoops.add(loopKey);

    try {
      // Get recent history with this sender
      const history = this.db.select().from(interactions).where(
        sql`(
          (${interactions.fromId} = ${agentId} AND ${interactions.toAgent} = ${trigger.fromId})
          OR
          (${interactions.fromId} = ${trigger.fromId} AND ${interactions.toAgent} = ${agentId})
        ) AND ${interactions.createdAt} > datetime('now', '-1 hour')`
      ).orderBy(interactions.createdAt).limit(20).all();

      const messages = history.map(rowToInteraction);
      const replyText = await this.generateReply(config, messages, null, agentName);
      if (!replyText?.trim()) return;

      const target: any = {};
      if (trigger.fromType === "agent") target.agentId = trigger.fromId;
      else target.ownerId = trigger.fromId;

      await this.messageBus.send(agentId, "agent", {
        type: "message",
        contentType: "text",
        target,
        payload: { text: replyText.replace(/\[END\]\s*$/, "").trim() },
      });

      console.log(`[auto-reply] ${agentName} replied to DM from ${trigger.fromId}`);
    } catch (err: any) {
      console.error(`[auto-reply] DM error:`, err.message);
    } finally {
      this.activeLoops.delete(loopKey);
    }
  }

  // ─── Session Auto-Discussion ───────────────────────────────────

  async startAutoDiscussion(sessionId: string): Promise<{ started: boolean; reason?: string }> {
    if (!this.sessionService) return { started: false, reason: "Service not available" };

    const session = await this.sessionService.findById(sessionId);
    if (!session) return { started: false, reason: "Session not found" };
    if (session.status !== "active") return { started: false, reason: `Session is ${session.status}` };

    let hasAutoReply = false;
    for (const p of session.participants) {
      if (p.type === "agent") {
        const config = this.getConfig(p.id);
        if (config?.enabled) hasAutoReply = true;
      }
    }

    if (!hasAutoReply) return { started: false, reason: "No participants have auto-reply enabled" };

    // Ensure poll daemon is running
    this.startPollDaemon();

    return { started: true };
  }

  stopAutoDiscussion(sessionId: string): void {
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

  destroy(): void {
    this.stopPollDaemon();
    this.activeLoops.clear();
    this.lastCheckedAt.clear();
  }
}
