import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

declare global {
  // eslint-disable-next-line no-var
  var __agentSqlite: Database.Database | undefined;
}

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'agent.db');

/**
 * Initializes and returns the HMR-safe SQLite database singleton.
 * Configures WAL mode, synchronous=NORMAL, and creates all tables, indexes,
 * and FTS5 synchronization triggers.
 */
export function getDatabase(customPath?: string): Database.Database {
  const dbPath = customPath || process.env.SQLITE_DB_PATH || DEFAULT_DB_PATH;

  if (globalThis.__agentSqlite && (!customPath || globalThis.__agentSqlite.name === dbPath)) {
    return globalThis.__agentSqlite;
  }

  // Ensure data directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Performance and integrity pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');

  // Schema initialization in an atomic transaction
  initSchema(db);

  if (!customPath) {
    globalThis.__agentSqlite = db;
  }

  return db;
}

/**
 * Atomic schema creation: raw messages, FTS5 virtual table + triggers,
 * session facts, and turn traces.
 */
function initSchema(db: Database.Database): void {
  db.exec(`
    -- Raw chat messages
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      embedding BLOB
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at_utc ON messages(created_at_utc);

    -- FTS5 full-text search virtual table over messages
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      message_id UNINDEXED,
      created_at_utc UNINDEXED,
      tokenize='porter unicode61'
    );

    -- Trigger: keep messages_fts updated on insert
    CREATE TRIGGER IF NOT EXISTS trg_messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(content, message_id, created_at_utc)
      VALUES (new.content, new.id, new.created_at_utc);
    END;

    -- Trigger: keep messages_fts updated on delete
    CREATE TRIGGER IF NOT EXISTS trg_messages_ad AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE message_id = old.id;
    END;

    -- Trigger: keep messages_fts updated on update
    CREATE TRIGGER IF NOT EXISTS trg_messages_au AFTER UPDATE ON messages BEGIN
      DELETE FROM messages_fts WHERE message_id = old.id;
      INSERT INTO messages_fts(content, message_id, created_at_utc)
      VALUES (new.content, new.id, new.created_at_utc);
    END;

    -- Distilled atomic session facts
    CREATE TABLE IF NOT EXISTS session_facts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      fact_text TEXT NOT NULL,
      entities_json TEXT NOT NULL,
      reference_date_utc TEXT NOT NULL,
      embedding BLOB
    );

    CREATE INDEX IF NOT EXISTS idx_session_facts_session_id ON session_facts(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_facts_ref_date ON session_facts(reference_date_utc);

    -- Turn traces for observability and X-Ray drawer
    CREATE TABLE IF NOT EXISTS turn_traces (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_prompt TEXT NOT NULL,
      trace_json TEXT NOT NULL,
      created_at_utc TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_turn_traces_session_id ON turn_traces(session_id);
    CREATE INDEX IF NOT EXISTS idx_turn_traces_created_at ON turn_traces(created_at_utc);
  `);
}

/**
 * Closes the singleton database connection gracefully (used for test teardown / reset).
 */
export function closeDatabase(): void {
  if (globalThis.__agentSqlite) {
    try {
      globalThis.__agentSqlite.close();
    } catch {
      // Ignore if already closed
    }
    globalThis.__agentSqlite = undefined;
  }
}

/**
 * Resets the database by dropping and recreating all tables (used for --force seeding).
 */
export function resetDatabase(customPath?: string): Database.Database {
  const db = getDatabase(customPath);
  db.exec(`
    DROP TRIGGER IF EXISTS trg_messages_ai;
    DROP TRIGGER IF EXISTS trg_messages_ad;
    DROP TRIGGER IF EXISTS trg_messages_au;
    DROP TABLE IF EXISTS messages_fts;
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS session_facts;
    DROP TABLE IF EXISTS turn_traces;
  `);
  initSchema(db);
  return db;
}

