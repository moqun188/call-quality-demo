require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const QualityInspectionPipeline = require("./pipeline");
const { getScenarioList } = require("./pipeline/scenarios");
const { exportToExcel, exportToJSON } = require("./pipeline/reportExporter");
const statsManager = require("./pipeline/statsManager");
const { exportToObsidian, getVaultStats } = require("./pipeline/obsidianExporter");

const app = express();
const PORT = process.env.PORT || 3000;

// 清理上传的临时文件（质检成功后）
function cleanupUploads(filePath, convertedPath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    if (convertedPath && convertedPath !== filePath && fs.existsSync(convertedPath)) {
      fs.unlinkSync(convertedPath);
    }
  } catch (err) {
    console.error("清理上传文件失败:", err.message);
  }
}

const storage = multer.diskStorage({
  destination: path.join(__dirname, "uploads"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".wav", ".mp3", ".m4a", ".ogg", ".amr", ".flac"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${ext}，支持: ${allowed.join(", ")}`));
    }
  },
});

const pipeline = new QualityInspectionPipeline({ mockMode: false });

function buildReportFileName(data, extension) {
  const rawBase = String(data.fileName || "质检报告").replace(/\.[^.\\/]+$/, "");
  const safeBase = rawBase.replace(/[\\/:*?"<>|\r\n]+/g, "_").trim() || "质检报告";
  return `${safeBase}_质检报告.${extension}`;
}

function encodeRFC5987Value(value) {
  return encodeURIComponent(value).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function buildAttachmentHeader(fileName, fallbackName) {
  const fallback = String(fallbackName || "quality-report")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .trim() || "quality-report";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987Value(fileName)}`;
}

app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.json({ limit: "10mb" }));

app.get("/api/scenarios", (req, res) => {
  res.json({ success: true, data: getScenarioList() });
});

app.post("/api/inspect", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "请上传音频文件" });
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  if (res.socket) {
    res.socket.setNoDelay(true);
  }

  const sendNDJSON = (obj) => {
    res.write(JSON.stringify(obj) + "\n");
  };

  const stepStart = Date.now();

  try {
    const result = await pipeline.run(req.file.path, req.file.originalname, null, async (stepIndex, step) => {
      sendNDJSON({ type: "step", stepIndex, step, elapsed: Date.now() - stepStart });
      await new Promise(resolve => setImmediate(resolve));
    });

    statsManager.addInspection(result);
    sendNDJSON({ type: "complete", success: true, data: result });
    // 质检成功后清理临时文件
    cleanupUploads(req.file.path, result.convertedPath);
  } catch (err) {
    console.error("质检失败:", err);
    sendNDJSON({ type: "error", error: err.message });
  }

  res.end();
});

// SSE 流式质检接口
app.post("/api/inspect/stream", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "请上传音频文件" });
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (type, payload) => {
    res.write(JSON.stringify({ type, ...payload }) + "\n");
    res.flush();
  };

  const stepStart = Date.now();

  try {
    const result = await pipeline.run(req.file.path, req.file.originalname, null, (stepIndex, step) => {
      send("step", { stepIndex, step, elapsed: Date.now() - stepStart });
    });

    statsManager.addInspection(result);
    send("complete", { success: true, data: result });
    cleanupUploads(req.file.path, result.convertedPath);
    res.end();
  } catch (err) {
    console.error("质检失败:", err);
    send("error", { error: err.message });
    res.end();
  }
});

app.post("/api/inspect/demo", async (req, res) => {
  try {
    const scenario = req.query.scenario || "A";
    const result = await pipeline.run("demo", "demo_sample.wav", scenario);
    statsManager.addInspection(result);
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stats", (req, res) => {
  res.json(statsManager.getStats());
});

app.get("/api/token-usage", (req, res) => {
  res.json(statsManager.getTokenStats());
});

app.get("/api/history", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;
  res.json(statsManager.getHistory(page, pageSize));
});

app.post("/api/export/excel", async (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.quality) {
      return res.status(400).json({ error: "请提供质检结果数据" });
    }
    const buffer = await exportToExcel(data);
    const fileName = buildReportFileName(data, "xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", buildAttachmentHeader(fileName, "quality-report.xlsx"));
    res.send(buffer);
  } catch (err) {
    console.error("Excel导出失败:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/export/json", async (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.quality) {
      return res.status(400).json({ error: "请提供质检结果数据" });
    }
    const buffer = exportToJSON(data);
    const fileName = buildReportFileName(data, "json");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", buildAttachmentHeader(fileName, "quality-report.json"));
    res.send(buffer);
  } catch (err) {
    console.error("JSON导出失败:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/export/obsidian", async (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.quality) {
      return res.status(400).json({ error: "请提供质检结果数据" });
    }
    const result = await exportToObsidian(data);
    res.json({
      success: true,
      message: `质检报告已成功保存到 Obsidian`,
      filePath: result.filePath,
      fileName: result.fileName,
      vaultPath: result.vaultPath,
    });
  } catch (err) {
    console.error("Obsidian导出失败:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/obsidian/stats", (req, res) => {
  try {
    const stats = getVaultStats();
    res.json({
      success: true,
      data: stats,
    });
  } catch (err) {
    console.error("获取Obsidian统计失败:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/test/asr", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "请上传音频文件" });
    }

    const ASREngine = require("./pipeline/asr");
    const { logger } = require("./pipeline/logger");
    const { convertToMp3, prepareAudioForASR } = require("./pipeline/audioConverter");

    logger.info(`[测试ASR] 测试文件: ${req.file.path}`);

    const fs = require("fs");
    const path = require("path");
    const apiKey = process.env.MIMO_API_KEY;
    const baseUrl = process.env.MIMO_BASE_URL || "https://api.xiaomimimo.com/v1";
    const modelName = process.env.ASR_MODEL || "mimo-v2.5-asr";

    const ext = path.extname(req.file.path).toLowerCase();
    let targetFile = req.file.path;
    let converted = false;
    let conversionInfo = null;
    let mimeType = ext === ".mp3" ? "audio/mpeg" : ext === ".wav" ? "audio/wav" : "audio/mp4";

    // 统一准备音频：wav 直接用，其他格式转 MP3
    try {
      const prepared = await prepareAudioForASR(req.file.path, {
        kbps: 64, sampleRate: 16000, channels: 1,
      });
      targetFile = prepared.filePath;
      mimeType = prepared.mimeType;
      converted = prepared.converted;
      if (converted) {
        const stat = fs.statSync(targetFile);
        conversionInfo = { size: stat.size, mimeType, duration: 0 };
        logger.info(`[测试ASR] ${ext} 已转换为 mp3: ${targetFile}`);
      }
    } catch (convErr) {
      logger.warn(`[测试ASR] 格式转换失败: ${convErr.message}`);
    }

    const audioBuffer = fs.readFileSync(targetFile);
    const audioBase64 = audioBuffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${audioBase64}`;

    logger.info(`[测试ASR] 调用小米 MiMo API...`);
    logger.info(`[测试ASR] API Key: ${apiKey ? "已配置" : "未配置"}`);
    logger.info(`[测试ASR] Model: ${modelName}`);
    logger.info(`[测试ASR] 文件大小: ${audioBuffer.length} bytes`);
    logger.info(`[测试ASR] MIME类型: ${mimeType}`);

    const startTime = Date.now();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: dataUrl,
                },
              },
              {
                type: "text",
                text: "请进行语音识别并返回JSON格式，包含时间戳和分段信息。格式：{\"duration\": 总时长(秒), \"segments\": [{\"start\": 开始时间(秒), \"end\": 结束时间(秒), \"text\": \"文本内容\"}, ...]}",
              },
            ],
          },
        ],
        asr_options: {
          language: process.env.ASR_LANGUAGE || "zh",
        },
      }),
    });

    const responseTime = Date.now() - startTime;
    const responseText = await response.text();

    logger.info(`[测试ASR] 响应状态: ${response.status}`);
    logger.info(`[测试ASR] 响应时间: ${responseTime}ms`);
    logger.info(`[测试ASR] 响应内容: ${responseText.substring(0, 500)}`);

    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch (e) {
      responseJson = { raw: responseText };
    }

    res.json({
      success: response.ok,
      status: response.status,
      responseTime: `${responseTime}ms`,
      apiKeyConfigured: Boolean(apiKey),
      model: modelName,
      fileSize: audioBuffer.length,
      mimeType: mimeType,
      baseUrl: baseUrl,
      converted: converted,
      conversionInfo: conversionInfo,
      requestHeaders: {
        "Content-Type": "application/json",
        "api-key": apiKey ? `${apiKey.substring(0, 8)}...` : "未配置",
      },
      response: responseJson,
    });
  } catch (err) {
    console.error("[测试ASR] 失败:", err);
    res.status(500).json({
      success: false,
      error: err.message,
      stack: err.stack,
    });
  }
});

app.post("/api/test/summary", async (req, res) => {
  try {
    const { logger } = require("./pipeline/logger");
    const Summarizer = require("./pipeline/summarizer");
    const summarizer = new Summarizer();

    // 模拟对话数据
    const sampleUtterances = [
      { role: "agent", text: "您好，欢迎致电客服中心，请问有什么可以帮您？", emotion: { label: "平静" } },
      { role: "customer", text: "你好，我想咨询一下关于退货的问题。", emotion: { label: "平静" } },
      { role: "agent", text: "好的，请问您是想退哪件商品呢？", emotion: { label: "平静" } },
      { role: "customer", text: "是一件衣服，码数不合适。", emotion: { label: "平静" } },
      { role: "agent", text: "了解，我帮您查一下订单信息。", emotion: { label: "平静" } },
    ];

    logger.info("[测试总结] 开始测试总结功能");

    const result = await summarizer.summarize(sampleUtterances, { overall: "客户情绪稳定" });

    res.json({
      success: true,
      generatedBy: result.generatedBy,
      summary: result,
    });
  } catch (err) {
    console.error("[测试总结] 失败:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `上传错误: ${err.message}` });
  }
  if (err.message) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`📞 录音质检系统 MVP 启动成功`);
  console.log(`   🌐 打开浏览器: http://localhost:${PORT}`);
  console.log(`   📁 上传音频文件或点击"模拟Demo"体验`);
});
