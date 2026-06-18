/**
 * 自我进化引擎
 * 基于历史质检数据，自动分析趋势、发现规则盲区、生成优化建议
 */

const { getDb } = require("./database");
const { loadRules, listRules } = require("./rulesLoader");

function tryParse(json, fallback) {
  try { return JSON.parse(json); } catch { return fallback; }
}

/**
 * 分析质检趋势
 */
function analyzeTrends(db) {
  const rows = db.prepare("SELECT * FROM inspections ORDER BY id ASC").all();
  if (rows.length < 2) {
    return { hasEnoughData: false, message: "数据不足，至少需要 2 条质检记录" };
  }

  const scores = rows.map(r => r.total_score);
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const recent5 = scores.slice(-5);
  const recentAvg = Math.round(recent5.reduce((a, b) => a + b, 0) / recent5.length);

  // 趋势判断
  const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
  const secondHalf = scores.slice(Math.floor(scores.length / 2));
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const trendDiff = secondAvg - firstAvg;

  let trend;
  if (trendDiff > 5) trend = { direction: "上升", icon: "📈", desc: `后半段比前半段平均高 ${Math.round(trendDiff)} 分` };
  else if (trendDiff < -5) trend = { direction: "下降", icon: "📉", desc: `后半段比前半段平均低 ${Math.round(Math.abs(trendDiff))} 分` };
  else trend = { direction: "平稳", icon: "➡️", desc: "整体评分保持稳定" };

  // 等级分布
  const levelDist = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  rows.forEach(r => { levelDist[r.level] = (levelDist[r.level] || 0) + 1; });

  // 维度分析
  const dimStats = { compliance: [], knowledge: [], process: [], communication: [] };
  rows.forEach(r => {
    const dims = tryParse(r.dimensions, {});
    for (const k of Object.keys(dimStats)) {
      if (dims[k]?.score !== undefined) dimStats[k].push(dims[k].score);
    }
  });
  const dimAvg = {};
  for (const [k, arr] of Object.entries(dimStats)) {
    dimAvg[k] = arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : 0;
  }
  const weakestDim = Object.entries(dimAvg).sort((a, b) => a[1] - b[1])[0];

  return {
    hasEnoughData: true,
    totalRecords: rows.length,
    avgScore,
    recentAvg,
    trend,
    levelDistribution: levelDist,
    dimensionAverages: dimAvg,
    weakestDimension: weakestDim ? { name: weakestDim[0], score: weakestDim[1] } : null,
  };
}

/**
 * 发现规则盲区 — 高频违规词未被规则覆盖
 */
function discoverRuleBlindSpots(db) {
  const rows = db.prepare("SELECT utterances, violations FROM inspections").all();
  const rules = loadRules("default");
  const prohibited = new Set(rules.standards.prohibited);

  // 统计所有客服话术中的高频词
  const wordFreq = {};
  const violationTypes = {};

  rows.forEach(r => {
    const utterances = tryParse(r.utterances, []);
    const violations = tryParse(r.violations, []);

    // 统计违规类型
    violations.forEach(v => {
      violationTypes[v.type] = (violationTypes[v.type] || 0) + 1;
    });

    // 统计客服话术中的否定词/消极词
    const agentTexts = utterances.filter(u => u.role === "agent").map(u => u.text).join("");
    const negativeWords = ["不行", "不能", "做不到", "没法", "不允许", "不可能", "别", "不用", "不许"];
    negativeWords.forEach(w => {
      if (agentTexts.includes(w) && !prohibited.has(w)) {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
      }
    });
  });

  // 高频但未被规则覆盖的词
  const blindSpots = Object.entries(wordFreq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([word, count]) => ({
      word,
      count,
      suggestion: `建议将 "${word}" 加入禁语列表`,
    }));

  return {
    blindSpots,
    violationTypeDistribution: violationTypes,
    totalRecords: rows.length,
  };
}

/**
 * 评估规则有效性 — 哪些规则经常触发，哪些从未触发
 */
function evaluateRuleEffectiveness(db) {
  const rows = db.prepare("SELECT violations FROM inspections").all();
  const rules = loadRules("default");

  const violationCounts = {};
  rows.forEach(r => {
    const violations = tryParse(r.violations, []);
    violations.forEach(v => {
      const key = v.type === "prohibited_word" ? v.detail : v.type;
      violationCounts[key] = (violationCounts[key] || 0) + 1;
    });
  });

  // 检查禁语命中率
  const prohibitedHits = {};
  rules.standards.prohibited.forEach(word => {
    prohibitedHits[word] = 0;
  });
  rows.forEach(r => {
    const violations = tryParse(r.violations, []);
    violations.forEach(v => {
      if (v.type === "prohibited_word") {
        const match = v.detail.match(/"(.+?)"/);
        if (match && prohibitedHits[match[1]] !== undefined) {
          prohibitedHits[match[1]]++;
        }
      }
    });
  });

  const neverTriggered = Object.entries(prohibitedHits).filter(([, c]) => c === 0).map(([w]) => w);
  const hotRules = Object.entries(prohibitedHits).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);

  return {
    violationCounts,
    prohibitedWordHits: prohibitedHits,
    neverTriggeredRules: neverTriggered,
    hotRules: hotRules.map(([word, count]) => ({ word, count })),
    suggestion: neverTriggered.length > 0
      ? `以下禁语从未触发，可考虑移除或调整: ${neverTriggered.join(", ")}`
      : "所有禁语规则均有命中，规则设置合理",
  };
}

/**
 * 生成进化建议
 */
function generateEvolutionInsights(db) {
  const trends = analyzeTrends(db);
  const blindSpots = discoverRuleBlindSpots(db);
  const effectiveness = evaluateRuleEffectiveness(db);

  const insights = [];

  // 趋势洞察
  if (trends.hasEnoughData) {
    if (trends.trend.direction === "下降") {
      insights.push({
        priority: "high",
        category: "趋势预警",
        message: `质检评分呈下降趋势。${trends.trend.desc}`,
        action: "建议检查近期质检规则是否过于严格，或客服团队需要培训",
      });
    }

    if (trends.weakestDimension && trends.weakestDimension.score < 7) {
      insights.push({
        priority: "high",
        category: "短板维度",
        message: `${trends.weakestDimension.name} 维度平均分仅 ${trends.weakestDimension.score}/10`,
        action: `建议针对 ${trends.weakestDimension.name} 制定专项培训计划`,
      });
    }

    const eRate = (trends.levelDistribution.E || 0) / trends.totalRecords;
    if (eRate > 0.2) {
      insights.push({
        priority: "critical",
        category: "质量预警",
        message: `E级占比 ${Math.round(eRate * 100)}%，超过 20% 警戒线`,
        action: "建议立即开展客服质量专项整改",
      });
    }
  }

  // 规则盲区
  if (blindSpots.blindSpots.length > 0) {
    insights.push({
      priority: "medium",
      category: "规则盲区",
      message: `发现 ${blindSpots.blindSpots.length} 个高频消极词未被规则覆盖`,
      action: `建议将以下词加入禁语: ${blindSpots.blindSpots.map(b => b.word).join(", ")}`,
      details: blindSpots.blindSpots,
    });
  }

  // 规则有效性
  if (effectiveness.neverTriggeredRules.length > 0) {
    insights.push({
      priority: "low",
      category: "规则冗余",
      message: `${effectiveness.neverTriggeredRules.length} 条禁语规则从未触发`,
      action: effectiveness.suggestion,
    });
  }

  if (effectiveness.hotRules.length > 0) {
    insights.push({
      priority: "medium",
      category: "高频违规",
      message: `禁语 "${effectiveness.hotRules[0].word}" 命中 ${effectiveness.hotRules[0].count} 次`,
      action: "建议重点关注此违规项，加强培训",
    });
  }

  // 默认建议
  if (insights.length === 0) {
    insights.push({
      priority: "info",
      category: "系统状态",
      message: "系统运行良好，暂无需要调整的规则",
      action: "继续积累数据，系统将持续分析并生成优化建议",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    totalRecords: trends.totalRecords || 0,
    trends,
    insights: insights.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (order[a.priority] || 5) - (order[b.priority] || 5);
    }),
    ruleEffectiveness: effectiveness,
    blindSpots: blindSpots.blindSpots,
  };
}

module.exports = { analyzeTrends, discoverRuleBlindSpots, evaluateRuleEffectiveness, generateEvolutionInsights };
