import { eq, desc } from "drizzle-orm";
import { generateRemoteSessionId, AppError } from "@agentmesh/shared";
import type { DB } from "../db/connection.js";
import { remoteSessions } from "../db/schema.js";

function safeJsonParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; } catch { return fallback; }
}

export interface RemoteSession {
  id: string;
  agentId: string;
  ownerId: string;
  status: string;
  title?: string;
  environment?: Record<string, unknown>;
  events: Array<{ type: string; data?: unknown; timestamp: string }>;
  createdAt: string;
  updatedAt: string;
}

function rowToRemoteSession(row: typeof remoteSessions.$inferSelect): RemoteSession {
  return {
    id: row.id,
    agentId: row.agentId,
    ownerId: row.ownerId,
    status: row.status,
    title: row.title ?? undefined,
    environment: safeJsonParse(row.environment, undefined),
    events: safeJsonParse(row.events, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class RemoteSessionService {
  constructor(private db: DB) {}

  async create(agentId: string, ownerId: string, title?: string, environment?: Record<string, unknown>): Promise<RemoteSession> {
    const id = generateRemoteSessionId();
    const now = new Date().toISOString();
    this.db.insert(remoteSessions).values({
      id, agentId, ownerId, status: "created",
      title: title ?? null,
      environment: environment ? JSON.stringify(environment) : null,
      events: JSON.stringify([{ type: "created", timestamp: now }]),
      createdAt: now, updatedAt: now,
    }).run();
    return this.findById(id) as Promise<RemoteSession>;
  }

  async findById(id: string): Promise<RemoteSession | null> {
    const row = this.db.select().from(remoteSessions).where(eq(remoteSessions.id, id)).get();
    return row ? rowToRemoteSession(row) : null;
  }

  async updateStatus(id: string, status: string): Promise<RemoteSession> {
    const session = await this.findById(id);
    if (!session) throw new AppError("Remote session not found", 404);
    const now = new Date().toISOString();
    const events = [...session.events, { type: `status_${status}`, timestamp: now }];
    this.db.update(remoteSessions).set({
      status, events: JSON.stringify(events), updatedAt: now,
    }).where(eq(remoteSessions.id, id)).run();
    return this.findById(id) as Promise<RemoteSession>;
  }

  async addEvent(id: string, type: string, data?: unknown): Promise<RemoteSession> {
    const session = await this.findById(id);
    if (!session) throw new AppError("Remote session not found", 404);
    const now = new Date().toISOString();
    const events = [...session.events, { type, data, timestamp: now }];
    this.db.update(remoteSessions).set({
      events: JSON.stringify(events), updatedAt: now,
    }).where(eq(remoteSessions.id, id)).run();
    return this.findById(id) as Promise<RemoteSession>;
  }

  async listByAgent(agentId: string): Promise<RemoteSession[]> {
    const rows = this.db.select().from(remoteSessions)
      .where(eq(remoteSessions.agentId, agentId))
      .orderBy(desc(remoteSessions.updatedAt)).all();
    return rows.map(rowToRemoteSession);
  }

  async listByOwner(ownerId: string): Promise<RemoteSession[]> {
    const rows = this.db.select().from(remoteSessions)
      .where(eq(remoteSessions.ownerId, ownerId))
      .orderBy(desc(remoteSessions.updatedAt)).all();
    return rows.map(rowToRemoteSession);
  }
}
