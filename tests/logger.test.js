const path = require("path");
const fs = require("fs");
const { Logger } = require("../pipeline/logger");

describe("Logger", () => {
  let tmpDir;
  let logger;

  beforeEach(() => {
    tmpDir = path.join(__dirname, "..", ".tmp-test-logs", `test-${Date.now()}`);
    logger = new Logger({
      logDir: tmpDir,
      logToFile: true,
      logToConsole: false,
      logLevel: "debug",
    });
  });

  afterEach(() => {
    // 清理临时日志目录
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("创建日志目录", () => {
    expect(fs.existsSync(tmpDir)).toBe(true);
  });

  test("日志文件按日期命名", () => {
    logger.info("test message");
    const now = new Date();
    const expected = `app_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}.log`;
    const logFile = path.join(tmpDir, expected);
    expect(fs.existsSync(logFile)).toBe(true);
  });

  test("日志级别过滤 - debug < info", () => {
    const infoLogger = new Logger({
      logDir: tmpDir,
      logToFile: true,
      logToConsole: false,
      logLevel: "info",
    });
    infoLogger.debug("should not appear");
    infoLogger.info("should appear");

    const files = fs.readdirSync(tmpDir);
    if (files.length > 0) {
      const content = fs.readFileSync(path.join(tmpDir, files[0]), "utf-8");
      expect(content).toContain("should appear");
      expect(content).not.toContain("should not appear");
    }
  });

  test("sessionId 追踪", () => {
    const sid = logger.setSessionId();
    expect(sid).toBeTruthy();
    expect(sid).toMatch(/^s_/);
    logger.info("with session");

    logger.clearSessionId();
    expect(logger.sessionId).toBeNull();
  });

  test("自定义 sessionId", () => {
    const sid = logger.setSessionId("my-custom-id");
    expect(sid).toBe("my-custom-id");
  });

  test("structuredLog 写入文件", () => {
    logger.error("something broke", { code: 500, detail: "timeout" });
    const files = fs.readdirSync(tmpDir);
    expect(files.length).toBeGreaterThan(0);
    const content = fs.readFileSync(path.join(tmpDir, files[0]), "utf-8");
    expect(content).toContain("something broke");
    expect(content).toContain("500");
  });
});
