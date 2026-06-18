const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { initDb } = require("../pipeline/database");

describe("statsManager.js", () => {
  // statsManager 模块在 require 时会初始化真实数据库
  // 这里测试其导出的公共接口
  let statsManager;
  const dataDir = path.join(__dirname, "..", "data");

  beforeAll(() => {
    // 确保 data 目录存在
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    // 加载模块（会触发迁移逻辑）
    statsManager = require("../pipeline/statsManager");
  });

  describe("addInspection", () => {
    test("添加质检记录返回完整对象", () => {
      const mockResult = {
        fileName: "test-unit.wav",
        totalTime: "10.5",
        usedMultimodal: true,
        apiCallCount: 2,
        sessionId: "test-session-001",
        quality: {
          totalScore: 88,
          level: "B",
          dimensions: {
            compliance: { score: 9 },
            knowledge: { score: 8 },
            process: { score: 9 },
            communication: { score: 8.5 },
          },
          violations: [],
        },
        emotion: { overall: "客户情绪平稳" },
        utterances: [
          { speaker: "agent", text: "您好" },
          { speaker: "customer", text: "你好" },
        ],
        steps: [{ name: "ASR", status: "completed" }],
        summary: { summary: "通话顺利" },
        callSummary: { summary: "通话顺利" },
      };

      const record = statsManager.addInspection(mockResult);

      expect(record).toBeTruthy();
      expect(record.id).toBeGreaterThan(0);
      expect(record.totalScore).toBe(88);
      expect(record.level).toBe("B");
      expect(record.fileName).toBe("test-unit.wav");
      expect(record.sessionId).toBe("test-session-001");
    });
  });

  describe("getStats", () => {
    test("返回包含所有必要字段的统计对象", () => {
      const stats = statsManager.getStats();

      expect(stats).toHaveProperty("total");
      expect(stats).toHaveProperty("avgScore");
      expect(stats).toHaveProperty("levelDistribution");
      expect(stats).toHaveProperty("avgDimensions");
      expect(stats).toHaveProperty("recentInspections");
      expect(stats).toHaveProperty("violationsTotal");
      expect(stats).toHaveProperty("violationsByType");

      expect(stats.total).toBeGreaterThan(0);
      expect(typeof stats.avgScore).toBe("number");
      expect(stats.levelDistribution).toHaveProperty("A");
      expect(stats.levelDistribution).toHaveProperty("B");
    });

    test("avgDimensions 不含 NaN", () => {
      const stats = statsManager.getStats();
      const dims = stats.avgDimensions;
      for (const key of Object.keys(dims)) {
        expect(dims[key]).not.toBeNaN();
        expect(typeof dims[key]).toBe("number");
      }
    });
  });

  describe("getHistory", () => {
    test("分页查询返回正确结构", () => {
      const result = statsManager.getHistory(1, 10);

      expect(result).toHaveProperty("items");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("page", 1);
      expect(result).toHaveProperty("pageSize", 10);
      expect(result).toHaveProperty("totalPages");
      expect(Array.isArray(result.items)).toBe(true);
    });

    test("每条记录包含 violationsCount", () => {
      const result = statsManager.getHistory(1, 100);
      for (const item of result.items) {
        expect(item).toHaveProperty("violationsCount");
        expect(typeof item.violationsCount).toBe("number");
      }
    });
  });

  describe("getTokenStats", () => {
    test("返回包含 summary 和 records", () => {
      const stats = statsManager.getTokenStats();

      expect(stats).toHaveProperty("total");
      expect(stats).toHaveProperty("multimodalCount");
      expect(stats).toHaveProperty("legacyCount");
      expect(stats).toHaveProperty("summary");
      expect(stats).toHaveProperty("records");
      expect(Array.isArray(stats.records)).toBe(true);
    });
  });
});
