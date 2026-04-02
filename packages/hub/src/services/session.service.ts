import { eq, and, desc, sql } from "drizzle-orm";
import {
  generateSessionId,
  AppError,
  type Session,
  type SessionStatus,
  type SessionParticipant,
  type SessionContext,
  type CreateSessionRequest,
  type Interaction,
  type SenderType,
} from "@agentmesh/shared";
import type { DB } from "../db/connection.js";
import { sessions, interactions, agents, owners } from "../db/schema.js";

function safeJsonParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; } catch { return fallback; }
}

function rowToSession(row: typeof sessions.$inferSelect): Session {
  return {
    id: row.id,
    title: row.title,
    creatorId: row.creatorId,
    creatorType: row.creatorType as "agent" | "owner",
    status: row.status as SessionStatus,
    participants: safeJsonParse<SessionParticipant[]>(row.participants, []),
    maxTurns: row.maxTurns,
    currentTurn: row.currentTurn,
    context: safeJsonParse<SessionContext | undefined>(row.context, undefined),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToInteraction(row: typeof interactions.$inferSelect): Interaction {
  const fromType = (row.fromType ?? "agent") as SenderType;
  const fromId = row.fromId ?? row.fromAgent ?? "";
  return {
    id: row.id,
    type: row.type as Interaction["type"],
    contentType: row.contentType as Interaction["contentType"],
    fromId,
    fromType,
    fromAgent: fromType === "agent" ? fromId : "",
    target: {
      agentId: row.toAgent ?? undefined,
      ownerId: row.toOwner ?? undefined,
      channel: row.channel ?? undefined,
      capability: row.capability ?? undefined,
      sessionId: row.sessionId ?? undefined,
    },
    payload: safeJsonParse(row.payload, {}),
    metadata: safeJsonParse(row.metadata, undefined),
    status: row.status as Interaction["status"],
    createdAt: row.createdAt,
  };
}

export class SessionService {
  constructor(private db: DB) {}

  async create(
    creatorId: string,
    creatorType: "agent" | "owner",
    request: CreateSessionRequest,
  ): Promise<Session> {
    const id = generateSessionId();
    const now = new Date().toISOString();

    const participants: SessionParticipant[] = [
      { id: creatorId, type: creatorType, role: "creator", joinedAt: now },
      ...request.participants.map((p) => ({
        id: p.id,
        type: p.type,
        role: "participant" as const,
        joinedAt: now,
      })),
    ];

    // Validate that each participant exists
    for (const p of request.participants) {
      if (p.type === "agent") {
        const agent = this.db.select({ agentId: agents.agentId }).from(agents).where(eq(agents.agentId, p.id)).get();
        if (!agent) throw new AppError(`Participant '${p.id}' not found`, 404);
      } else if (p.type === "owner") {
        const owner = this.db.select({ ownerId: owners.ownerId }).from(owners).where(eq(owners.ownerId, p.id)).get();
        if (!owner) throw new AppError(`Participant '${p.id}' not found`, 404);
      }
    }

    this.db
      .insert(sessions)
      .values({
        id,
        title: request.title,
        creatorId,
        creatorType,
        status: "active",
        participants: JSON.stringify(participants),
        maxTurns: request.maxTurns ?? 20,
        currentTurn: 0,
        context: request.context ? JSON.stringify(request.context) : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return this.findById(id) as Promise<Session>;
  }

  async findById(sessionId: string): Promise<Session | null> {
    const row = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();

    return row ? rowToSession(row) : null;
  }

  async updateStatus(sessionId: string, status: SessionStatus): Promise<Session> {
    const now = new Date().toISOString();
    this.db
      .update(sessions)
      .set({ status, updatedAt: now })
      .where(eq(sessions.id, sessionId))
      .run();

    const session = await this.findById(sessionId);
    if (!session) throw new AppError("Session not found", 404);
    return session;
  }

  async incrementTurn(sessionId: string): Promise<Session> {
    const now = new Date().toISOString();

    this.db
      .update(sessions)
      .set({
        currentTurn: sql`${sessions.currentTurn} + 1`,
        updatedAt: now,
      })
      .where(and(eq(sessions.id, sessionId), eq(sessions.status, "active")))
      .run();

    const session = await this.findById(sessionId);
    if (!session) throw new AppError("Session not found", 404);

    // Check if maxTurns reached
    if (session.currentTurn >= session.maxTurns) {
      await this.updateStatus(sessionId, "completed");
      return (await this.findById(sessionId))!;
    }

    return session;
  }

  async join(
    sessionId: string,
    participantId: string,
    participantType: "agent" | "owner",
  ): Promise<Session> {
    const session = await this.findById(sessionId);
    if (!session) throw new AppError("Session not found", 404);

    const already = session.participants.some((p) => p.id === participantId);
    if (already) return session;

    const now = new Date().toISOString();
    const updated: SessionParticipant[] = [
      ...session.participants,
      { id: participantId, type: participantType, role: "participant", joinedAt: now },
    ];

    this.db
      .update(sessions)
      .set({ participants: JSON.stringify(updated), updatedAt: now })
      .where(eq(sessions.id, sessionId))
      .run();

    return (await this.findById(sessionId))!;
  }

  async updateContext(sessionId: string, context: SessionContext): Promise<Session> {
    const now = new Date().toISOString();
    this.db
      .update(sessions)
      .set({ context: JSON.stringify(context), updatedAt: now })
      .where(eq(sessions.id, sessionId))
      .run();

    const session = await this.findById(sessionId);
    if (!session) throw new AppError("Session not found", 404);
    return session;
  }

  async getMessages(
    sessionId: string,
    opts?: { limit?: number; afterId?: string },
  ): Promise<Interaction[]> {
    const limit = opts?.limit ?? 50;
    const conditions = [eq(interactions.sessionId, sessionId)];

    if (opts?.afterId) {
      const cursor = this.db
        .select({ createdAt: interactions.createdAt })
        .from(interactions)
        .where(eq(interactions.id, opts.afterId))
        .get();
      if (cursor) {
        conditions.push(sql`${interactions.createdAt} > ${cursor.createdAt}`);
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

  async list(opts?: {
    status?: string;
    creatorId?: string;
  }): Promise<Session[]> {
    const conditions = [];
    if (opts?.status) conditions.push(eq(sessions.status, opts.status));
    if (opts?.creatorId) conditions.push(eq(sessions.creatorId, opts.creatorId));

    const rows =
      conditions.length > 0
        ? this.db
            .select()
            .from(sessions)
            .where(and(...conditions))
            .orderBy(desc(sessions.createdAt))
            .all()
        : this.db.select().from(sessions).orderBy(desc(sessions.createdAt)).all();

    return rows.map(rowToSession);
  }
}
