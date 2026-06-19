/**
 * 反馈管理器
 * 质检员对 AI 结果确认/纠正，数据回流驱动规则迭代
 */

const { getDb } = require("./database");

class FeedbackManager {
  /**
   * 提交反馈
   * @param {Object} feedback - { inspectionId, feedbackType, aiScore, humanScore, ... }
   */
  static submit(feedback) {
    const db = getDb();
    try {
      const stmt = db.prepare(`
        INSERT INTO feedback (inspection_id, feedback_type, ai_score, human_score,
          ai_level, human_level, dimension_corrections, role_corrections,
          violations_feedback, notes, reviewer)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        feedback.inspectionId,
        feedback.feedbackType,
        feedback.aiScore || null,
        feedback.humanScore || null,
        feedback.aiLevel || null,
        feedback.humanLevel || null,
        feedback.dimensionCorrections ? JSON.stringify(feedback.dimensionCorrections) : null,
        feedback.roleCorrections ? JSON.stringify(feedback.roleCorrections) : null,
        feedback.violationsFeedback ? JSON.stringify(feedback.violationsFeedback) : null,
        feedback.notes || null,
        feedback.reviewer || "质检员"
      );
      return { id: result.lastInsertRowid };
    } finally {
      db.close();
    }
  }

  /**
   * 获取某条质检记录的反馈
   */
  static getByInspection(inspectionId) {
    const db = getDb();
    try {
      const rows = db.prepare(
        "SELECT * FROM feedback WHERE inspection_id = ? ORDER BY created_at DESC"
      ).all(inspectionId);
      return rows.map((r) => ({
        ...r,
        dimensionCorrections: r.dimension_corrections ? JSON.parse(r.dimension_corrections) : null,
        roleCorrections: r.role_corrections ? JSON.parse(r.role_corrections) : null,
        violationsFeedback: r.violations_feedback ? JSON.parse(r.violations_feedback) : null,
      }));
    } finally {
      db.close();
    }
  }

  /**
   * 获取所有反馈（分页）
   */
  static list(page = 1, pageSize = 20) {
    const db = getDb();
    try {
      const offset = (page - 1) * pageSize;
      const rows = db.prepare(
        "SELECT * FROM feedback ORDER BY created_at DESC LIMIT ? OFFSET ?"
      ).all(pageSize, offset);
      const total = db.prepare("SELECT COUNT(*) as c FROM feedback").get().c;
      return { items: rows, total, page, pageSize };
    } finally {
      db.close();
    }
  }

  /**
   * 反馈统计概览
   */
  static getStats() {
    const db = getDb();
    try {
      const total = db.prepare("SELECT COUNT(*) as c FROM feedback").get().c;
      const confirmed = db.prepare(
        "SELECT COUNT(*) as c FROM feedback WHERE feedback_type = 'confirm'"
      ).get().c;
      const corrected = db.prepare(
        "SELECT COUNT(*) as c FROM feedback WHERE feedback_type = 'correct'"
      ).get().c;

      // 平均分数偏差
      const avgDeviation = db.prepare(`
        SELECT AVG(ABS(human_score - ai_score)) as avg_dev
        FROM feedback WHERE feedback_type = 'correct' AND human_score IS NOT NULL AND ai_score IS NOT NULL
      `).get();

      // 维度纠正频率
      const dimCorrections = db.prepare(`
        SELECT dimension_corrections FROM feedback
        WHERE feedback_type = 'correct' AND dimension_corrections IS NOT NULL
      `).all();

      const dimStats = {};
      for (const row of dimCorrections) {
        const dims = JSON.parse(row.dimension_corrections);
        for (const [dim, val] of Object.entries(dims)) {
          if (!dimStats[dim]) dimStats[dim] = { count: 0, totalDiff: 0 };
          dimStats[dim].count++;
          dimStats[dim].totalDiff += Math.abs((val.human || 0) - (val.ai || 0));
        }
      }
      for (const dim of Object.keys(dimStats)) {
        dimStats[dim].avgDiff = +(dimStats[dim].totalDiff / dimStats[dim].count).toFixed(2);
      }

      return {
        totalFeedback: total,
        confirmed,
        corrected,
        confirmRate: total > 0 ? +((confirmed / total) * 100).toFixed(1) : 0,
        correctionRate: total > 0 ? +((corrected / total) * 100).toFixed(1) : 0,
        avgScoreDeviation: avgDeviation?.avg_dev ? +avgDeviation.avg_dev.toFixed(1) : 0,
        dimensionCorrections: dimStats,
      };
    } finally {
      db.close();
    }
  }
}

module.exports = FeedbackManager;
