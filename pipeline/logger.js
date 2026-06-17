const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class Logger {
  constructor(options = {}) {
    this.logLevel = options.logLevel || "info";
    this.logDir = options.logDir || "./logs";
    this.logToFile = options.logToFile !== false;
    this.logToConsole = options.logToConsole !== false;
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxDays = options.maxDays || 7;
    this.sessionId = null; // 每次质检时设置

    if (this.logToFile) {
      this._ensureLogDir();
      this._cleanOldLogs();
    }

    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };
  }

  _ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  _generateSessionId() {
    return `s_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  }

  setSessionId(sid) {
    this.sessionId = sid || this._generateSessionId();
    return this.sessionId;
  }

  clearSessionId() {
    this.sessionId = null;
  }

  _getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  _getLogFileName() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `app_${year}${month}${day}.log`;
  }

  _rotateIfNeeded(filePath) {
    try {
      if (!fs.existsSync(filePath)) return;
      const stat = fs.statSync(filePath);
      if (stat.size < this.maxFileSize) return;

      // 超过限制，重命名为 .1.log
      const rotated = filePath.replace(".log", ".1.log");
      if (fs.existsSync(rotated)) {
        fs.unlinkSync(rotated);
      }
      fs.renameSync(filePath, rotated);
    } catch (err) {
      // 轮转失败不阻塞日志写入
    }
  }

  _cleanOldLogs() {
    try {
      if (!fs.existsSync(this.logDir)) return;
      const files = fs.readdirSync(this.logDir);
      const cutoff = Date.now() - this.maxDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.startsWith("app_") || !file.endsWith(".log")) continue;
        const filePath = path.join(this.logDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
          }
        } catch (e) {
          // 忽略单个文件删除失败
        }
      }
    } catch (err) {
      // 清理失败不阻塞启动
    }
  }

  _log(level, message, data = null) {
    if (this.levels[level] < this.levels[this.logLevel]) {
      return;
    }

    const timestamp = this._getTimestamp();
    const levelColor = {
      debug: "\x1b[36m",
      info: "\x1b[32m",
      warn: "\x1b[33m",
      error: "\x1b[31m",
    };
    const resetColor = "\x1b[0m";

    const sidTag = this.sessionId ? `[${this.sessionId}]` : "";
    let logMessage = `[${timestamp}] ${sidTag}[${level.toUpperCase()}] ${message}`;

    if (data) {
      if (typeof data === "object") {
        logMessage += "\n" + JSON.stringify(data, null, 2);
      } else {
        logMessage += " " + data;
      }
    }

    if (this.logToConsole) {
      console.log(`${levelColor[level]}${logMessage}${resetColor}`);
    }

    if (this.logToFile) {
      const logFilePath = path.join(this.logDir, this._getLogFileName());
      this._rotateIfNeeded(logFilePath);
      fs.appendFileSync(logFilePath, logMessage + "\n");
    }
  }

  debug(message, data = null) {
    this._log("debug", message, data);
  }

  info(message, data = null) {
    this._log("info", message, data);
  }

  warn(message, data = null) {
    this._log("warn", message, data);
  }

  error(message, data = null) {
    this._log("error", message, data);
  }

  inspectionStep(stepName, status, detail = null) {
    this.info(`[质检流程] ${stepName} - ${status}`, detail);
  }

  asrResult(audioFile, segmentCount, duration) {
    this.info(`[ASR转写] 文件: ${audioFile}, 识别: ${segmentCount} 句, 时长: ${duration.toFixed(1)}s`);
  }

  diarizationResult(speakerCount, segmentCount) {
    this.info(`[说话人分离] 检出: ${speakerCount} 人, ${segmentCount} 段`);
  }

  emotionResult(overall, trend) {
    this.info(`[情绪分析] 总结: ${overall}`, trend);
  }

  qualityResult(totalScore, level, dimensions) {
    this.info(`[质检评分] 总分: ${totalScore}分, 等级: ${level}`, dimensions);
  }

  apiRequest(method, reqPath, statusCode, durationMs) {
    const color = statusCode >= 400 ? "\x1b[31m" : statusCode >= 300 ? "\x1b[33m" : "\x1b[32m";
    if (this.logToConsole) {
      console.log(`[API] ${method} ${reqPath} -> ${color}${statusCode}${"\x1b[0m"} (${durationMs}ms)`);
    }
    if (this.logToFile) {
      const logFilePath = path.join(this.logDir, this._getLogFileName());
      this._rotateIfNeeded(logFilePath);
      fs.appendFileSync(logFilePath, `[${this._getTimestamp()}] [API] ${method} ${reqPath} -> ${statusCode} (${durationMs}ms)\n`);
    }
  }
}

const logger = new Logger({
  logLevel: process.env.LOG_LEVEL || "info",
  logToFile: true,
  logToConsole: true,
});

module.exports = { Logger, logger };
