import { eq, and, lte, sql } from "drizzle-orm";
import {
  generateAgentId,
  type Agent,
  type AgentRegistration,
  type AgentHeartbeat,
  type AgentFilter,
  type AgentState,
} from "@agentmesh/shared";
import type { DB } from "../db/connection.js";
import { agents } from "../db/schema.js";
import type { Registry } from "../interfaces/registry.js";

function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function rowToAgent(row: typeof agents.$inferSelect): Agent & { profile: Record<string, unknown> } {
  const caps: string[] = JSON.parse(row.capabilities);
  return {
    agentId: row.agentId,
    ownerId: row.ownerId,
    name: row.name,
    type: row.type as Agent["type"],
    version: row.version ?? undefined,
    machineId: row.machineId ?? undefined,
    state: {
      status: row.status as AgentState["status"],
      load: row.load,
      currentTaskId: row.currentTaskId ?? undefined,
      currentTaskType: row.currentTaskType ?? undefined,
      capabilities: caps,
      availableCapacity: row.availableCapacity,
      lastActiveAt: row.lastHeartbeat,
    },
    registeredAt: row.registeredAt,
    lastHeartbeat: row.lastHeartbeat,
    profile: {
      displayName: row.displayName ?? null,
      avatar: row.avatar ?? null,
      bio: row.bio ?? null,
      tags: safeJsonParse(row.tags, []),
      metadata: safeJsonParse(row.agentMetadata, {}),
    },
  } as Agent & { profile: Record<string, unknown> };
}

export class RegistryService implements Registry {
  constructor(private db: DB) {}

  async register(
    ownerId: string,
    registration: AgentRegistration,
  ): Promise<Agent> {
    const capabilities = JSON.stringify(registration.capabilities ?? []);

    // Upsert: same name + machineId + ownerId = update
    const existing = this.db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.name, registration.name),
          eq(agents.ownerId, ownerId),
          registration.machineId
            ? eq(agents.machineId, registration.machineId)
            : sql`${agents.machineId} IS NULL`,
        ),
      )
      .get();

    if (existing) {
      this.db
        .update(agents)
        .set({
          type: registration.type,
          version: registration.version,
          capabilities,
          status: "online",
          lastHeartbeat: new Date().toISOString(),
        })
        .where(eq(agents.agentId, existing.agentId))
        .run();

      return this.findById(existing.agentId) as Promise<Agent>;
    }

    const agentId = generateAgentId();
    const now = new Date().toISOString();

    this.db
      .insert(agents)
      .values({
        agentId,
        ownerId,
        name: registration.name,
        type: registration.type,
        version: registration.version,
        machineId: registration.machineId,
        capabilities,
        status: "online",
        load: 0,
        availableCapacity: 5,
        registeredAt: now,
        lastHeartbeat: now,
      })
      .run();

    return this.findById(agentId) as Promise<Agent>;
  }

  async heartbeat(hb: AgentHeartbeat): Promise<Agent> {
    const updates: Partial<typeof agents.$inferInsert> = {
      lastHeartbeat: new Date().toISOString(),
      status: "online",
    };
    if (hb.load !== undefined) updates.load = hb.load;
    if (hb.currentTaskId !== undefined) updates.currentTaskId = hb.currentTaskId;
    if (hb.currentTaskType !== undefined) updates.currentTaskType = hb.currentTaskType;
    if (hb.availableCapacity !== undefined) updates.availableCapacity = hb.availableCapacity;

    this.db
      .update(agents)
      .set(updates)
      .where(eq(agents.agentId, hb.agentId))
      .run();

    return this.findById(hb.agentId) as Promise<Agent>;
  }

  async unregister(agentId: string): Promise<void> {
    this.db
      .update(agents)
      .set({ status: "offline" })
      .where(eq(agents.agentId, agentId))
      .run();
  }

  async find(filter: AgentFilter): Promise<Agent[]> {
    let query = this.db.select().from(agents).$dynamic();

    const conditions = [];
    if (filter.type) conditions.push(eq(agents.type, filter.type));
    if (filter.status) conditions.push(eq(agents.status, filter.status));
    if (filter.ownerId) conditions.push(eq(agents.ownerId, filter.ownerId));
    if (filter.maxLoad !== undefined) conditions.push(lte(agents.load, filter.maxLoad));

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const rows = query.all();

    let result = rows.map(rowToAgent);

    // Filter by capability in JS (JSON array in SQLite)
    if (filter.capability) {
      result = result.filter((a) =>
        a.state.capabilities.includes(filter.capability!),
      );
    }

    return result;
  }

  async findById(agentId: string): Promise<Agent | null> {
    const row = this.db
      .select()
      .from(agents)
      .where(eq(agents.agentId, agentId))
      .get();

    return row ? rowToAgent(row) : null;
  }

  async matchByCapability(
    capability: string,
    opts?: { maxLoad?: number; limit?: number },
  ): Promise<Agent[]> {
    const allOnline = await this.find({
      status: "online",
      capability,
      maxLoad: opts?.maxLoad,
    });

    // Sort by load ascending (prefer least loaded agents)
    allOnline.sort((a, b) => a.state.load - b.state.load);

    return opts?.limit ? allOnline.slice(0, opts.limit) : allOnline;
  }

  async updateProfile(agentId: string, updates: Record<string, unknown>): Promise<void> {
    this.db.update(agents).set(updates).where(eq(agents.agentId, agentId)).run();
  }

  async markStaleOffline(thresholdSeconds: number): Promise<number> {
    const cutoff = new Date(
      Date.now() - thresholdSeconds * 1000,
    ).toISOString();

    const result = this.db
      .update(agents)
      .set({ status: "offline" })
      .where(
        and(eq(agents.status, "online"), lte(agents.lastHeartbeat, cutoff)),
      )
      .run();

    return result.changes;
  }
}
