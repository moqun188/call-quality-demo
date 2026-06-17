/**
 * 说话人分离模块
 * 调用小米 MiMo API；返回结构化的 speakers / segments。
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { logger } = require("./logger");

const VALID_MIME_PREFIXES = ["audio/mpeg", "audio/mp3", "audio/wav"];

class DiarizationEngine {
  constructor(config = {}) {
    this.mockMode = config.mockMode !== false;
    this.apiKey = process.env.MIMO_API_KEY;
    this.baseUrl = process.env.MIMO_BASE_URL || "https://api.xiaomimimo.com/v1";
    this.enableReal = process.env.ENABLE_REAL_DIARIZATION === "true";
  }

  _isKeyValid() {
    // 小米 Token Plan 的 key 以 tp- 开头
    return this.apiKey && /^tp-/.test(this.apiKey) && this.apiKey.length > 12;
  }

  async diarize(audioPath) {
    logger.info(`[说话人分离] 开始处理: ${audioPath}`);

    if (!this.enableReal || !this._isKeyValid()) {
      logger.info("[说话人分离] 使用模拟模式 (ENABLE_REAL_DIARIZATION 或 key 未正确配置)");
      return this._mockDiarize(audioPath);
    }

    logger.info("[说话人分离] 使用小米 MiMo API");
    try {
      return await this._mimoDiarize(audioPath);
    } catch (err) {
      logger.error(`[说话人分离] MiMo API 失败: ${err.message}, 回退模拟`);
      return this._mockDiarize(audioPath);
    }
  }

  async _mimoDiarize(audioPath) {
    // 检查是否已为 mp3 / wav — pipeline 已经转码过了，
    // 这里直接读文件并构造 dataURL，避免重复转码
    const ext = path.extname(audioPath).toLowerCase();
    let mimeType;
    if (ext === ".mp3") mimeType = "audio/mpeg";
    else if (ext === ".wav") mimeType = "audio/wav";
    else {
      // 还没转码，兜底转一次
      const { prepareAudioForASR } = require("./audioConverter");
      const prepared = await prepareAudioForASR(audioPath, { kbps: 64, sampleRate: 16000, channels: 1 });
      audioPath = prepared.filePath;
      mimeType = prepared.mimeType;
    }

    // 文件不存在则强制回退模拟
    if (!fs.existsSync(audioPath)) {
      logger.warn(`[说话人分离] 文件不存在, 回退模拟: ${audioPath}`);
      return this._mockDiarize(audioPath);
    }

    const audioBuffer = fs.readFileSync(audioPath);
    const audioBase64 = audioBuffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${audioBase64}`;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": this.apiKey },
      body: JSON.stringify({
        model: "mimo-v2.5",
        messages: [
          {
            role: "user",
            content: [
              { type: "input_audio", input_audio: { data: dataUrl } },
              {
                type: "text",
                text:
                  "请识别这段音频中的说话人，返回 JSON：{\"numSpeakers\": 人数, \"segments\": [{\"speaker\": \"speaker_0\", \"start\": 开始秒, \"end\": 结束秒}, ...]}。只返回 JSON，不要任何额外文本。",
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`[说话人分离] API 错误: ${response.status} - ${errText}`);
      throw new Error(`MiMo API ${response.status}`);
    }

    const result = await response.json();
    const raw = result.choices?.[0]?.message?.content || "";
    logger.debug(`[说话人分离] 原始返回: ${raw.substring(0, 200)}`);

    return this._parseDiarizeResult(raw, audioPath);
  }

  _parseDiarizeResult(raw, audioPath) {
    if (!raw || !raw.trim()) {
      logger.warn("[说话人分离] API 空返回, 回退模拟");
      return this._mockDiarize(audioPath);
    }

    // 清理 markdown code block
    const cleaned = raw
      .replace(/^```(json|JSON)?\s*/, "")
      .replace(/```\s*$/, "")
      .trim();

    // 1) 直接 JSON 解析
    try {
      const data = JSON.parse(cleaned);
      if (data.segments && Array.isArray(data.segments) && data.segments.length > 0) {
        const segments = data.segments
          .map((seg, idx) => ({
            speaker: seg.speaker || `speaker_${idx % 2}`,
            start: parseFloat(seg.start) || 0,
            end: parseFloat(seg.end) || (idx + 1) * 3,
          }))
          .sort((a, b) => a.start - b.start);
        const speakers = new Set(segments.map((s) => s.speaker));
        return {
          numSpeakers: data.numSpeakers || speakers.size || 2,
          segments,
        };
      }
    } catch (e) {
      // 继续兜底策略
    }

    // 2) 从文本中提取 JSON 片段
    try {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        if (data.segments && Array.isArray(data.segments) && data.segments.length > 0) {
          const segments = data.segments.map((seg, idx) => ({
            speaker: seg.speaker || `speaker_${idx % 2}`,
            start: parseFloat(seg.start) || 0,
            end: parseFloat(seg.end) || (idx + 1) * 3,
          }));
          const speakers = new Set(segments.map((s) => s.speaker));
          return {
            numSpeakers: data.numSpeakers || speakers.size || 2,
            segments,
          };
        }
      }
    } catch (e) {
      // 继续兜底
    }

    // 3) 按时间戳文本解析 (例如 "[00:00 - 00:05] speaker_0")
    try {
      const timePattern = /(\d{1,2}:\d{2}(?:\.\d+)?)\s*[-–~]\s*(\d{1,2}:\d{2}(?:\.\d+)?)/;
      const lines = cleaned.split("\n").filter(Boolean);
      const segments = [];
      for (const line of lines) {
        const m = line.match(timePattern);
        if (m) {
          const startSec = this._parseTime(m[1]);
          const endSec = this._parseTime(m[2]);
          const speakerMatch = line.match(/speaker[_]?\d+/i) || ["speaker_" + (segments.length % 2)];
          segments.push({ speaker: speakerMatch[0].toLowerCase(), start: startSec, end: endSec });
        }
      }
      if (segments.length > 0) {
        const speakers = new Set(segments.map((s) => s.speaker));
        return { numSpeakers: speakers.size || 2, segments };
      }
    } catch (e) {
      // 继续兜底
    }

    logger.warn("[说话人分离] 无法解析 API 返回, 回退模拟模式");
    return this._mockDiarize(audioPath);
  }

  _parseTime(t) {
    const parts = t.split(":");
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    return parseFloat(t) || 0;
  }

  async _mockDiarize(audioPath) {
    // 根据音频文件大小粗略估计时长；如果无法估计，默认 ~30s
    let durationSec = 30;
    try {
      if (fs.existsSync(audioPath)) {
        const stat = fs.statSync(audioPath);
        // mp3 @ 64kbps ≈ 8KB/s，粗估时长
        durationSec = Math.max(10, Math.round(stat.size / 8000));
      }
    } catch (e) {}

    const numSegments = Math.max(4, Math.round(durationSec / 6));
    const segLen = durationSec / numSegments;
    const segments = [];
    for (let i = 0; i < numSegments; i++) {
      segments.push({
        speaker: `speaker_${i % 2}`,
        start: i * segLen,
        end: (i + 1) * segLen,
      });
    }

    return { numSpeakers: 2, segments };
  }

  /**
   * 将 ASR 句子与说话人标签对齐
   */
  align(asrSegments, diarSegments) {
    const utterances = [];
    let diarIdx = 0;

    for (const asr of asrSegments) {
      const mid = (asr.start + asr.end) / 2;
      while (diarIdx < diarSegments.length - 1 && diarSegments[diarIdx].end < mid) {
        diarIdx++;
      }
      const speaker = diarSegments[Math.min(diarIdx, diarSegments.length - 1)].speaker;
      utterances.push({
        speaker,
        role: speaker === "speaker_0" ? "agent" : "customer",
        start: asr.start,
        end: asr.end,
        text: asr.text,
      });
    }

    return utterances;
  }
}

module.exports = DiarizationEngine;
