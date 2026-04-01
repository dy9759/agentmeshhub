import { eq } from "drizzle-orm";
import type { Channel, ChannelMember } from "@agentmesh/shared";
import { AppError } from "@agentmesh/shared";
import type { DB } from "../db/connection.js";
import { channels, channelMembers } from "../db/schema.js";

export class ChannelService {
  constructor(private db: DB) {}

  async create(
    name: string,
    createdBy: string,
    description?: string,
  ): Promise<Channel> {
    const existing = this.db
      .select()
      .from(channels)
      .where(eq(channels.name, name))
      .get();

    if (existing) {
      throw AppError.conflict(`Channel '${name}' already exists`);
    }

    const now = new Date().toISOString();
    this.db
      .insert(channels)
      .values({ name, description: description ?? null, createdBy, createdAt: now })
      .run();

    // Auto-join creator
    this.db
      .insert(channelMembers)
      .values({ channel: name, agentId: createdBy, joinedAt: now })
      .run();

    return { name, description, createdBy, createdAt: now };
  }

  async list(): Promise<Channel[]> {
    return this.db.select().from(channels).all().map((r) => ({
      name: r.name,
      description: r.description ?? undefined,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    }));
  }

  async join(channelName: string, agentId: string): Promise<void> {
    const channel = this.db
      .select()
      .from(channels)
      .where(eq(channels.name, channelName))
      .get();

    if (!channel) {
      throw AppError.notFound(`Channel '${channelName}' not found`);
    }

    // Idempotent join
    const existing = this.db
      .select()
      .from(channelMembers)
      .where(
        eq(channelMembers.channel, channelName),
      )
      .all()
      .find((m) => m.agentId === agentId);

    if (!existing) {
      this.db
        .insert(channelMembers)
        .values({
          channel: channelName,
          agentId,
          joinedAt: new Date().toISOString(),
        })
        .run();
    }
  }

  async leave(channelName: string, agentId: string): Promise<void> {
    this.db.delete(channelMembers).where(
      eq(channelMembers.channel, channelName),
    ).run();
  }

  async getMembers(channelName: string): Promise<ChannelMember[]> {
    return this.db
      .select()
      .from(channelMembers)
      .where(eq(channelMembers.channel, channelName))
      .all()
      .map((r) => ({
        channel: r.channel,
        agentId: r.agentId,
        joinedAt: r.joinedAt,
      }));
  }
}
