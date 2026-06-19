/**
 * 质检分析引擎
 * 话术合规、业务知识、流程完整性、沟通技巧评估
 */

class QualityAnalyzer {
  constructor() {
    this.standards = {
      opening: ["您好", "欢迎致电", "请问有什么可以帮您"],
      closing: ["感谢", "祝您", "再见", "生活愉快"],
      polite: ["请", "谢谢", "您", "麻烦", "抱歉", "理解"],
      prohibited: ["不知道", "不归我管", "没办法", "你自己", "不关我事"],
      process: [
        "开场问候",
        "身份确认",
        "需求了解",
        "方案提供",
        "问题解决",
        "结束确认",
      ],
    };
  }

  async evaluate(utterances, emotionResult) {
    const fullText = utterances.map((u) => u.text).join("");
    const agentTexts = utterances.filter((u) => u.role === "agent").map((u) => u.text);
    const customerTexts = utterances.filter((u) => u.role === "customer").map((u) => u.text);

    const compliance = this._evalCompliance(agentTexts, fullText);
    const knowledge = this._evalKnowledge(agentTexts, customerTexts);
    const process = this._evalProcess(utterances);
    const communication = this._evalCommunication(utterances, emotionResult);
    const violations = this._detectViolations(agentTexts);

    const weighted =
      compliance.score * 0.30 +
      knowledge.score * 0.25 +
      process.score * 0.25 +
      communication.score * 0.20;

    const penalty = violations.filter((v) => v.severity === "critical").length * 5;
    const total = Math.max(0, Math.min(100, Math.round(weighted * 10 - penalty)));

    return {
      totalScore: total,
      level: total >= 90 ? "A" : total >= 80 ? "B" : total >= 70 ? "C" : total >= 60 ? "D" : "E",
      dimensions: { compliance, knowledge, process, communication },
      violations,
      strengths: this._findStrengths(agentTexts),
      suggestions: this._generateSuggestions(compliance, knowledge, process, communication),
    };
  }

  _evalCompliance(agentTexts, fullText) {
    let score = 5;

    const hasOpening = this.standards.opening.some((p) => fullText.includes(p));
    const hasClosing = this.standards.closing.some((p) => fullText.includes(p));

    // 礼貌用语频次加权
    let politeTotal = 0;
    for (const word of this.standards.polite) {
      const matches = fullText.match(new RegExp(word, "g"));
      if (matches) politeTotal += matches.length;
    }

    if (hasOpening) score += 1.5;
    if (hasClosing) score += 1.5;
    if (politeTotal >= 8) score += 2;
    else if (politeTotal >= 4) score += 1;
    else if (politeTotal >= 2) score += 0.5;

    return {
      score: Math.min(10, Math.round(score * 10) / 10),
      reason: hasOpening && hasClosing
        ? `开场白和结束语规范，礼貌用语出现 ${politeTotal} 次`
        : `开场白或结束语有缺失，礼貌用语 ${politeTotal} 次`,
      evidence: [
        `礼貌用语累计出现 ${politeTotal} 次`,
        hasOpening ? "已使用标准开场白" : "未检测到标准开场白",
        hasClosing ? "已使用标准结束语" : "未检测到标准结束语",
      ],
    };
  }

  _evalKnowledge(agentTexts, customerTexts) {
    let score = 5;

    const customerQuestions = customerTexts.filter((t) => t.includes("?") || t.includes("？") || t.includes("怎么") || t.includes("如何") || t.includes("吗"));
    const customerConcerns = customerTexts.filter((t) => t.includes("不合适") || t.includes("偏小") || t.includes("运费") || t.includes("退货"));

    // 回答了客户问题 +1
    if (customerQuestions.length > 0 && agentTexts.length >= customerQuestions.length) score += 1;
    // 解决了客户关切 +1
    if (customerConcerns.length > 0) score += 1;
    // 提到了关键业务术语 +1
    const businessTerms = ["码数", "退货", "运费", "退款", "订单", "快递", "寄回"];
    const agentTermHits = businessTerms.filter((t) => agentTexts.some((a) => a.includes(t))).length;
    if (agentTermHits >= 3) score += 2;
    else if (agentTermHits >= 2) score += 1;
    // 提供了具体流程信息 +1
    const hasCorrective = agentTexts.some((t) => t.includes("7天") || t.includes("退货期") || t.includes("24小时"));
    if (hasCorrective) score += 1;

    return {
      score: Math.min(10, score),
      reason: agentTermHits >= 3
        ? `准确回答了 ${customerConcerns.length} 个核心关切，业务术语覆盖 ${agentTermHits} 项`
        : `业务术语覆盖不足（${agentTermHits}/${businessTerms.length}）`,
      evidence: [
        `客户提出 ${customerConcerns.length} 个核心关切`,
        `客服覆盖 ${agentTermHits} 项业务术语`,
        hasCorrective ? "提供了具体流程信息" : "缺少具体流程信息",
      ],
    };
  }

  _evalProcess(utterances) {
    let score = 4;
    const fullText = utterances.map((u) => u.text).join("");

    const stages = {
      opening: this.standards.opening.some((p) => fullText.includes(p)),
      infoRequest: utterances.some((u) => u.text.includes("订单号") || u.text.includes("提供")),
      problemIdentified: utterances.some((u) => u.text.includes("不合适") || u.text.includes("退货")),
      solution: utterances.some((u) => u.text.includes("提交") || u.text.includes("申请") || u.text.includes("寄回")),
      closing: this.standards.closing.some((p) => fullText.includes(p)),
    };

    const completed = Object.values(stages).filter(Boolean).length;
    score += completed;

    return {
      score: Math.min(10, score),
      stages,
      completeness: `${completed}/5 环节完成`,
      reason: completed >= 4 ? "服务流程完整" : "部分流程环节缺失",
    };
  }

  _evalCommunication(utterances, emotionResult) {
    let score = 5;
    const agentUtterances = utterances.filter((u) => u.role === "agent");

    const hasConfirm = agentUtterances.some((u) => u.text.includes("理解") || u.text.includes("查到") || u.text.includes("请问"));
    const hasEmpathy = agentUtterances.some((u) => u.text.includes("理解") || u.text.includes("麻烦") || u.text.includes("抱歉"));
    const hasGuide = agentUtterances.some((u) => u.text.includes("可以") || u.text.includes("联系") || u.text.includes("发到"));
    const hasProactive = agentUtterances.some((u) => u.text.includes("帮您") || u.text.includes("为您") || u.text.includes("我帮"));

    if (hasConfirm) score += 1;
    if (hasEmpathy) score += 1.5;
    if (hasGuide) score += 1;
    if (hasProactive) score += 0.5;

    // 客户情绪改善加分
    if (emotionResult?.trend?.resolved) score += 1;

    return {
      score: Math.min(10, Math.round(score * 10) / 10),
      reason: hasEmpathy && hasGuide
        ? "客服有共情表达，能主动引导客户"
        : "沟通技巧有提升空间",
      evidence: [
        hasEmpathy ? "表达了同理心" : "缺乏同理心表达",
        hasGuide ? "主动提供后续步骤指引" : "未主动引导客户",
        hasProactive ? "主动提供帮助" : "缺少主动性",
        emotionResult?.trend?.resolved ? "客户问题得到解决" : "客户情绪未改善",
      ],
    };
  }

  _detectViolations(agentTexts) {
    const violations = [];
    const fullText = agentTexts.join("");

    for (const word of this.standards.prohibited) {
      if (fullText.includes(word)) {
        violations.push({
          type: "prohibited_word",
          detail: `使用了禁语: "${word}"`,
          severity: "critical",
        });
      }
    }

    if (!agentTexts.some((t) => t.includes("请问") || t.includes("吗"))) {
      violations.push({
        type: "process_error",
        detail: "未进行需求确认",
        severity: "major",
      });
    }

    return violations;
  }

  _findStrengths(agentTexts) {
    const strengths = [];
    if (agentTexts.some((t) => t.includes("理解"))) strengths.push("共情能力好");
    if (agentTexts.some((t) => t.includes("请"))) strengths.push("礼貌用语规范");
    if (agentTexts.some((t) => t.includes("运费") && t.includes("承担"))) strengths.push("主动说明费用承担");
    return strengths.length ? strengths : ["基础服务流程完整"];
  }

  _generateSuggestions(compliance, knowledge, process, communication) {
    const suggestions = [];
    if (compliance.score < 8) suggestions.push("加强开场白和结束语的标准话术培训");
    if (knowledge.score < 8) suggestions.push("建议补充产品知识库，提高应答准确率");
    if (process.score < 8) suggestions.push("注意服务流程的完整性，增加确认环节");
    if (communication.score < 8) suggestions.push("提升共情表达，主动引导客户情绪");

    if (suggestions.length === 0) {
      suggestions.push("服务水平良好，建议保持");
      suggestions.push("可作为优秀案例供团队参考");
    }

    return suggestions;
  }
}

module.exports = QualityAnalyzer;
