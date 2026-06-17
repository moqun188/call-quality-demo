/**
 * 情绪分析模块
 * 调用小米 MiMo API 分析每句话的情绪，并给出整体总结。
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { logger } = require("./logger");

const EMOTION_LABELS = ["平静", "愉悦", "焦急", "愤怒", "不满", "困惑", "冷漠", "惊讶"];

class EmotionAnalyzer {
  constructor(config = {}) {
    this.mockMode = config.mockMode !== false;
    this.apiKey = process.env.MIMO_API_KEY;
    this.baseUrl = process.env.MIMO_BASE_URL || "https://api.xiaomimimo.com/v1";
    this.enableReal = process.env.ENABLE_REAL_EMOTION === "true";
  }

  _isKeyValid() {
    return this.apiKey && /^tp-/.test(this.apiKey) && this.apiKey.length > 12;
  }

  async analyze(audioPath, utterances) {
    logger.info(`[情绪分析] 开始处理: ${audioPath}, 语句数: ${utterances.length}`);

    if (!this.enableReal || !this._isKeyValid()) {
      logger.info("[情绪分析] 使用模拟模式 (ENABLE_REAL_EMOTION 或 key 未正确配置)");
      return this._mockAnalyze(utterances);
    }

    logger.info("[情绪分析] 使用小米 MiMo API");
    try {
      return await this._mimoAnalyze(audioPath, utterances);
    } catch (err) {
      logger.error(`[情绪分析] MiMo API 失败: ${err.message}, 回退模拟`);
      return this._mockAnalyze(utterances);
    }
  }

  async _mimoAnalyze(audioPath, utterances) {
    // pipeline 已经转码过，检查 mp3/wav
    const ext = path.extname(audioPath).toLowerCase();
    let mimeType;
    let targetPath = audioPath;

    if (ext === ".mp3") mimeType = "audio/mpeg";
    else if (ext === ".wav") mimeType = "audio/wav";
    else {
      const { prepareAudioForASR } = require("./audioConverter");
      const prepared = await prepareAudioForASR(audioPath, { kbps: 64, sampleRate: 16000, channels: 1 });
      targetPath = prepared.filePath;
      mimeType = prepared.mimeType;
    }

    if (!fs.existsSync(targetPath)) {
      logger.warn(`[情绪分析] 文件不存在, 回退模拟: ${targetPath}`);
      return this._mockAnalyze(utterances);
    }

    const audioBuffer = fs.readFileSync(targetPath);
    const audioBase64 = audioBuffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${audioBase64}`;

    // 将 ASR 内容作为提示词上下文，帮助模型理解对话
    const transcriptLines = utterances
      .map((u, i) => `[${i + 1}] ${u.role === "agent" ? "客服" : "客户"}: ${u.text}`)
      .join("\n");

    const prompt = `以下是客服与客户的通话内容。请为每一句话（utterance）识别情绪标签（从这些标签中选择：平静、愉悦、焦急、愤怒、不满、困惑、冷漠、惊讶），并给出对话整体情绪总结与趋势。

对话内容：
${transcriptLines}

请返回 JSON，不要其他任何文本：
{
  "utterances": [{"label": "情绪标签", "confidence": 0.9}, ...],
  "overall": "整体情绪总结（中文，50字以内）",
  "trend": {
    "customerStart": "客户开头情绪",
    "customerEnd": "客户结尾情绪",
    "negativeShiftCount": 负面情绪变化次数（数字）,
    "resolved": true 或 false
  }
}`;

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
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`[情绪分析] API 错误: ${response.status} - ${errText.substring(0, 200)}`);
      throw new Error(`MiMo API ${response.status}`);
    }

    const result = await response.json();
    const raw = result.choices?.[0]?.message?.content || "";
    logger.debug(`[情绪分析] 原始返回: ${raw.substring(0, 200)}`);

    return this._parseEmotionResult(raw, utterances);
  }

  _parseEmotionResult(raw, utterances) {
    if (!raw || !raw.trim()) {
      logger.warn("[情绪分析] API 空返回，使用模拟数据");
      return this._mockAnalyze(utterances);
    }

    const cleaned = raw
      .replace(/^```(json|JSON)?\s*/, "")
      .replace(/```\s*$/, "")
      .trim();

    let data = null;

    // 1) 直接 JSON
    try {
      data = JSON.parse(cleaned);
    } catch (e) {
      // 2) 文本中抽取 JSON 片段
      try {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) data = JSON.parse(m[0]);
      } catch (e2) {}
    }

    if (data && Array.isArray(data.utterances)) {
      const resultUtterances = utterances.map((u, i) => {
        const apiItem = data.utterances[i];
        const label = apiItem?.label && EMOTION_LABELS.includes(apiItem.label) ? apiItem.label : "平静";
        return {
          ...u,
          emotion: {
            label,
            confidence: apiItem?.confidence ? parseFloat(apiItem.confidence) : 0.85,
            dimensions: {
              valence: label === "愉悦" ? 0.9 : label === "愤怒" || label === "不满" ? 0.2 : 0.55,
              arousal: label === "愤怒" || label === "焦急" ? 0.85 : label === "平静" || label === "冷漠" ? 0.2 : 0.5,
              dominance: u.role === "agent" ? 0.7 : 0.45,
            },
          },
          prosody: {
            speakingRate: u.role === "agent" ? 3.6 + Math.random() * 0.6 : 3.9 + Math.random() * 0.6,
            avgPitch: u.role === "agent" ? 200 + Math.random() * 30 : 225 + Math.random() * 30,
            volumeDb: -18 + Math.random() * 6,
          },
        };
      });

      return {
        utterances: resultUtterances,
        overall: data.overall || this._autoOverall(resultUtterances),
        trend: {
          customerStart: data.trend?.customerStart || "平静",
          customerEnd: data.trend?.customerEnd || "平静",
          negativeShiftCount: typeof data.trend?.negativeShiftCount === "number" ? data.trend.negativeShiftCount : 0,
          resolved: typeof data.trend?.resolved === "boolean" ? data.trend.resolved : true,
        },
      };
    }

    logger.warn("[情绪分析] 无法解析 API 返回，使用模拟数据");
    return this._mockAnalyze(utterances);
  }

  _autoOverall(utterances) {
    const customerUtterances = utterances.filter((u) => u.role === "customer");
    const negatives = customerUtterances.filter((u) => ["愤怒", "不满", "焦急", "困惑", "冷漠"].includes(u.emotion?.label));
    if (negatives.length === 0) return "客户情绪稳定，对话流畅";
    if (negatives.length > customerUtterances.length / 2) return "客户存在明显负面情绪";
    return "客户偶有不满，总体可控";
  }

  async _mockAnalyze(utterances) {
    const result = utterances.map((u, i) => {
      const isAgent = u.role === "agent";
      // 客服默认平静；客户用伪随机分布
      const base = isAgent ? 0 : (i * 7) % 8;
      const labels = isAgent ? ["平静"] : ["平静", "平静", "焦急", "不满", "困惑", "平静", "惊讶", "平静"];
      const label = labels[i % labels.length];

      return {
        ...u,
        emotion: {
          label,
          confidence: 0.85 + Math.random() * 0.14,
          dimensions: {
            valence: label === "愉悦" ? 0.9 : label === "平静" || label === "惊讶" ? 0.6 : label === "不满" || label === "愤怒" ? 0.25 : 0.45,
            arousal: label === "愤怒" || label === "焦急" ? 0.8 : label === "平静" ? 0.2 : 0.5,
            dominance: isAgent ? 0.7 : 0.45,
          },
        },
        prosody: {
          speakingRate: isAgent ? 3.5 + Math.random() * 0.6 : 3.9 + Math.random() * 0.6,
          avgPitch: isAgent ? 200 + Math.random() * 30 : 225 + Math.random() * 30,
          volumeDb: -18 + Math.random() * 6,
        },
      };
    });

    return {
      utterances: result,
      overall: this._autoOverall(result),
      trend: {
        customerStart: result[0]?.emotion?.label || "平静",
        customerEnd: result[result.length - 1]?.emotion?.label || "平静",
        negativeShiftCount: 0,
        resolved: true,
      },
    };
  }
}

module.exports = EmotionAnalyzer;
