const fs = require("fs");
const path = require("path");
const { getDb, initDb } = require("./database");

// 初始化数据库
const db = getDb();
initDb(db);

// ─── 自动迁移：JSON → SQLite ───
migrateFromJson(db);

function migrateFromJson(db) {
  const dataDir = path.join(__dirname, "..", "data");
  const inspectionsJson = path.join(dataDir, "inspections.json");
  const tokenJson = path.join(dataDir, "token-usage.json");

  // 迁移 inspections
  if (fs.existsSync(inspectionsJson)) {
    try {
      const raw = fs.readFileSync(inspectionsJson, "utf-8").replace(/^\uFEFF/, "").trim();
      if (raw) {
        const items = JSON.parse(raw);
        if (Array.isArray(items) && items.length > 0) {
          // 检查 SQLite 是否已有数据
          const count = db.prepare("SELECT COUNT(*) as c FROM inspections").get().c;
          if (count === 0) {
            const insert = db.prepare(`
              INSERT INTO inspections (id, timestamp, file_name, total_time, total_score, level, emotion,
                used_multimodal, api_call_count, dimensions, violations, utterances, steps, quality, summary, call_summary)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const tx = db.transaction((rows) => {
              for (const r of rows) {
                insert.run(
                  r.id, r.timestamp, r.fileName || null, r.totalTime || null,
                  r.totalScore, r.level, r.emotion || "",
                  r.usedMultimodal ? 1 : 0, r.apiCallCount || 4,
                  JSON.stringify(r.dimensions || {}),
                  JSON.stringify(r.violations || []),
                  JSON.stringify(r.utterances || []),
                  JSON.stringify(r.steps || []),
                  JSON.stringify(r.quality || {}),
                  JSON.stringify(r.summary || {}),
                  JSON.stringify(r.callSummary || r.summary || {})
                );
              }
            });
            tx(items);
            console.log(`[DB] 迁移 ${items.length} 条质检记录 from JSON`);
            // 备份并重命名
            fs.renameSync(inspectionsJson, inspectionsJson + ".bak");
          }
        }
      }
    } catch (err) {
      console.error("[DB] 迁移 inspections 失败:", err.message);
    }
  }

  // 迁移 token_usage
  if (fs.existsSync(tokenJson)) {
    try {
      const raw = fs.readFileSync(tokenJson, "utf-8").replace(/^\uFEFF/, "").trim();
      if (raw) {
        const items = JSON.parse(raw);
        if (Array.isArray(items) && items.length > 0) {
          const count = db.prepare("SELECT COUNT(*) as c FROM token_usage").get().c;
          if (count === 0) {
            const insert = db.prepare(`
              INSERT INTO token_usage (timestamp, file_name, duration, used_multimodal,
                actual_api_calls, actual_audio_calls, actual_tokens,
                legacy_api_calls, legacy_audio_calls, legacy_tokens,
                saved_api_calls, saved_tokens, saved_percent)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const tx = db.transaction((rows) => {
              for (const r of rows) {
                insert.run(
                  r.timestamp, r.fileName || null, r.duration || 0, r.usedMultimodal ? 1 : 0,
                  r.actualApiCalls, r.actualAudioCalls,
                  JSON.stringify(r.actualTokens || {}),
                  r.legacyApiCalls, r.legacyAudioCalls,
                  JSON.stringify(r.legacyTokens || {}),
                  r.savedApiCalls, r.savedTokens, r.savedPercent
                );
              }
            });
            tx(items);
            console.log(`[DB] 迁移 ${items.length} 条 Token 记录 from JSON`);
            fs.renameSync(tokenJson, tokenJson + ".bak");
          }
        }
      }
    } catch (err) {
      console.error("[DB] 迁移 token_usage 失败:", err.message);
    }
  }
}

// ─── 预编译 SQL ───
const stmts = {
  insertInspection: db.prepare(`
    INSERT INTO inspections (timestamp, file_name, total_time, total_score, level, emotion,
      used_multimodal, api_call_count, session_id, dimensions, violations, utterances, steps, quality, summary, call_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  insertToken: db.prepare(`
    INSERT INTO token_usage (timestamp, file_name, duration, used_multimodal,
      actual_api_calls, actual_audio_calls, actual_tokens,
      legacy_api_calls, legacy_audio_calls, legacy_tokens,
      saved_api_calls, saved_tokens, saved_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  countInspections: db.prepare("SELECT COUNT(*) as c FROM inspections"),
  getInspections: db.prepare("SELECT * FROM inspections ORDER BY id DESC"),
  getInspectionsPage: db.prepare("SELECT * FROM inspections ORDER BY timestamp DESC LIMIT ? OFFSET ?"),
  getInspectionById: db.prepare("SELECT * FROM inspections WHERE id = ?"),
  avgScore: db.prepare("SELECT AVG(total_score) as avg FROM inspections"),
  levelDist: db.prepare("SELECT level, COUNT(*) as c FROM inspections GROUP BY level"),
  allInspections: db.prepare("SELECT * FROM inspections"),
  allTokenUsage: db.prepare("SELECT * FROM token_usage ORDER BY id DESC"),
  tokenCount: db.prepare("SELECT COUNT(*) as c FROM token_usage"),
};

// ─── 公共函数 ───

function nextInspectionId() {
  const row = stmts.countInspections.get();
  return row.c + 1;
}

function parseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    timestamp: row.timestamp,
    fileName: row.file_name,
    totalTime: row.total_time,
    totalScore: row.total_score,
    level: row.level,
    emotion: row.emotion,
    usedMultimodal: Boolean(row.used_multimodal),
    apiCallCount: row.api_call_count,
    sessionId: row.session_id,
    dimensions: tryParse(row.dimensions, {}),
    violations: tryParse(row.violations, []),
    utterances: tryParse(row.utterances, []),
    steps: tryParse(row.steps, []),
    quality: tryParse(row.quality, {}),
    summary: tryParse(row.summary, {}),
    callSummary: tryParse(row.call_summary, {}),
  };
}

function tryParse(json, fallback) {
  try { return JSON.parse(json); } catch { return fallback; }
}

function addInspection(result) {
  const timestamp = new Date().toISOString();
  const record = {
    timestamp,
    fileName: result.fileName,
    totalTime: result.totalTime,
    totalScore: result.quality.totalScore,
    level: result.quality.level,
    emotion: result.emotion?.overall || "",
    usedMultimodal: result.usedMultimodal || false,
    apiCallCount: result.apiCallCount || 4,
    sessionId: result.sessionId || null,
    dimensions: result.quality.dimensions,
    violations: result.quality.violations,
    utterances: result.utterances,
    steps: result.steps,
    quality: result.quality,
    summary: result.summary,
    callSummary: result.callSummary || result.summary,
  };

  const info = stmts.insertInspection.run(
    timestamp, record.fileName, record.totalTime, record.totalScore, record.level, record.emotion,
    record.usedMultimodal ? 1 : 0, record.apiCallCount, record.sessionId,
    JSON.stringify(record.dimensions),
    JSON.stringify(record.violations || []),
    JSON.stringify(record.utterances || []),
    JSON.stringify(record.steps || []),
    JSON.stringify(record.quality),
    JSON.stringify(record.summary),
    JSON.stringify(record.callSummary)
  );

  record.id = info.lastInsertRowid;

  // Token 用量记录
  addTokenRecord(result);

  return record;
}

function addTokenRecord(result) {
  const utteranceText = (result.utterances || []).map(u => u.text).join("");
  const textTokens = Math.ceil(utteranceText.length * 1.5);
  const summaryText = JSON.stringify(result.summary || {});
  const summaryTokens = Math.ceil(summaryText.length * 1.5);
  const totalTimeSec = parseFloat(result.totalTime) || 0;
  const audioTokens = Math.ceil(totalTimeSec * 8);
  const usedMultimodal = result.usedMultimodal || false;

  const actual = {
    audioInput: audioTokens * (usedMultimodal ? 1 : 3),
    textInput: textTokens + summaryTokens,
    total: audioTokens * (usedMultimodal ? 1 : 3) + textTokens + summaryTokens,
  };
  const legacy = {
    audioInput: audioTokens * 3,
    textInput: textTokens + summaryTokens,
    total: audioTokens * 3 + textTokens + summaryTokens,
  };
  const savedPercent = usedMultimodal ? Math.round((audioTokens * 2) / legacy.total * 100) : 0;

  stmts.insertToken.run(
    new Date().toISOString(), result.fileName, totalTimeSec, usedMultimodal ? 1 : 0,
    usedMultimodal ? 2 : 4, usedMultimodal ? 1 : 3, JSON.stringify(actual),
    4, 3, JSON.stringify(legacy),
    usedMultimodal ? 2 : 0, usedMultimodal ? audioTokens * 2 : 0, savedPercent
  );
}

function getTokenStats() {
  const total = stmts.tokenCount.get().c;
  if (total === 0) {
    return {
      total: 0, multimodalCount: 0, legacyCount: 0,
      totalSavedCalls: 0, totalSavedTokens: 0, avgSavedPercent: 0,
      records: [],
      summary: { actualTotalTokens: 0, legacyTotalTokens: 0, actualTotalCalls: 0, legacyTotalCalls: 0 },
    };
  }

  const rows = stmts.allTokenUsage.all();
  let multiCount = 0, savedCalls = 0, savedTokens = 0, savedPctSum = 0;
  let actTotal = 0, legTotal = 0, actCalls = 0, legCalls = 0;

  for (const r of rows) {
    const act = tryParse(r.actual_tokens, {});
    const leg = tryParse(r.legacy_tokens, {});
    actTotal += act.total || 0;
    legTotal += leg.total || 0;
    actCalls += r.actual_api_calls || 0;
    legCalls += r.legacy_api_calls || 0;
    if (r.used_multimodal) multiCount++;
    savedCalls += r.saved_api_calls || 0;
    savedTokens += r.saved_tokens || 0;
    savedPctSum += r.saved_percent || 0;
  }

  const records = rows.slice(0, 50).map(r => ({
    timestamp: r.timestamp,
    fileName: r.file_name,
    duration: r.duration,
    usedMultimodal: Boolean(r.used_multimodal),
    actualApiCalls: r.actual_api_calls,
    actualTokens: tryParse(r.actual_tokens, {}),
    legacyTokens: tryParse(r.legacy_tokens, {}),
    savedApiCalls: r.saved_api_calls,
    savedTokens: r.saved_tokens,
    savedPercent: r.saved_percent,
  }));

  return {
    total,
    multimodalCount: multiCount,
    legacyCount: total - multiCount,
    totalSavedCalls: savedCalls,
    totalSavedTokens: savedTokens,
    avgSavedPercent: total > 0 ? Math.round(savedPctSum / total) : 0,
    summary: { actualTotalTokens: actTotal, legacyTotalTokens: legTotal, actualTotalCalls: actCalls, legacyTotalCalls: legCalls },
    records,
  };
}

function getStats() {
  const total = stmts.countInspections.get().c;
  if (total === 0) {
    return {
      total: 0, avgScore: 0,
      levelDistribution: { A: 0, B: 0, C: 0, D: 0, E: 0 },
      avgDimensions: { compliance: 0, knowledge: 0, process: 0, communication: 0 },
      recentInspections: [], emotionDistribution: {},
      violationsTotal: 0, violationsByType: {},
    };
  }

  const avgScore = Math.round(stmts.avgScore.get().avg || 0);
  const levelRows = stmts.levelDist.all();
  const levelDistribution = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  levelRows.forEach(r => { levelDistribution[r.level] = r.c; });

  const allRows = stmts.allInspections.all();
  const dimKeys = ["compliance", "knowledge", "process", "communication"];
  const avgDimensions = {};
  dimKeys.forEach(k => {
    let sum = 0;
    allRows.forEach(r => {
      const dims = tryParse(r.dimensions, {});
      sum += dims[k]?.score || 0;
    });
    avgDimensions[k] = Math.round(sum / total * 10) / 10;
  });

  const emotionDistribution = {};
  let violationsTotal = 0;
  const violationsByType = {};

  allRows.forEach(r => {
    if (r.emotion) emotionDistribution[r.emotion] = (emotionDistribution[r.emotion] || 0) + 1;
    const vList = tryParse(r.violations, []);
    violationsTotal += vList.length;
    vList.forEach(v => { violationsByType[v.type] = (violationsByType[v.type] || 0) + 1; });
  });

  const recentInspections = allRows.slice(0, 10).map(r => ({
    id: r.id, timestamp: r.timestamp, fileName: r.file_name,
    totalScore: r.total_score, level: r.level, emotion: r.emotion,
    violationsCount: (tryParse(r.violations, [])).length,
  }));

  return { total, avgScore, levelDistribution, avgDimensions, recentInspections, emotionDistribution, violationsTotal, violationsByType };
}

function getHistory(page = 1, pageSize = 20) {
  const total = stmts.countInspections.get().c;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;
  const rows = stmts.getInspectionsPage.all(pageSize, offset);

  const items = rows.map(r => ({
    id: r.id, timestamp: r.timestamp, fileName: r.file_name, totalTime: r.total_time,
    totalScore: r.total_score, level: r.level,
    dimensions: tryParse(r.dimensions, {}),
    violations: tryParse(r.violations, []),
    violationsCount: (tryParse(r.violations, [])).length,
    emotion: r.emotion,
    utterances: tryParse(r.utterances, []),
    quality: tryParse(r.quality, {}),
    summary: tryParse(r.summary, {}),
    callSummary: tryParse(r.call_summary, {}),
  }));

  return { items, total, page, pageSize, totalPages };
}

module.exports = { addInspection, getStats, getHistory, getTokenStats };
