import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { generateOwnerId } from "@agentmesh/shared";
import type { DB } from "../db/connection.js";
import { owners } from "../db/schema.js";
import type { ApiKeyStore } from "../auth/api-key.js";

export class OwnerService implements ApiKeyStore {
  constructor(private db: DB) {}

  async create(name: string): Promise<{ ownerId: string; apiKey: string }> {
    const ownerId = generateOwnerId();
    const apiKey = `amk_${randomBytes(24).toString("hex")}`;

    this.db.insert(owners).values({ ownerId, name, apiKey }).run();

    return { ownerId, apiKey };
  }

  async findOwnerByApiKey(
    apiKey: string,
  ): Promise<{ ownerId: string } | null> {
    const result = this.db
      .select({ ownerId: owners.ownerId })
      .from(owners)
      .where(eq(owners.apiKey, apiKey))
      .get();

    return result ?? null;
  }

  async findById(ownerId: string): Promise<{ ownerId: string; name: string } | null> {
    const result = this.db
      .select({ ownerId: owners.ownerId, name: owners.name })
      .from(owners)
      .where(eq(owners.ownerId, ownerId))
      .get();

    return result ?? null;
  }
}
