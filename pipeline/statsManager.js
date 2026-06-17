const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDir, "inspections.json");
let inspections = loadInspections();

function loadInspections() {
  try {
    if (!fs.existsSync(dataFile)) return [];
    let raw = fs.readFileSync(dataFile, "utf-8");
    raw = raw.replace(/^\uFEFF/, "").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("读取质检统计失败:", err);
    return [];
  }
}

function saveInspections() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(inspections, null, 2), "utf-8");
  } catch (err) {
    console.error("保存质检统计失败:", err);
  }
}

function nextInspectionId() {
  return inspections.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
}

function addInspection(result) {
  const record = {
    id: nextInspectionId(),
    timestamp: new Date().toISOString(),
    fileName: result.fileName,
    totalTime: result.totalTime,
    totalScore: result.quality.totalScore,
    level: result.quality.level,
    dimensions: {
      compliance: {
        score: result.quality.dimensions.compliance.score,
        reason: result.quality.dimensions.compliance.reason,
      },
      knowledge: {
        score: result.quality.dimensions.knowledge.score,
        reason: result.quality.dimensions.knowledge.reason,
      },
      process: {
        score: result.quality.dimensions.process.score,
        reason: result.quality.dimensions.process.reason,
      },
      communication: {
        score: result.quality.dimensions.communication.score,
        reason: result.quality.dimensions.communication.reason,
      },
    },
    violations: result.quality.violations,
    emotion: result.emotion?.overall || "",
    utterances: result.utterances,
    steps: result.steps,
    quality: result.quality,
    summary: result.summary,
    callSummary: result.callSummary || result.summary,
  };
  inspections.push(record);
  saveInspections();
  return record;
}

function getStats() {
  const total = inspections.length;
  if (total === 0) {
    return {
      total: 0,
      avgScore: 0,
      levelDistribution: { A: 0, B: 0, C: 0, D: 0, E: 0 },
      avgDimensions: { compliance: 0, knowledge: 0, process: 0, communication: 0 },
      recentInspections: [],
      emotionDistribution: {},
      violationsTotal: 0,
      violationsByType: {},
    };
  }

  const avgScore = Math.round(inspections.reduce((s, r) => s + r.totalScore, 0) / total);

  const levelDistribution = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  inspections.forEach((r) => { levelDistribution[r.level] = (levelDistribution[r.level] || 0) + 1; });

  const dimKeys = ["compliance", "knowledge", "process", "communication"];
  const avgDimensions = {};
  dimKeys.forEach((k) => {
    avgDimensions[k] = Math.round(inspections.reduce((s, r) => s + (r.dimensions[k] || 0), 0) / total * 10) / 10;
  });

  const emotionDistribution = {};
  inspections.forEach((r) => {
    if (r.emotion) {
      emotionDistribution[r.emotion] = (emotionDistribution[r.emotion] || 0) + 1;
    }
  });

  let violationsTotal = 0;
  const violationsByType = {};
  inspections.forEach((r) => {
    if (r.violations) {
      violationsTotal += r.violations.length;
      r.violations.forEach((v) => {
        violationsByType[v.type] = (violationsByType[v.type] || 0) + 1;
      });
    }
  });

  const recentInspections = inspections.slice(-10).reverse().map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    fileName: r.fileName,
    totalScore: r.totalScore,
    level: r.level,
    emotion: r.emotion,
    violationsCount: r.violations ? r.violations.length : 0,
  }));

  return {
    total,
    avgScore,
    levelDistribution,
    avgDimensions,
    recentInspections,
    emotionDistribution,
    violationsTotal,
    violationsByType,
  };
}

function getHistory(page = 1, pageSize = 20) {
  const total = inspections.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const ordered = inspections
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const items = ordered.slice(start, start + pageSize).map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    fileName: r.fileName,
    totalTime: r.totalTime,
    totalScore: r.totalScore,
    level: r.level,
    dimensions: r.dimensions,
    violations: r.violations || [],
    violationsCount: r.violations ? r.violations.length : 0,
    emotion: r.emotion,
    utterances: r.utterances || [],
    quality: r.quality,
    summary: r.summary,
    callSummary: r.callSummary || r.summary,
  }));

  return { items, total, page, pageSize, totalPages };
}

module.exports = { addInspection, getStats, getHistory };
