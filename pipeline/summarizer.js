/**
 * 录音总结模块
 * 使用小米 MiMo 模型对转写内容进行智能总结
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { logger } = require("./logger");

class Summarizer {
  constructor(config = {}) {
    this.apiKey = process.env.MIMO_API_KEY;
    this.baseUrl = process.env.MIMO_BASE_URL || "https://api.xiaomimimo.com/v1";
    this.enableRealSummary = process.env.ENABLE_REAL_SUMMARY !== "false";
  }

  _isKeyValid() {
    return this.apiKey && /^tp-/.test(this.apiKey) && this.apiKey.length > 12;
  }

  async summarize(utterances, emotionResult) {
    logger.info(`[录音总结] 开始生成总结, ${utterances.length} 条对话`);

    if (!this.enableRealSummary || !this._isKeyValid()) {
      logger.info("[录音总结] 使用模拟模式 (ENABLE_REAL_SUMMARY 或 key 未正确配置)");
      return this._mockSummary(utterances, emotionResult);
    }

    try {
      return await this._realSummary(utterances, emotionResult);
    } catch (err) {
      logger.error(`[录音总结] MiMo API 失败: ${err.message}, 回退模拟`);
      return this._mockSummary(utterances, emotionResult);
    }
  }

  async _realSummary(utterances, emotionResult) {
    logger.info("[录音总结] 使用小米 MiMo API");

    const textContent = utterances
      .map((u, i) => `${u.role === "agent" ? "客服" : "客户"}[${i + 1}]: ${u.text}`)
      .join("\n");

    const emotionSummary = emotionResult?.overall || "无";

    const prompt = `你是一个专业的客服质检分析师。请根据以下通话内容，生成结构化的通话总结。

通话内容：
${textContent}

情绪分析总结：${emotionSummary}

请严格返回以下 JSON 格式（不要 markdown code block、不要额外文本）：
{
  "callPurpose": "通话目的，15字以内",
  "keyPoints": ["要点1", "要点2", "要点3"],
  "customerRequest": "客户主要诉求，30字以内",
  "resolutionStatus": "已解决 / 待跟进 / 未解决（三选一）",
  "actionItems": ["后续行动项1", "后续行动项2"],
  "qualityIssues": ["质量问题描述1", "..."],
  "overallAssessment": "整体评价，50字以内",
  "highlights": "客服亮点描述，30字以内",
  "improvementSuggestions": ["改进建议1", "改进建议2"]
}`;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": this.apiKey },
      body: JSON.stringify({
        model: "mimo-v2.5-pro",
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`[录音总结] API 错误: ${response.status} - ${errText.substring(0, 200)}`);
      throw new Error(`MiMo API ${response.status}`);
    }

    const result = await response.json();
    const raw = result.choices?.[0]?.message?.content || "";
    logger.debug(`[录音总结] 原始返回: ${raw.substring(0, 200)}`);

    // 清理 markdown code block
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(json|JSON)?\s*/, "").replace(/\s*```$/, "");

    let data = null;
    try {
      data = JSON.parse(cleaned);
    } catch (e) {
      // 尝试从文本中抽取 JSON 片段
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        try { data = JSON.parse(m[0]); } catch (e2) {}
      }
    }

    if (data) {
      logger.info("[录音总结] 生成成功");
      return { ...data, raw, generatedBy: "mimo-v2.5-pro" };
    }

    logger.warn("[录音总结] 解析失败, 回退模拟");
    return { ...this._mockSummary(utterances, emotionResult), raw };
  }

  _mockSummary(utterances, emotionResult) {
    logger.info("[录音总结] 使用模拟模式");

    const agentUtterances = utterances.filter(u => u.role === "agent");
    const customerUtterances = utterances.filter(u => u.role === "customer");

    // 简单分析对话目的
    const fullText = utterances.map(u => u.text).join("");
    let callPurpose = "常规咨询";
    if (/退款|退货/.test(fullText)) callPurpose = "退款/退货处理";
    else if (/投诉|投诉/.test(fullText)) callPurpose = "客户投诉处理";
    else if (/咨询/.test(fullText)) callPurpose = "业务咨询";

    // 分析情绪趋势
    const customerEmotions = customerUtterances.map(u => u.emotion?.label || "平静");
    const positiveCount = customerEmotions.filter(e => ["平静", "愉悦"].includes(e)).length;
    const negativeCount = customerEmotions.filter(e => ["不满", "愤怒", "焦急", "困惑", "冷漠"].includes(e)).length;
    const resolved = positiveCount > negativeCount;

    return {
      callPurpose,
      keyPoints: [
        `客服 ${agentUtterances.length} 轮回复`,
        `客户 ${customerUtterances.length} 轮提问`,
        `对话时长约 ${Math.max(10, utterances.length * 6)}s`,
      ],
      customerRequest: this._extractCustomerRequest(customerUtterances),
      resolutionStatus: resolved ? "已解决" : "待跟进",
      actionItems: [
        fullText.includes("稍后") || fullText.includes("稍后") ? "需后续跟进" : "通话正常结束",
        fullText.includes("反馈") ? "需反馈相关部门" : null,
      ].filter(Boolean),
      qualityIssues: negativeCount > 0 ? ["需关注客户情绪处理"] : ["未发现明显质量问题"],
      overallAssessment: resolved ? "服务流程规范，客户情绪稳定" : "服务基本合格，客户情绪需关注",
      highlights: fullText.includes("谢谢") || fullText.includes("感谢") ? "服务态度良好" : "流程完整",
      improvementSuggestions: negativeCount > 0 ? ["建议加强情绪识别和安抚能力"] : ["继续保持"],
      generatedBy: "mock",
    };
  }

  _extractCustomerRequest(customerUtterances) {
    if (customerUtterances.length === 0) return "无";
    const joined = customerUtterances.map(u => u.text).join("");
    return joined.length > 40 ? joined.substring(0, 40) + "..." : joined || "无明确诉求";
  }
}

module.exports = Summarizer;
