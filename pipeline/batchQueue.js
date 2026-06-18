/**
 * 批量质检队列
 * 支持多文件并发上传，逐个处理，实时进度推送
 */

const { v4: uuidv4 } = require("uuid");

class BatchQueue {
  constructor(concurrency = 1) {
    this.concurrency = concurrency;
    this.jobs = new Map(); // jobId -> job
    this.queue = [];       // 待处理的 jobId
    this.running = 0;
  }

  createJob(files) {
    const batchId = `batch_${uuidv4().slice(0, 8)}`;
    const items = files.map((f) => ({
      itemId: uuidv4().slice(0, 8),
      fileName: f.originalname,
      filePath: f.path,
      status: "pending", // pending | processing | completed | failed
      result: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    }));

    const job = {
      batchId,
      total: items.length,
      completed: 0,
      failed: 0,
      status: "running", // running | completed | failed
      items,
      createdAt: new Date().toISOString(),
    };

    this.jobs.set(batchId, job);
    return job;
  }

  getJob(batchId) {
    return this.jobs.get(batchId);
  }

  getAllJobs() {
    return [...this.jobs.values()].sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  updateItemStatus(batchId, itemId, status, result, error) {
    const job = this.jobs.get(batchId);
    if (!job) return;

    const item = job.items.find((i) => i.itemId === itemId);
    if (!item) return;

    item.status = status;
    if (result) item.result = result;
    if (error) item.error = error;
    if (status === "processing") item.startedAt = new Date().toISOString();
    if (status === "completed" || status === "failed") {
      item.finishedAt = new Date().toISOString();
    }

    if (status === "completed") job.completed++;
    if (status === "failed") job.failed++;

    // 检查是否全部完成
    const doneCount = job.items.filter(
      (i) => i.status === "completed" || i.status === "failed"
    ).length;
    if (doneCount === job.total) {
      job.status = job.failed > 0 && job.completed === 0 ? "failed" : "completed";
    }
  }
}

module.exports = BatchQueue;
