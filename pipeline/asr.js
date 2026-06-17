/**
 * ASR 转写模块
 * 支持模拟引擎和小米 MiMo ASR 引擎
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { logger } = require("./logger");

const SAMPLE_TRANSCRIPT = [
  // 场景：客户咨询退货流程
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
    this.language = process.env.ASR_LANGUAGE || "zh";
    this.enableRealASR = process.env.ENABLE_REAL_ASR === "true";
  }

  async transcribe(audioPath) {
    logger.info(`[ASR] 开始转写: ${audioPath}`);

    // 统一的 key 有效性检查
    const validKey = this.apiKey && /^tp-/.test(this.apiKey) && this.apiKey.length > 12;
    if (!this.enableRealASR || !validKey) {
      logger.info("[ASR] 使用模拟模式 (ENABLE_REAL_ASR 或 key 未正确配置)");
      return this._mockTranscribe(audioPath);
    }

    logger.info("[ASR] 使用小米 MiMo ASR 引擎");
    return this._mimoTranscribe(audioPath);
  }

  async _mimoTranscribe(audioPath) {
    logger.info("[ASR] 调用小米 MiMo API...");

    try {
      const { prepareAudioForASR } = require("./audioConverter");
      const { filePath: targetPath, mimeType } = await prepareAudioForASR(audioPath, {
        kbps: 64, sampleRate: 16000, channels: 1,
      });
      logger.debug(`[ASR] 音频准备完成: ${targetPath}, MIME: ${mimeType}`);

      const audioBuffer = fs.readFileSync(targetPath);
      const audioBase64 = audioBuffer.toString("base64");
      const dataUrl = `data:${mimeType};base64,${audioBase64}`;

      logger.debug(`[ASR] 文件大小: ${audioBuffer.length} bytes, 格式: ${mimeType}`);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.apiKey,
        },
        body: JSON.stringify({
          model: this.modelName,
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
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[ASR] API 错误: ${response.status} - ${errorText}`);
        throw new Error(`小米 ASR API 错误: ${response.status}`);
      }

      const result = await response.json();
      const parsedResult = this._parseMimoResult(result);

      logger.asrResult(audioPath, parsedResult.segments.length, parsedResult.duration);
      logger.debug(`[ASR] 原始返回: ${JSON.stringify(result).substring(0, 500)}...`);

      return parsedResult;
    } catch (error) {
      logger.error(`[ASR] 小米 ASR 转写失败: ${error.message}`);
      logger.warn("[ASR] 回退到模拟模式");
      return this._mockTranscribe(audioPath);
    }
  }

  _parseMimoResult(result) {
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      logger.warn("[ASR] 小米 ASR 未返回内容，使用模拟数据");
      return this._mockTranscribe("fallback");
    }

    logger.info(`[ASR] 原始返回文本长度: ${content.length}`);

    let segments = [];
    let duration = 0;

    // 策略 1: 尝试解析 JSON { segments: [...] }
    try {
      const data = JSON.parse(content);
      if (data.segments && Array.isArray(data.segments) && data.segments.length > 0) {
        segments = data.segments.map((seg, idx) => ({
          id: idx,
          start: seg.start || 0,
          end: seg.end || (idx + 1) * 3,
          text: seg.text || "",
          confidence: seg.confidence || 0.9,
        }));
        logger.info(`[ASR] JSON 解析成功，${segments.length} 段`);
      }
    } catch (e) {
      // 继续下一个策略
    }

    // 策略 2: 按换行切分，识别时间戳 [00:00 - 00:03]
    if (segments.length === 0) {
      const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
      const timePattern = /[\[]?(\d{1,2}:\d{2}(?:\.\d+)?)\s*[-–~]\s*(\d{1,2}:\d{2}(?:\.\d+)?)[\]]?\s*(.*)/;
      let collected = [];

      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        const timeMatch = line.match(timePattern);
        if (timeMatch) {
          const startSec = this._parseTime(timeMatch[1]);
          const endSec = this._parseTime(timeMatch[2]);
          collected.push({
            id: collected.length,
            start: startSec,
            end: endSec,
            text: timeMatch[3].trim(),
            confidence: 0.9,
          });
        } else if (line.length > 2) {
          // 无时间戳的纯文本：按标点智能分段
          const subSegs = this._splitByPunctuation(line);
          collected = collected.concat(subSegs);
        }
      }

      // 策略 3: 如果只有一段或为空，按整段文本标点智能分段
      if (collected.length <= 1 && content.length > 50) {
        collected = this._splitByPunctuation(content);
        logger.info(`[ASR] 按标点符号重新分段，${collected.length} 段`);
      }

      segments = collected;
    }

    // 如果仍然没有分段，用整段文本
    if (segments.length === 0) {
      segments = [{
        id: 0,
        start: 0,
        end: 10,
        text: content,
        confidence: 0.85,
      }];
    }

    duration = segments.length > 0 ? segments[segments.length - 1].end : 0;
    const fullText = segments.map((s) => s.text).join("");

    logger.info(`[ASR] 解析完成: ${segments.length} 段, ${fullText.length} 字`);
    segments.forEach((seg, idx) => {
      logger.debug(`  [${idx}] ${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s: ${seg.text.substring(0, 40)}`);
    });

    return {
      model: this.modelName,
      duration,
      segments,
      fullText,
      language: this.language,
    };
  }

  /**
   * 按中文/英文标点符号智能分段
   * 中文：。 ！ ？ ； ，
   * 英文：。 ! ? ; . ,
   */
  _splitByPunctuation(text) {
    const segments = [];
    // 按中文标点（。？！；）和英文标点（.!?;）分段
    // 保留逗号用于分句，但不强制
    const sentenceEnds = /[。！？!?;；]/g;
    let matches = [];
    let m;
    while ((m = sentenceEnds.exec(text)) !== null) {
      matches.push(m.index);
    }

    // 如果没有标点，按固定长度分段
    if (matches.length === 0) {
      const chunkSize = 30;
      for (let i = 0; i < text.length; i += chunkSize) {
        segments.push({
          id: segments.length,
          start: segments.length * 3,
          end: (segments.length + 1) * 3,
          text: text.substring(i, i + chunkSize),
          confidence: 0.85,
        });
      }
      return segments;
    }

    // 按切分位置构建句子
    let startIdx = 0;
    const avgPerChar = 0.15; // 估计每个字符 0.15 秒
    for (let i = 0; i < matches.length; i++) {
      const endIdx = matches[i] + 1; // 包含标点
      const sentence = text.substring(startIdx, endIdx).trim();
      if (sentence && sentence.length > 1) {
        const startSec = startIdx * avgPerChar;
        const endSec = endIdx * avgPerChar;
        segments.push({
          id: segments.length,
          start: startSec,
          end: endSec,
          text: sentence,
          confidence: 0.9,
        });
      }
      startIdx = endIdx;
    }

    // 处理最后一段
    if (startIdx < text.length - 1) {
      const last = text.substring(startIdx).trim();
      if (last && last.length > 1) {
        segments.push({
          id: segments.length,
          start: startIdx * avgPerChar,
          end: text.length * avgPerChar,
          text: last,
          confidence: 0.9,
        });
      }
    }

    return segments;
  }

  _parseTime(timeStr) {
    // 解析时间字符串为秒数
    const parts = timeStr.split(":");
    if (parts.length === 2) {
      const minutes = parseInt(parts[0], 10);
      const seconds = parseFloat(parts[1]);
      return minutes * 60 + seconds;
    }
    return parseFloat(timeStr);
  }

  async _mockTranscribe(audioPath) {
    await this._simulateDelay(1500);
    const segments = SAMPLE_TRANSCRIPT.map((seg) => ({
      ...seg,
      words: seg.text.split("").map((ch, i) => ({
        text: ch,
        start: seg.start + (i / seg.text.length) * (seg.end - seg.start),
        end: seg.start + ((i + 1) / seg.text.length) * (seg.end - seg.start),
        confidence: 0.92 + Math.random() * 0.07,
      })),
    }));

    return {
      model: "mock-asr-v1",
      duration: 42.5,
      segments,
      fullText: segments.map((s) => s.text).join(""),
      language: "zh",
    };
  }

  async _simulateDelay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  applyHotwordCorrection(segments) {
    return segments.map((seg) => {
      let text = seg.text;
      for (const [standard, variants] of Object.entries(HOTWORD_DICT)) {
        for (const v of variants) {
          text = text.replace(new RegExp(v, "g"), standard);
        }
      }
      return { ...seg, text };
    });
  }
}

module.exports = ASREngine;
