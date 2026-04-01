import { eq, lt } from "drizzle-orm";
import { generateFileId } from "@agentmesh/shared";
import type { DB } from "../db/connection.js";
import { files } from "../db/schema.js";
import { mkdirSync, writeFileSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface FileRecord {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  storagePath: string;
  fromAgent: string;
  ownerId: string;
  createdAt: string;
  expiresAt: string;
}

export class FileService {
  private uploadsDir: string;

  constructor(
    private db: DB,
    uploadsDir: string,
  ) {
    this.uploadsDir = uploadsDir;
    mkdirSync(this.uploadsDir, { recursive: true });
  }

  async upload(
    fromAgent: string,
    ownerId: string,
    fileName: string,
    contentType: string,
    buffer: Buffer,
  ): Promise<FileRecord> {
    const id = generateFileId();
    const dir = join(this.uploadsDir, ownerId, id);
    mkdirSync(dir, { recursive: true });

    const storagePath = join(dir, fileName);
    writeFileSync(storagePath, buffer);

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();

    this.db.insert(files).values({
      id,
      fileName,
      contentType,
      size: buffer.length,
      storagePath,
      fromAgent,
      ownerId,
      createdAt: now,
      expiresAt,
    }).run();

    return { id, fileName, contentType, size: buffer.length, storagePath, fromAgent, ownerId, createdAt: now, expiresAt };
  }

  async getMetadata(fileId: string): Promise<FileRecord | null> {
    const rows = this.db.select().from(files).where(eq(files.id, fileId)).all();
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      fileName: row.fileName,
      contentType: row.contentType,
      size: row.size,
      storagePath: row.storagePath,
      fromAgent: row.fromAgent,
      ownerId: row.ownerId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  async download(fileId: string): Promise<{ filePath: string; fileName: string; contentType: string } | null> {
    const meta = await this.getMetadata(fileId);
    if (!meta) return null;
    if (!existsSync(meta.storagePath)) return null;
    return { filePath: meta.storagePath, fileName: meta.fileName, contentType: meta.contentType };
  }

  async deleteExpired(): Promise<number> {
    const now = new Date().toISOString();
    const expired = this.db.select().from(files).where(lt(files.expiresAt, now)).all();

    for (const row of expired) {
      try {
        const dir = dirname(row.storagePath);
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }

    if (expired.length > 0) {
      this.db.delete(files).where(lt(files.expiresAt, now)).run();
    }

    return expired.length;
  }
}
