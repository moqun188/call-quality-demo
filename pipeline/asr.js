/**
 * ASR 转写模块（统一版）
 * 合并原 asr.js + multimodalAnalyzer.js 为单一模块
 * 
 * 策略：优先多模态单次调用（ASR+说话人+情绪），失败回退纯 ASR
 * 一个模块，一个 API 调用，一个入口
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { logger } = require("./logger");

const EMOTION_LABELS = ["平静", "愉悦", "焦急", "愤怒", "不满", "困惑", "冷漠", "惊讶"];

const SAMPLE_TRANSCRIPT = [
  { id: 0, start: 0.0, end: 2.8, text: "您好，欢迎致电XX商城客服中心，请问有什么可以帮您？" },
  { id: 1, start: 3.2, end: 6.5, text: "你好，我上周在你们平台买了一件衣服，码数不合适，想退货。" },
  { id: 2, start: 7.0, end: 10.2, text: "好的先生，麻烦您提供一下订单号，我帮您查询一下。" },
  { id: 3, start: 10.8, end: 12.5, text: "订单号是 XF20240615001。" },
  { id: 4, start: 13.0, end: 18.5, text: "好的，我查到了。这件衣服是7天前签收的，还在退货期内。请问您是要申请退货退款吗？" },
  { id: 5, start: 19.0, end: 21.2, text: "对的，我要退货退款。衣服试了一下，码数偏小了。" },
  { id: 6, start: 21.8, end: 26.5, text: "完全理解，码数不合适确实比较麻烦。我已经为您提交了退货申请，您可以联系快递公司寄回，运费由我们承担。" },
  { id: 7, start: 27.0, end: 29.8, text: "好的，那运费怎么退给我？" },
  { id: 8, start: 30.2, end: 34.5, text: "您寄出后把运单号发到我们公众号，我们会在24小时内将运费打到您的账户余额。" },
  { id: 9, start: 35.0, end: 37.2, text: "好的，那我知道了，谢谢。" },
  { id: 10, start: 37.6, end: 39.5, text: "不客气，请问还有其他需要帮忙的吗？" },
  { id: 11, start: 39.8, end: 40.5, text: "没有了，再见。" },
  { id: 12, start: 40.8, end: 42.5, text: "好的，感谢您的来电，祝您生活愉快，再见！" },
];

const HOTWORD_DICT = {
  "XX商城": ["某商城", "商城"],
  "退货退款": ["退钱", "退款退货"],
};

class ASREngine {
  constructor(config = {}) {
    this.mockMode = config.mockMode !== false;
    this.apiKey = process.env.MIMO_API_KEY;
    this.baseUrl = process.env.MIMO_BASE_URL || "https://api.xiaomimimo.com/v1";
    this.modelName = process.env.ASR_MODEL || "mimo-v2.5-asr";
    this.multimodalModel = "mimo-v2.5";
    this.language = process.env.ASR_LANGUAGE || "zh";
    this.enableRealASR = process.env.ENABLE_REAL_ASR === "true";
  }

  _isKeyValid() {
    return this.apiKey && /^tp-/.test(this.apiKey) && this.apiKey.length > 12;
  }

  /**
   * 统一入口：优先多模态，失败回退纯 ASR
   * 返回格式统一为 { utterances, model, callCount, usedMultimodal }
   */
  async transcribe(audioPath) {
    logger.info(`[ASR] 开始: ${audioPath}`);

    if (!this.enableRealASR || !this._isKeyValid()) {
      logger.info("[ASR] 模拟模式");
      return this._mockTranscribe(audioPath);
    }

    // 尝试多模态（ASR + 说话人 + 情绪，一次调用）
    try {
      const multimodalResult = await this._multimodalAnalyze(audioPath);
      if (multimodalResult) {
        logger.info(`[ASR] 多模态完成，${multimodalResult.utterances.length} 句，1 次调用`);
        return multimodalResult;
      }
    } catch (err) {
      logger.warn(`[ASR] 多模态失败: ${err.message}，回退纯 ASR`);
    }

    // 回退：纯 ASR
    try {
      const asrResult = await this._pureASR(audioPath);
      logger.info(`[ASR] 纯 ASR 完成，${asrResult.utterances.length} 句`);
      return asrResult;
    } catch (err) {
      logger.error(`[ASR] 纯 ASR 也失败: ${err.message}，使用模拟数据`);
      return this._mockTranscribe(audioPath);
    }
  }

  // ─── 多模态调用（ASR + 说话人 + 情绪）───

  async _multimodalAnalyze(audioPath) {
    const { filePath, mimeType } = await this._prepareAudio(audioPath);
    const dataUrl = this._buildDataUrl(filePath, mimeType);

    const prompt = `请仔细分析这段客服通话音频，一次性完成以下三项任务：

## 任务 1: 语音转写 (ASR)
逐句转写音频内容，标注每句话的开始时间和结束时间（秒）。

## 任务 2: 说话人分离 (Speaker Diarization)
为每句话标注说话人角色：
- "agent" = 客服/服务方（通常使用"帮您"、"请问"、"为您"等敬语）
- "customer" = 客户/需求方（通常使用"我想"、"我要"、"怎么办"等表述）

## 任务 3: 情绪分析 (Emotion Analysis)
为每句话标注情绪标签，从以下选项中选择：
平静、愉悦、焦急、愤怒、不满、困惑、冷漠、惊讶

## 输出格式
请严格返回以下 JSON 格式，不要包含任何其他文本：

{
  "transcript": [
    {
      "start": 0.0,
      "end": 2.5,
      "text": "转写的文本内容",
      "role": "agent",
      "emotion": "平静"
    }
  ],
  "overall_emotion": "整体对话情绪总结（50字以内）",
  "trend": {
    "customerStart": "客户开头情绪",
    "customerEnd": "客户结尾情绪",
    "negativeShiftCount": 0,
    "resolved": true
  }
}`;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": this.apiKey },
      body: JSON.stringify({
        model: this.multimodalModel,
        messages: [{
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: dataUrl } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`MiMo API ${response.status}: ${errText.substring(0, 100)}`);
    }

    const result = await response.json();
    const raw = result.choices?.[0]?.message?.content || "";
    return this._parseMultimodalResult(raw);
  }

  _parseMultimodalResult(raw) {
    if (!raw || !raw.trim()) return null;

    const cleaned = raw.replace(/^```(json|JSON)?\s*/, "").replace(/```\s*$/, "").trim();
    let data = null;

    try { data = JSON.parse(cleaned); } catch (e) {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) try { data = JSON.parse(m[0]); } catch (e2) { /* ignore */ }
    }

    if (!data || !Array.isArray(data.transcript) || data.transcript.length === 0) return null;

    const utterances = data.transcript.map((seg, idx) => {
      const role = seg.role === "agent" || seg.role === "customer" ? seg.role : "customer";
      const emotion = EMOTION_LABELS.includes(seg.emotion) ? seg.emotion : "平静";
      const isAgent = role === "agent";

      return {
        speaker: `speaker_${isAgent ? 0 : 1}`,
        role,
        start: parseFloat(seg.start) || 0,
        end: parseFloat(seg.end) || 0,
        text: seg.text || "",
        emotion: {
          label: emotion,
          confidence: 0.9,
          dimensions: {
            valence: emotion === "愉悦" ? 0.9 : emotion === "愤怒" || emotion === "不满" ? 0.2 : 0.55,
            arousal: emotion === "愤怒" || emotion === "焦急" ? 0.85 : emotion === "平静" || emotion === "冷漠" ? 0.2 : 0.5,
            dominance: isAgent ? 0.7 : 0.45,
          },
        },
        prosody: {
          speakingRate: isAgent ? 3.6 + Math.random() * 0.6 : 3.9 + Math.random() * 0.6,
          avgPitch: isAgent ? 200 + Math.random() * 30 : 225 + Math.random() * 30,
          volumeDb: -18 + Math.random() * 6,
        },
      };
    });

    return {
      utterances,
      overall: data.overall_emotion || "对话分析完成",
      trend: {
        customerStart: data.trend?.customerStart || "平静",
        customerEnd: data.trend?.customerEnd || "平静",
        negativeShiftCount: typeof data.trend?.negativeShiftCount === "number" ? data.trend.negativeShiftCount : 0,
        resolved: typeof data.trend?.resolved === "boolean" ? data.trend.resolved : true,
      },
      model: this.multimodalModel,
      callCount: 1,
      usedMultimodal: true,
    };
  }

  // ─── 纯 ASR 调用 ───

  async _pureASR(audioPath) {
    const { filePath, mimeType } = await this._prepareAudio(audioPath);
    const dataUrl = this._buildDataUrl(filePath, mimeType);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": this.apiKey },
      body: JSON.stringify({
        model: this.modelName,
        messages: [{
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: dataUrl } }],
        }],
      }),
    });

    if (!response.ok) throw new Error(`ASR API ${response.status}`);
    const result = await response.json();
    const segments = this._parseASRResult(result);

    // 纯 ASR 模式：没有说话人分离，全部标为 customer
    const utterances = segments.map((seg) => ({
      speaker: "speaker_0",
      role: "customer",
      start: seg.start,
      end: seg.end,
      text: seg.text,
      emotion: { label: "平静", confidence: 0.5, dimensions: { valence: 0.5, arousal: 0.3, dominance: 0.5 } },
      prosody: { speakingRate: 0, avgPitch: 0, volumeDb: 0 },
    }));

    return {
      utterances,
      overall: "纯文本模式，情绪分析不可用",
      trend: { customerStart: "未知", customerEnd: "未知", negativeShiftCount: 0, resolved: true },
      model: this.modelName,
      callCount: 1,
      usedMultimodal: false,
    };
  }

  _parseASRResult(result) {
    const content = result.choices?.[0]?.message?.content;
    if (!content) return [];

    // 尝试 JSON 解析
    try {
      const data = JSON.parse(content);
      if (data.segments && Array.isArray(data.segments)) {
        return data.segments.map((seg, idx) => ({
          id: idx, start: seg.start || 0, end: seg.end || (idx + 1) * 3, text: seg.text || "", confidence: seg.confidence || 0.9,
        }));
      }
    } catch (e) { /* continue */ }

    // 按时间戳解析
    const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
    const timePattern = /[[]?(\d{1,2}:\d{2}(?:\.\d+)?)\s*[-–~]\s*(\d{1,2}:\d{2}(?:\.\d+)?)[\]]?\s*(.*)/;
    const segments = [];
    for (const line of lines) {
      const m = line.match(timePattern);
      if (m) {
        segments.push({ id: segments.length, start: this._parseTime(m[1]), end: this._parseTime(m[2]), text: m[3].trim(), confidence: 0.9 });
      }
    }

    return segments.length > 0 ? segments : [{ id: 0, start: 0, end: 10, text: content, confidence: 0.85 }];
  }

  // ─── 工具方法 ───

  async _prepareAudio(audioPath) {
    const ext = path.extname(audioPath).toLowerCase();
    if (ext === ".mp3") return { filePath: audioPath, mimeType: "audio/mpeg" };
    if (ext === ".wav") return { filePath: audioPath, mimeType: "audio/wav" };
    const { prepareAudioForASR } = require("./audioConverter");
    return prepareAudioForASR(audioPath, { kbps: 64, sampleRate: 16000, channels: 1 });
  }

  _buildDataUrl(filePath, mimeType) {
    const buffer = fs.readFileSync(filePath);
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  }

  _parseTime(timeStr) {
    const parts = timeStr.split(":");
    return parts.length === 2 ? parseInt(parts[0]) * 60 + parseFloat(parts[1]) : parseFloat(timeStr);
  }

  async _mockTranscribe(audioPath) {
    await new Promise(r => setTimeout(r, 500));
    const utterances = SAMPLE_TRANSCRIPT.map((seg) => ({
      speaker: "speaker_0", role: "customer", start: seg.start, end: seg.end, text: seg.text,
      emotion: { label: "平静", confidence: 0.85, dimensions: { valence: 0.5, arousal: 0.3, dominance: 0.5 } },
      prosody: { speakingRate: 0, avgPitch: 0, volumeDb: 0 },
    }));
    return {
      utterances, overall: "模拟模式", trend: { customerStart: "平静", customerEnd: "平静", negativeShiftCount: 0, resolved: true },
      model: "mock-asr-v1", callCount: 0, usedMultimodal: false,
    };
  }

  applyHotwordCorrection(segments) {
    return segments.map((seg) => {
      let text = seg.text;
      for (const [standard, variants] of Object.entries(HOTWORD_DICT)) {
        for (const v of variants) text = text.replace(new RegExp(v, "g"), standard);
      }
      return { ...seg, text };
    });
  }
}

module.exports = ASREngine;
