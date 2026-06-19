require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const QualityInspectionPipeline = require("./pipeline");
const { getScenarioList } = require("./pipeline/scenarios");
const { exportToExcel } = require("./pipeline/reportExporter");
const statsManager = require("./pipeline/statsManager");
const { loadRules, listRules } = require("./pipeline/rulesLoader");
const BatchQueue = require("./pipeline/batchQueue");

const app = express();
const batchQueue = new BatchQueue();
const PORT = process.env.PORT || 3000;

function cleanupUploads(filePath, convertedPath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (convertedPath && convertedPath !== filePath && fs.existsSync(convertedPath)) fs.unlinkSync(convertedPath);
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
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`不支持的格式: ${ext}`));
  },
});

const pipeline = new QualityInspectionPipeline({ mockMode: false });

function buildReportFileName(data, extension) {
  const rawBase = String(data.fileName || "质检报告").replace(/\.[^.\\/]+$/, "");
  const safeBase = rawBase.replace(/[\\/:*?"<>|\r\n]+/g, "_").trim() || "质检报告";
  return `${safeBase}_质检报告.${extension}`;
}

function encodeRFC5987Value(value) {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildAttachmentHeader(fileName, fallback) {
  const fb = String(fallback || "quality-report").replace(/[^\x20-\x7E]/g, "").replace(/[\\/:*?"<>|\r\n]+/g, "_").trim() || "quality-report";
  return `attachment; filename="${fb}"; filename*=UTF-8''${encodeRFC5987Value(fileName)}`;
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "10mb" }));

// ─── API 路由 ───

app.get("/api/scenarios", (req, res) => res.json({ success: true, data: getScenarioList() }));
app.get("/api/rules", (req, res) => res.json({ success: true, data: listRules() }));

// 单文件质检（NDJSON 流式）
app.post("/api/inspect", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "请上传音频文件" });

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (res.socket) res.socket.setNoDelay(true);

  const sendNDJSON = (obj) => res.write(JSON.stringify(obj) + "\n");
  const stepStart = Date.now();

  try {
    const ruleName = req.query.ruleName || req.body?.ruleName || "default";
    const result = await pipeline.run(req.file.path, req.file.originalname, null, async (stepIndex, step) => {
      sendNDJSON({ type: "step", stepIndex, step, elapsed: Date.now() - stepStart });
      await new Promise((r) => setImmediate(r));
    });

    statsManager.addInspection(result);
    sendNDJSON({ type: "complete", success: true, data: result });
    cleanupUploads(req.file.path, result.convertedPath);
  } catch (err) {
    console.error("质检失败:", err);
    sendNDJSON({ type: "error", error: err.message });
  }
  res.end();
});

// Demo 质检
app.post("/api/inspect/demo", async (req, res) => {
  try {
    const scenario = req.query.scenario || "A";
    const result = await pipeline.run("demo", "demo_sample.wav", scenario);
    statsManager.addInspection(result);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 批量质检
app.post("/api/batch/inspect", upload.array("audio", 20), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: "请上传音频文件" });
  const batchId = batchQueue.createBatch(req.files.map((f) => ({ path: f.path, name: f.originalname })));
  res.json({ success: true, batchId, fileCount: req.files.length });
  batchQueue.processBatch(batchId, async (filePath, fileName) => {
    const result = await pipeline.run(filePath, fileName);
    statsManager.addInspection(result);
    cleanupUploads(filePath, result.convertedPath);
    return result;
  });
});

app.get("/api/batch/:batchId", (req, res) => {
  const batch = batchQueue.getBatch(req.params.batchId);
  if (!batch) return res.status(404).json({ error: "批次不存在" });
  res.json(batch);
});

app.get("/api/batch", (req, res) => res.json(batchQueue.listBatches()));

// 统计 & 历史
app.get("/api/stats", (req, res) => res.json(statsManager.getStats()));
app.get("/api/history", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;
  res.json(statsManager.getHistory(page, pageSize));
});

// 导出（只保留 Excel）
app.post("/api/export/excel", async (req, res) => {
  try {
    const data = req.body;
    if (!data?.quality) return res.status(400).json({ error: "请提供质检结果数据" });
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

// 错误处理
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: `上传错误: ${err.message}` });
  if (err.message) return res.status(400).json({ error: err.message });
  next();
});

app.listen(PORT, () => {
  console.log(`📞 CallQ 客服质检系统启动成功`);
  console.log(`   🌐 http://localhost:${PORT}`);
});
