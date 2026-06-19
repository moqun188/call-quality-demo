/**
 * 规则迭代引擎 (S5-013)
 * 基于反馈数据分析，自动发现规则偏差，生成优化建议
 *
 * 数据飞轮：反馈 → 分析 → 建议 → 人工确认 → 规则更新
 */

const { getDb } = require("./database");
const { loadRules } = require("./rulesLoader");

class RuleIterator {
  /**
   * 分析反馈数据，生成规则迭代建议
   */
  static analyze() {
    const db = getDb();
    try {
      const feedbacks = db.prepare(`
        SELECT f.*, i.file_name, i.total_score as inspection_score, i.level as inspection_level,
               i.dimensions as inspection_dimensions
        FROM feedback f
        JOIN inspections i ON f.inspection_id = i.id
        ORDER BY f.created_at DESC
      `).all();

      if (feedbacks.length === 0) {
        return {
          hasEnoughData: false,
          message: "暂无反馈数据，至少需要 1 条反馈",
          suggestions: [],
        };
      }

      const suggestions = [];

      // 1. 分析分数偏差模式
      suggestions.push(...this._analyzeScorePatterns(feedbacks));

      // 2. 分析维度纠正模式
      suggestions.push(...this._analyzeDimensionPatterns(feedbacks));

      // 3. 分析违规误报
      suggestions.push(...this._analyzeViolationPatterns(feedbacks));

      // 4. 分析角色识别问题
      suggestions.push(...this._analyzeRolePatterns(feedbacks));

      // 5. 按优先级排序
      suggestions.sort((a, b) => b.priority - a.priority);

      return {
        hasEnoughData: true,
        totalFeedback: feedbacks.length,
        confirmed: feedbacks.filter((f) => f.feedback_type === "confirm").length,
        corrected: feedbacks.filter((f) => f.feedback_type === "correct").length,
        suggestions,
      };
    } finally {
      db.close();
    }
  }

  /**
   * 分析分数偏差模式
   * 如果 AI 持续高估/低估某个分数段，建议调整评分基准
   */
  static _analyzeScorePatterns(feedbacks) {
    const suggestions = [];
    const corrections = feedbacks.filter(
      (f) => f.feedback_type === "correct" && f.human_score !== null && f.ai_score !== null
    );

    if (corrections.length < 3) return suggestions;

    // 按分数段分析
    const ranges = { low: [], mid: [], high: [] };
    for (const f of corrections) {
      if (f.ai_score < 70) ranges.low.push(f);
      else if (f.ai_score < 85) ranges.mid.push(f);
      else ranges.high.push(f);
    }

    for (const [range, items] of Object.entries(ranges)) {
      if (items.length < 2) continue;
      const avgDiff =
        items.reduce((sum, f) => sum + (f.human_score - f.ai_score), 0) / items.length;
      if (Math.abs(avgDiff) >= 3) {
        const direction = avgDiff > 0 ? "低估" : "高估";
        suggestions.push({
          type: "score_calibration",
          priority: Math.min(10, Math.round(Math.abs(avgDiff))),
          title: `AI 在${range === "low" ? "低分" : range === "mid" ? "中分" : "高分"}段${direction}客户评分`,
          description: `${items.length} 条反馈显示 AI 平均${direction} ${Math.abs(avgDiff).toFixed(1)} 分`,
          detail: {
            range,
            avgDiff: +avgDiff.toFixed(1),
            sampleSize: items.length,
            samples: items.slice(0, 3).map((f) => ({
              file: f.file_name,
              ai: f.ai_score,
              human: f.human_score,
            })),
          },
          action: `建议调整 ${range} 分段的评分权重或基准分`,
        });
      }
    }

    return suggestions;
  }

  /**
   * 分析维度纠正模式
   * 如果某个维度频繁被纠正，说明该维度评分逻辑有偏差
   */
  static _analyzeDimensionPatterns(feedbacks) {
    const suggestions = [];
    const dimCorrections = feedbacks.filter(
      (f) => f.feedback_type === "correct" && f.dimension_corrections
    );

    if (dimCorrections.length < 2) return suggestions;

    const dimStats = {};
    for (const f of dimCorrections) {
      const dims = JSON.parse(f.dimension_corrections);
      for (const [dim, val] of Object.entries(dims)) {
        if (!dimStats[dim]) dimStats[dim] = { count: 0, totalDiff: 0, overEst: 0, underEst: 0 };
        const diff = (val.human || 0) - (val.ai || 0);
        dimStats[dim].count++;
        dimStats[dim].totalDiff += diff;
        if (diff < 0) dimStats[dim].overEst++;
        else if (diff > 0) dimStats[dim].underEst++;
      }
    }

    for (const [dim, stats] of Object.entries(dimStats)) {
      if (stats.count < 2) continue;
      const avgDiff = stats.totalDiff / stats.count;
      if (Math.abs(avgDiff) >= 1.5) {
        const direction = avgDiff > 0 ? "低估" : "高估";
        const dimNames = {
          compliance: "话术合规",
          knowledge: "业务知识",
          process: "流程完整",
          communication: "沟通技巧",
        };
        suggestions.push({
          type: "dimension_calibration",
          priority: Math.min(9, Math.round(Math.abs(avgDiff) * 2)),
          title: `「${dimNames[dim] || dim}」维度持续${direction}`,
          description: `${stats.count} 条纠正反馈显示该维度平均${direction} ${Math.abs(avgDiff).toFixed(1)} 分`,
          detail: {
            dimension: dim,
            avgDiff: +avgDiff.toFixed(1),
            overEstCount: stats.overEst,
            underEstCount: stats.underEst,
            sampleSize: stats.count,
          },
          action: `建议调整 ${dim} 维度的评分规则或权重`,
        });
      }
    }

    return suggestions;
  }

  /**
   * 分析违规误报
   * 如果质检员标记某违规为"不准确"，建议调整禁语列表
   */
  static _analyzeViolationPatterns(feedbacks) {
    const suggestions = [];
    const violationFeedbacks = feedbacks.filter(
      (f) => f.feedback_type === "correct" && f.violations_feedback
    );

    if (violationFeedbacks.length === 0) return suggestions;

    const falsePositives = [];
    for (const f of violationFeedbacks) {
      const violations = JSON.parse(f.violations_feedback);
      for (const v of violations) {
        if (v.confirmed === false) {
          falsePositives.push(v);
        }
      }
    }

    if (falsePositives.length >= 2) {
      const violationTypes = {};
      for (const fp of falsePositives) {
        const key = fp.type || fp.text || "unknown";
        violationTypes[key] = (violationTypes[key] || 0) + 1;
      }

      for (const [type, count] of Object.entries(violationTypes)) {
        if (count >= 2) {
          suggestions.push({
            type: "violation_false_positive",
            priority: 7,
            title: `违规检测「${type}」存在误报`,
            description: `${count} 次被质检员标记为不准确`,
            detail: { violationType: type, falsePositiveCount: count },
            action: `建议将「${type}」从禁语列表移除或添加上下文判断`,
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * 分析角色识别问题
   * 如果质检员频繁纠正角色标签，说明说话人分离需要优化
   */
  static _analyzeRolePatterns(feedbacks) {
    const suggestions = [];
    const roleCorrections = feedbacks.filter(
      (f) => f.feedback_type === "correct" && f.role_corrections
    );

    if (roleCorrections.length >= 2) {
      suggestions.push({
        type: "role_detection",
        priority: 8,
        title: "说话人角色识别需要优化",
        description: `${roleCorrections.length} 条反馈包含角色纠正`,
        detail: {
          correctionCount: roleCorrections.length,
          samples: roleCorrections.slice(0, 3).map((f) => ({
            file: f.file_name,
            corrections: JSON.parse(f.role_corrections),
          })),
        },
        action: "建议优化说话人分离特征词或增加上下文判断",
      });
    }

    return suggestions;
  }
}

module.exports = RuleIterator;
