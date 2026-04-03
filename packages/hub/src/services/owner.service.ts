import { eq } from "drizzle-orm";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { generateOwnerId } from "@agentmesh/shared";
import type { DB } from "../db/connection.js";
import { owners } from "../db/schema.js";
import type { ApiKeyStore } from "../auth/api-key.js";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const attempt = createHash("sha256").update(salt + password).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(attempt, "hex"));
  } catch {
    return false;
  }
}

export class OwnerService implements ApiKeyStore {
  constructor(private db: DB) {}

  async create(name: string, username?: string, password?: string): Promise<{ ownerId: string; apiKey: string }> {
    const ownerId = generateOwnerId();
    const apiKey = `amk_${randomBytes(24).toString("hex")}`;
    // Default password: 123456 if not provided
    const passwordHash = hashPassword(password ?? "123456");

    // Default username: use name (lowercase, no spaces) if not provided
    const finalUsername = username ?? name.toLowerCase().replace(/\s+/g, "-");

    this.db.insert(owners).values({
      ownerId,
      name,
      username: finalUsername,
      passwordHash,
      apiKey,
    }).run();

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

  async rotateApiKey(ownerId: string): Promise<{ ownerId: string; apiKey: string }> {
    const newKey = `amk_${randomBytes(24).toString("hex")}`;
    this.db.update(owners).set({ apiKey: newKey }).where(eq(owners.ownerId, ownerId)).run();
    return { ownerId, apiKey: newKey };
  }

  async login(username: string, password: string): Promise<{ ownerId: string; apiKey: string; name: string } | null> {
    // Try by username first
    let row = this.db
      .select({ ownerId: owners.ownerId, name: owners.name, passwordHash: owners.passwordHash, apiKey: owners.apiKey })
      .from(owners)
      .where(eq(owners.username, username))
      .get();

    // Fallback: try by name (for owners created before username was added)
    if (!row) {
      row = this.db
        .select({ ownerId: owners.ownerId, name: owners.name, passwordHash: owners.passwordHash, apiKey: owners.apiKey })
        .from(owners)
        .where(eq(owners.name, username))
        .get();
    }

    if (!row) return null;

    // If no password hash set (legacy owner), accept default password "123456"
    if (!row.passwordHash) {
      if (password === "123456") {
        // Auto-set the default password hash for future logins
        const hash = hashPassword("123456");
        this.db.update(owners).set({
          passwordHash: hash,
          username: username,
        }).where(eq(owners.ownerId, row.ownerId)).run();
        return { ownerId: row.ownerId, apiKey: row.apiKey, name: row.name };
      }
      return null;
    }

    if (!verifyPassword(password, row.passwordHash)) return null;
    return { ownerId: row.ownerId, apiKey: row.apiKey, name: row.name };
  }

  async setPassword(ownerId: string, username: string, password: string): Promise<void> {
    const hash = hashPassword(password);
    this.db.update(owners).set({ username, passwordHash: hash }).where(eq(owners.ownerId, ownerId)).run();
  }

  async changePassword(ownerId: string, oldPassword: string, newPassword: string): Promise<boolean> {
    const row = this.db
      .select({ passwordHash: owners.passwordHash })
      .from(owners)
      .where(eq(owners.ownerId, ownerId))
      .get();

    if (!row?.passwordHash) return false;
    if (!verifyPassword(oldPassword, row.passwordHash)) return false;

    const newHash = hashPassword(newPassword);
    this.db.update(owners).set({ passwordHash: newHash }).where(eq(owners.ownerId, ownerId)).run();
    return true;
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
