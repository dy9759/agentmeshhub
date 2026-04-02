import { eq, and, or, gt, ne, desc, inArray, sql } from "drizzle-orm";
import {
  generateInteractionId,
  AppError,
  type Interaction,
  type SendInteractionRequest,
  type SenderType,
} from "@agentmesh/shared";
import type { DB } from "../db/connection.js";
import { interactions, channelMembers, agents, owners } from "../db/schema.js";
import type { MessageBus } from "../interfaces/message-bus.js";
import type { Registry } from "../interfaces/registry.js";
import type { WebSocketManager } from "./websocket-manager.js";

function rowToInteraction(row: typeof interactions.$inferSelect): Interaction {
  const fromType = (row.fromType ?? "agent") as SenderType;
  const fromId = row.fromId ?? row.fromAgent ?? "";
  return {
    id: row.id,
    type: row.type as Interaction["type"],
    contentType: row.contentType as Interaction["contentType"],
    fromId,
    fromType,
    fromAgent: fromType === "agent" ? fromId : "", // deprecated: only set for agent senders
    target: {
      agentId: row.toAgent ?? undefined,
      ownerId: row.toOwner ?? undefined,
      channel: row.channel ?? undefined,
      capability: row.capability ?? undefined,
    },
    payload: JSON.parse(row.payload),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    status: row.status as Interaction["status"],
    createdAt: row.createdAt,
  };
}

export class MessageBusService implements MessageBus {
  private wsManager?: WebSocketManager;

  constructor(
    private db: DB,
    private registry: Registry,
  ) {}

  setWebSocketManager(wsManager: WebSocketManager): void {
    this.wsManager = wsManager;
  }

  /**
   * Validate that the target agent or owner exists.
   * Throws AppError(404) if not found.
   */
  private validateTarget(request: SendInteractionRequest): void {
    if (request.target.agentId) {
      const agent = this.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(eq(agents.agentId, request.target.agentId))
        .get();
      if (!agent) {
        throw new AppError(`Target agent '${request.target.agentId}' not found`, 404);
      }
    }
    if (request.target.ownerId) {
      const owner = this.db
        .select({ ownerId: owners.ownerId })
        .from(owners)
        .where(eq(owners.ownerId, request.target.ownerId))
        .get();
      if (!owner) {
        throw new AppError(`Target owner '${request.target.ownerId}' not found`, 404);
      }
    }
  }

  async send(
    fromId: string,
    fromType: SenderType,
    request: SendInteractionRequest,
  ): Promise<Interaction> {
    // P0: Validate target exists
    this.validateTarget(request);

    const id = generateInteractionId();
    const now = new Date().toISOString();

    this.db
      .insert(interactions)
      .values({
        id,
        type: request.type,
        fromId,
        fromType,
        fromAgent: fromType === "agent" ? fromId : null, // P1: only set for agents
        toAgent: request.target.agentId ?? null,
        toOwner: request.target.ownerId ?? null,
        channel: request.target.channel ?? null,
        capability: request.target.capability ?? null,
        contentType: request.contentType,
        schema: request.metadata?.schema ?? null,
        payload: JSON.stringify(request.payload),
        metadata: request.metadata
          ? JSON.stringify(request.metadata)
          : null,
        status: "pending",
        createdAt: now,
      })
      .run();

    const interaction: Interaction = {
      id,
      type: request.type,
      contentType: request.contentType,
      fromId,
      fromType,
      fromAgent: fromType === "agent" ? fromId : "", // deprecated compat
      target: request.target,
      payload: request.payload,
      metadata: request.metadata,
      status: "pending",
      createdAt: now,
    };

    // Try WebSocket push for DM to agent
    if (this.wsManager && request.target.agentId) {
      this.wsManager.pushToAgent(request.target.agentId, interaction);
    }

    return interaction;
  }

  async sendToChannel(
    fromId: string,
    fromType: SenderType,
    channel: string,
    request: SendInteractionRequest,
  ): Promise<Interaction> {
    return this.send(fromId, fromType, {
      ...request,
      target: { ...request.target, channel },
    });
  }

  async broadcast(
    fromId: string,
    fromType: SenderType,
    request: SendInteractionRequest,
  ): Promise<Interaction[]> {
    const capability = request.target.capability;
    if (!capability) {
      throw new Error("broadcast requires target.capability");
    }

    const matchedAgents = await this.registry.matchByCapability(capability, {
      maxLoad: 0.7,
    });

    const results: Interaction[] = [];
    for (const agent of matchedAgents) {
      if (agent.agentId === fromId) continue;
      const interaction = await this.send(fromId, fromType, {
        ...request,
        target: { agentId: agent.agentId, capability },
      });
      results.push(interaction);
    }

    return results;
  }

  /**
   * Mark interactions as delivered after polling.
   */
  private markDelivered(ids: string[]): void {
    if (ids.length === 0) return;
    this.db
      .update(interactions)
      .set({ status: "delivered" })
      .where(
        and(
          inArray(interactions.id, ids),
          eq(interactions.status, "pending"),
        ),
      )
      .run();
  }

  /**
   * Poll inbox for an agent. Returns interactions and marks them as delivered.
   */
  async poll(
    agentId: string,
    opts?: { afterId?: string; limit?: number },
  ): Promise<{ interactions: Interaction[]; nextCursor?: string }> {
    const limit = opts?.limit ?? 50;

    // Get direct messages to this agent
    const conditions = [eq(interactions.toAgent, agentId)];

    if (opts?.afterId) {
      const cursor = this.db
        .select({ createdAt: interactions.createdAt })
        .from(interactions)
        .where(eq(interactions.id, opts.afterId))
        .get();
      if (cursor) {
        conditions.push(gt(interactions.createdAt, cursor.createdAt));
      }
    }

    const directMessages = this.db
      .select()
      .from(interactions)
      .where(and(...conditions))
      .orderBy(interactions.createdAt)
      .limit(limit)
      .all();

    // Get channels this agent is a member of
    const memberships = this.db
      .select({ channel: channelMembers.channel })
      .from(channelMembers)
      .where(eq(channelMembers.agentId, agentId))
      .all();

    const channelNames = memberships.map((m) => m.channel);

    let channelMessages: (typeof interactions.$inferSelect)[] = [];
    if (channelNames.length > 0) {
      const channelConditions = [
        inArray(interactions.channel, channelNames),
      ];

      if (opts?.afterId) {
        const cursor = this.db
          .select({ createdAt: interactions.createdAt })
          .from(interactions)
          .where(eq(interactions.id, opts.afterId))
          .get();
        if (cursor) {
          channelConditions.push(
            gt(interactions.createdAt, cursor.createdAt),
          );
        }
      }

      channelMessages = this.db
        .select()
        .from(interactions)
        .where(and(...channelConditions))
        .orderBy(interactions.createdAt)
        .limit(limit)
        .all();
    }

    // Merge, deduplicate, sort, limit
    const allRows = [...directMessages, ...channelMessages];
    const seen = new Set<string>();
    const unique = allRows.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    unique.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const sliced = unique.slice(0, limit);

    // Mark as delivered
    this.markDelivered(sliced.filter((r) => r.status === "pending").map((r) => r.id));

    const result = sliced.map(rowToInteraction);
    const nextCursor = result.length > 0 ? result[result.length - 1].id : undefined;

    return { interactions: result, nextCursor };
  }

  /**
   * Poll inbox for an owner — messages sent TO this owner.
   */
  async pollOwner(
    ownerId: string,
    opts?: { afterId?: string; limit?: number },
  ): Promise<{ interactions: Interaction[]; nextCursor?: string }> {
    const limit = opts?.limit ?? 50;
    const conditions = [eq(interactions.toOwner, ownerId)];

    if (opts?.afterId) {
      const cursor = this.db
        .select({ createdAt: interactions.createdAt })
        .from(interactions)
        .where(eq(interactions.id, opts.afterId))
        .get();
      if (cursor) {
        conditions.push(gt(interactions.createdAt, cursor.createdAt));
      }
    }

    const rows = this.db
      .select()
      .from(interactions)
      .where(and(...conditions))
      .orderBy(interactions.createdAt)
      .limit(limit)
      .all();

    // Mark as delivered
    this.markDelivered(rows.filter((r) => r.status === "pending").map((r) => r.id));

    const result = rows.map(rowToInteraction);
    const nextCursor = result.length > 0 ? result[result.length - 1].id : undefined;

    return { interactions: result, nextCursor };
  }

  /**
   * Get conversations for an agent.
   */
  async getConversations(agentId: string): Promise<
    Array<{
      agentId: string;
      lastMessage: Interaction;
      lastMessageAt: string;
    }>
  > {
    const rows = this.db
      .select()
      .from(interactions)
      .where(
        and(
          or(
            eq(interactions.toAgent, agentId),
            eq(interactions.fromId, agentId),
          ),
          sql`(${interactions.toAgent} IS NOT NULL OR ${interactions.toOwner} IS NOT NULL)`,
          sql`${interactions.channel} IS NULL`,
          ne(interactions.type, "broadcast"), // exclude broadcasts
        ),
      )
      .orderBy(desc(interactions.createdAt))
      .all();

    const convMap = new Map<string, Interaction>();
    for (const row of rows) {
      const isFromMe = row.fromId === agentId;
      const otherId = isFromMe
        ? (row.toAgent ?? row.toOwner!)
        : row.fromId;
      if (!convMap.has(otherId)) {
        convMap.set(otherId, rowToInteraction(row));
      }
    }

    return Array.from(convMap.entries()).map(([otherAgentId, lastMessage]) => ({
      agentId: otherAgentId,
      lastMessage,
      lastMessageAt: lastMessage.createdAt,
    }));
  }

  /**
   * Get conversations for an owner.
   */
  async getOwnerConversations(ownerId: string): Promise<
    Array<{
      peerId: string;
      peerType: "agent" | "owner";
      lastMessage: Interaction;
      lastMessageAt: string;
    }>
  > {
    const rows = this.db
      .select()
      .from(interactions)
      .where(
        and(
          or(
            eq(interactions.toOwner, ownerId),
            and(
              eq(interactions.fromId, ownerId),
              eq(interactions.fromType, "owner"),
            ),
          ),
          sql`${interactions.channel} IS NULL`,
          ne(interactions.type, "broadcast"),
        ),
      )
      .orderBy(desc(interactions.createdAt))
      .all();

    const convMap = new Map<string, { interaction: Interaction; peerType: "agent" | "owner" }>();
    for (const row of rows) {
      const isFromMe = row.fromId === ownerId && row.fromType === "owner";
      let peerId: string;
      let peerType: "agent" | "owner";
      if (isFromMe) {
        if (row.toAgent) { peerId = row.toAgent; peerType = "agent"; }
        else if (row.toOwner) { peerId = row.toOwner; peerType = "owner"; }
        else continue;
      } else {
        peerId = row.fromId!;
        peerType = (row.fromType ?? "agent") as "agent" | "owner";
      }
      if (!convMap.has(peerId)) {
        convMap.set(peerId, { interaction: rowToInteraction(row), peerType });
      }
    }

    return Array.from(convMap.entries()).map(([peerId, { interaction, peerType }]) => ({
      peerId,
      peerType,
      lastMessage: interaction,
      lastMessageAt: interaction.createdAt,
    }));
  }

  /**
   * Get chat history between two entities.
   * Excludes broadcasts — only direct messages.
   */
  async getChatHistory(
    myId: string,
    otherId: string,
    opts?: { afterId?: string; limit?: number; beforeId?: string },
  ): Promise<Interaction[]> {
    const limit = opts?.limit ?? 50;

    const conditions = [
      or(
        and(
          eq(interactions.fromId, myId),
          or(eq(interactions.toAgent, otherId), eq(interactions.toOwner, otherId)),
        ),
        and(
          eq(interactions.fromId, otherId),
          or(eq(interactions.toAgent, myId), eq(interactions.toOwner, myId)),
        ),
      )!,
      ne(interactions.type, "broadcast"), // P1: exclude broadcasts
    ];

    if (opts?.afterId) {
      const cursor = this.db
        .select({ createdAt: interactions.createdAt })
        .from(interactions)
        .where(eq(interactions.id, opts.afterId))
        .get();
      if (cursor) {
        conditions.push(gt(interactions.createdAt, cursor.createdAt));
      }
    }

    const rows = this.db
      .select()
      .from(interactions)
      .where(and(...conditions))
      .orderBy(interactions.createdAt)
      .limit(limit)
      .all();

    return rows.map(rowToInteraction);
  }

  async getChannelMessages(
    channel: string,
    opts?: { afterId?: string; limit?: number },
  ): Promise<Interaction[]> {
    const limit = opts?.limit ?? 50;
    const conditions = [eq(interactions.channel, channel)];

    if (opts?.afterId) {
      const cursor = this.db
        .select({ createdAt: interactions.createdAt })
        .from(interactions)
        .where(eq(interactions.id, opts.afterId))
        .get();
      if (cursor) {
        conditions.push(gt(interactions.createdAt, cursor.createdAt));
      }
    }

    const rows = this.db
      .select()
      .from(interactions)
      .where(and(...conditions))
      .orderBy(interactions.createdAt)
      .limit(limit)
      .all();

    return rows.map(rowToInteraction);
  }

  /**
   * P2: Clean up old interactions older than given days.
   */
  async cleanOldInteractions(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db
      .delete(interactions)
      .where(sql`${interactions.createdAt} < ${cutoff}`)
      .run();
    return result.changes;
  }
}
