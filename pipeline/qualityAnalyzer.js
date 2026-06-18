/**
 * 质检分析引擎
 * 话术合规、业务知识、流程完整性、沟通技巧评估
 * 规则从 rules/*.json 加载，支持多场景配置
 */

const { loadRules } = require("./rulesLoader");

class QualityAnalyzer {
  constructor(ruleName) {
    this.rules = loadRules(ruleName || "default");
    this.standards = this.rules.standards;
  }

  async evaluate(utterances, emotionResult) {
    const r = this.rules;
    const fullText = utterances.map((u) => u.text).join("");
    const agentTexts = utterances.filter((u) => u.role === "agent").map((u) => u.text);
    const customerTexts = utterances.filter((u) => u.role === "customer").map((u) => u.text);

    const compliance = this._evalCompliance(agentTexts, fullText);
    const knowledge = this._evalKnowledge(agentTexts, customerTexts);
    const process = this._evalProcess(utterances);
    const communication = this._evalCommunication(utterances, emotionResult);
    const violations = this._detectViolations(agentTexts);

    const w = r.weights;
    const weighted =
      compliance.score * w.compliance +
      knowledge.score * w.knowledge +
      process.score * w.process +
      communication.score * w.communication;

    const penalties = r.penalties;
    let penalty = 0;
    for (const v of violations) {
      penalty += penalties[v.severity] || 0;
    }
    const total = Math.max(0, Math.min(100, Math.round(weighted * 10 - penalty)));

    // 计算等级
    let level = "E";
    for (const [lv, threshold] of Object.entries(r.levels).sort((a, b) => b[1] - a[1])) {
      if (total >= threshold) { level = lv; break; }
    }

    return {
      totalScore: total,
      level,
      dimensions: { compliance, knowledge, process, communication },
      violations,
      strengths: this._findStrengths(agentTexts),
      suggestions: this._generateSuggestions(compliance, knowledge, process, communication),
      ruleName: r.name,
      ruleVersion: r.version,
    };
  }

  _evalCompliance(agentTexts, fullText) {
    const cfg = this.rules.dimensions.compliance;
    let score = cfg.baseScore;

    const hasOpening = this.standards.opening.some((p) => fullText.includes(p));
    const hasClosing = this.standards.closing.some((p) => fullText.includes(p));
    const politeCount = this.standards.polite.filter((p) => fullText.includes(p)).length;

    if (hasOpening) score += cfg.checks.opening.points;
    if (hasClosing) score += cfg.checks.closing.points;
    if (politeCount >= cfg.checks.politeThreshold.value) score += cfg.checks.politeThreshold.points;

    return {
      score: Math.min(10, score),
      reason: hasOpening && hasClosing
        ? "开场白和结束语规范，礼貌用语使用充分"
        : "开场白或结束语有缺失",
      evidence: [
        `礼貌用语出现 ${politeCount} 次`,
        hasOpening ? "已使用标准开场白" : "未检测到标准开场白",
        hasClosing ? "已使用标准结束语" : "未检测到标准结束语",
      ],
    };
  }

  _evalKnowledge(agentTexts, customerTexts) {
    const cfg = this.rules.dimensions.knowledge;
    let score = cfg.baseScore;

    const customerConcerns = customerTexts.filter((t) =>
      cfg.concernKeywords.some((k) => t.includes(k))
    );
    if (customerConcerns.length > 0) score += 1;
    if (agentTexts.some((t) => cfg.answerKeywords.some((k) => t.includes(k)))) score += 1;
    if (agentTexts.some((t) => cfg.correctiveKeywords.some((k) => t.includes(k)))) score += 1;

    return {
      score: Math.min(10, score),
      reason: "准确回答客户问题，知识点掌握良好",
      evidence: [
        `客户提出 ${customerConcerns.length} 个核心关切`,
        agentTexts.some((t) => cfg.correctiveKeywords.some((k) => t.includes(k)))
          ? "准确说明了关键业务信息"
          : "未检测到关键业务信息回复",
      ],
    };
  }

  _evalProcess(utterances) {
    const cfg = this.rules.dimensions.process;
    let score = cfg.baseScore;
    const fullText = utterances.map((u) => u.text).join("");

    const stages = {};
    for (const [stageName, stageCfg] of Object.entries(cfg.stages)) {
      const keywords = stageCfg.keywords || this.standards[stageName] || [];
      stages[stageName] = keywords.some((k) => fullText.includes(k)) ||
        utterances.some((u) => keywords.some((k) => u.text.includes(k)));
    }

    const completed = Object.values(stages).filter(Boolean).length;
    score += completed;

    return {
      score: Math.min(10, score),
      stages,
      completeness: `${completed}/${Object.keys(stages).length} 环节完成`,
      reason: completed >= 4 ? "服务流程完整" : "部分流程环节缺失",
    };
  }

  _evalCommunication(utterances, emotionResult) {
    const cfg = this.rules.dimensions.communication;
    let score = cfg.baseScore;
    const agentUtterances = utterances.filter((u) => u.role === "agent");

    const hasConfirm = agentUtterances.some((u) => cfg.confirmKeywords.some((k) => u.text.includes(k)));
    const hasEmpathy = agentUtterances.some((u) => cfg.empathyKeywords.some((k) => u.text.includes(k)));
    const hasGuide = agentUtterances.some((u) => cfg.guideKeywords.some((k) => u.text.includes(k)));

    if (hasConfirm) score += 1;
    if (hasEmpathy) score += 1;
    if (hasGuide) score += 1;

    return {
      score: Math.min(10, score),
      reason: "客服有共情表达，能主动引导客户",
      evidence: [
        hasEmpathy ? "表达了同理心" : "缺乏同理心表达",
        hasGuide ? "主动提供后续步骤指引" : "未主动引导客户",
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

    const vCfg = this.rules.violations;
    if (vCfg.noNeedConfirm) {
      const nc = vCfg.noNeedConfirm;
      if (!agentTexts.some((t) => nc.checkKeywords.some((k) => t.includes(k)))) {
        violations.push({ type: nc.type, detail: nc.detail, severity: nc.severity });
      }
    }

    return violations;
  }

  _findStrengths(agentTexts) {
    const strengths = [];
    for (const [, cfg] of Object.entries(this.rules.strengths)) {
      if (agentTexts.some((t) => cfg.keywords.some((k) => t.includes(k)))) {
        strengths.push(cfg.label);
      }
    }
    return strengths.length ? strengths : ["基础服务流程完整"];
  }

  _generateSuggestions(compliance, knowledge, process, communication) {
    const suggestions = [];
    for (const [dim, score] of Object.entries({ compliance, knowledge, process, communication })) {
      const cfg = this.rules.suggestions[dim];
      if (cfg && score.score < cfg.threshold) {
        suggestions.push(cfg.message);
      }
    }
    if (suggestions.length === 0) {
      suggestions.push("服务水平良好，建议保持");
      suggestions.push("可作为优秀案例供团队参考");
    }
    return suggestions;
  }
}

module.exports = QualityAnalyzer;
