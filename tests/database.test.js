const Database = require("better-sqlite3");
const { initDb } = require("../pipeline/database");

describe("database.js", () => {
  let db;

  beforeEach(() => {
    // 使用内存数据库，不写磁盘
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
  });

  afterEach(() => {
    db.close();
  });

  test("initDb 创建 inspections 表", () => {
    initDb(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = tables.map((t) => t.name);
    expect(names).toContain("inspections");
  });

  test("initDb 创建 token_usage 表", () => {
    initDb(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = tables.map((t) => t.name);
    expect(names).toContain("token_usage");
  });

  test("initDb 创建索引", () => {
    initDb(db);
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all();
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_inspections_timestamp");
    expect(names).toContain("idx_inspections_score");
    expect(names).toContain("idx_token_usage_timestamp");
  });

  test("initDb 可重复调用不报错", () => {
    initDb(db);
    expect(() => initDb(db)).not.toThrow();
  });

  test("inspections 表插入和查询", () => {
    initDb(db);
    db.prepare(`
      INSERT INTO inspections (timestamp, file_name, total_score, level, emotion, dimensions, violations, utterances, steps, quality, summary, call_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("2026-01-01T00:00:00Z", "test.wav", 85, "B", "平静", "{}", "[]", "[]", "[]", "{}", "{}", "{}");

    const row = db.prepare("SELECT * FROM inspections WHERE file_name = ?").get("test.wav");
    expect(row).toBeTruthy();
    expect(row.total_score).toBe(85);
    expect(row.level).toBe("B");
  });

  test("token_usage 表插入和查询", () => {
    initDb(db);
    db.prepare(`
      INSERT INTO token_usage (timestamp, file_name, duration, used_multimodal, actual_api_calls, actual_audio_calls, actual_tokens, legacy_api_calls, legacy_audio_calls, legacy_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("2026-01-01T00:00:00Z", "test.wav", 30.5, 1, 2, 1, '{"total":100}', 4, 3, '{"total":200}');

    const row = db.prepare("SELECT * FROM token_usage WHERE file_name = ?").get("test.wav");
    expect(row).toBeTruthy();
    expect(row.duration).toBe(30.5);
    expect(row.used_multimodal).toBe(1);
  });
});
