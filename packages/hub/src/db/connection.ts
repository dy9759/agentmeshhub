import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";

export type DB = ReturnType<typeof createDatabase>;

export function createDatabase(url?: string) {
  const dbPath = url || process.env.DATABASE_URL || ":memory:";

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  return db;
}

export function initializeDatabase(db: DB): void {
  // Create all tables
  db.run(sql`
    CREATE TABLE IF NOT EXISTS owners (
      owner_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      username TEXT UNIQUE,
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES owners(owner_id),
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      used_at TEXT,
      used_by TEXT
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES owners(owner_id),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      version TEXT,
      machine_id TEXT,
      status TEXT NOT NULL DEFAULT 'online',
      load REAL NOT NULL DEFAULT 0,
      current_task_id TEXT,
      current_task_type TEXT,
      capabilities TEXT NOT NULL DEFAULT '[]',
      available_capacity INTEGER NOT NULL DEFAULT 5,
      token_hash TEXT,
      token_expires_at TEXT,
      registered_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_heartbeat TEXT NOT NULL DEFAULT (datetime('now')),
      auto_reply_config TEXT,
      display_name TEXT,
      avatar TEXT,
      bio TEXT,
      tags TEXT,
      agent_metadata TEXT,
      UNIQUE(name, machine_id, owner_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      from_id TEXT NOT NULL,
      from_type TEXT NOT NULL DEFAULT 'agent',
      from_agent TEXT,
      to_agent TEXT,
      to_owner TEXT,
      channel TEXT,
      capability TEXT,
      session_id TEXT,
      content_type TEXT NOT NULL DEFAULT 'text',
      schema TEXT,
      payload TEXT NOT NULL,
      metadata TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS channels (
      name TEXT PRIMARY KEY,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS channel_members (
      channel TEXT NOT NULL REFERENCES channels(name),
      agent_id TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (channel, agent_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      required_capabilities TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES agents(agent_id),
      assigned_to TEXT,
      candidates TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      payload TEXT NOT NULL,
      result TEXT,
      timeout_ms INTEGER NOT NULL DEFAULT 30000,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      from_agent TEXT NOT NULL REFERENCES agents(agent_id),
      owner_id TEXT NOT NULL REFERENCES owners(owner_id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      creator_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      participants TEXT NOT NULL,
      max_turns INTEGER NOT NULL DEFAULT 20,
      current_turn INTEGER NOT NULL DEFAULT 0,
      context TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      leader_id TEXT NOT NULL,
      leader_type TEXT NOT NULL,
      members TEXT NOT NULL DEFAULT '[]',
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS remote_sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      title TEXT,
      environment TEXT,
      events TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Schema migrations — add columns to existing tables
  const migrations = [
    "ALTER TABLE agents ADD COLUMN auto_reply_config TEXT",
    "ALTER TABLE interactions ADD COLUMN session_id TEXT",
    "ALTER TABLE interactions ADD COLUMN to_owner TEXT",
    "ALTER TABLE interactions ADD COLUMN from_id TEXT",
    "ALTER TABLE interactions ADD COLUMN from_type TEXT DEFAULT 'agent'",
    "ALTER TABLE agents ADD COLUMN display_name TEXT",
    "ALTER TABLE agents ADD COLUMN avatar TEXT",
    "ALTER TABLE agents ADD COLUMN bio TEXT",
    "ALTER TABLE agents ADD COLUMN tags TEXT",
    "ALTER TABLE agents ADD COLUMN agent_metadata TEXT",
    "ALTER TABLE owners ADD COLUMN username TEXT UNIQUE",
    "ALTER TABLE owners ADD COLUMN password_hash TEXT",
  ];
  for (const migration of migrations) {
    try { db.run(sql.raw(migration)); } catch { /* column already exists */ }
  }

  // Indexes for common queries
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_remote_sessions_agent ON remote_sessions(agent_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_teams_leader ON teams(leader_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_interactions_to ON interactions(to_agent, status)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_interactions_to_owner ON interactions(to_owner, status)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_interactions_from ON interactions(from_id, from_type)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_interactions_channel ON interactions(channel)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_files_expires ON files(expires_at)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_interactions_session ON interactions(session_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
}
