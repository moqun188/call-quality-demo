const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "quality.db");

function getDb() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

/**
 * 初始化数据库表结构
 */
function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      file_name TEXT,
      total_time TEXT,
      total_score INTEGER,
      level TEXT,
      emotion TEXT,
      used_multimodal INTEGER DEFAULT 0,
      api_call_count INTEGER DEFAULT 4,
      session_id TEXT,
      -- 复杂字段存 JSON
      dimensions TEXT,
      violations TEXT,
      utterances TEXT,
      steps TEXT,
      quality TEXT,
      summary TEXT,
      call_summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      file_name TEXT,
      duration REAL,
      used_multimodal INTEGER DEFAULT 0,
      actual_api_calls INTEGER,
      actual_audio_calls INTEGER,
      actual_tokens TEXT,
      legacy_api_calls INTEGER,
      legacy_audio_calls INTEGER,
      legacy_tokens TEXT,
      saved_api_calls INTEGER DEFAULT 0,
      saved_tokens INTEGER DEFAULT 0,
      saved_percent INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_inspections_timestamp ON inspections(timestamp);
    CREATE INDEX IF NOT EXISTS idx_inspections_score ON inspections(total_score);
    CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp);
  `);
}

module.exports = { getDb, initDb, dbPath };
