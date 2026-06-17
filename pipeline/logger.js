const fs = require("fs");
const path = require("path");

class Logger {
  constructor(options = {}) {
    this.logLevel = options.logLevel || "info";
    this.logDir = options.logDir || "./logs";
    this.logToFile = options.logToFile !== false;
    this.logToConsole = options.logToConsole !== false;
    
    if (this.logToFile) {
      this._ensureLogDir();
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

    let logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
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

  /**
   * 记录质检流程日志
   */
  inspectionStep(stepName, status, detail = null) {
    this.info(`[质检流程] ${stepName} - ${status}`, detail);
  }

  /**
   * 记录 ASR 转写结果
   */
  asrResult(audioFile, segmentCount, duration) {
    this.info(`[ASR转写] 文件: ${audioFile}, 识别: ${segmentCount} 句, 时长: ${duration.toFixed(1)}s`);
  }

  /**
   * 记录说话人分离结果
   */
  diarizationResult(speakerCount, segmentCount) {
    this.info(`[说话人分离] 检出: ${speakerCount} 人, ${segmentCount} 段`);
  }

  /**
   * 记录情绪分析结果
   */
  emotionResult(overall, trend) {
    this.info(`[情绪分析] 总结: ${overall}`, trend);
  }

  /**
   * 记录质检评分
   */
  qualityResult(totalScore, level, dimensions) {
    this.info(`[质检评分] 总分: ${totalScore}分, 等级: ${level}`, dimensions);
  }

  /**
   * 记录 API 请求
   */
  apiRequest(method, path, statusCode, durationMs) {
    const color = statusCode >= 400 ? "\x1b[31m" : statusCode >= 300 ? "\x1b[33m" : "\x1b[32m";
    if (this.logToConsole) {
      console.log(`[API] ${method} ${path} -> ${color}${statusCode}${"\x1b[0m"} (${durationMs}ms)`);
    }
    if (this.logToFile) {
      const logFilePath = path.join(this.logDir, this._getLogFileName());
      fs.appendFileSync(logFilePath, `[${this._getTimestamp()}] [API] ${method} ${path} -> ${statusCode} (${durationMs}ms)\n`);
    }
  }
}

const logger = new Logger({
  logLevel: process.env.LOG_LEVEL || "info",
  logToFile: true,
  logToConsole: true,
});

module.exports = { Logger, logger };
