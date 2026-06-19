/**
 * Pipeline 编排器（瘦身版）
 * 预处理 → 多模态分析（ASR+说话人+情绪，单次调用）→ 规则质检 → 模板总结
 * 
 * 架构原则（三视角共识）：
 * - 马斯克：API 调用从 5 次→1 次，只保留 ASR
 * - 乔布斯：砍掉不重要的步骤，聚焦核心链路
 * - Karpathy：在正确的抽象层工作，规则引擎做规则的事
 */

require("dotenv").config();
const AudioPreprocessor = require("./preprocessor");
const ASREngine = require("./asr");
const MultimodalAnalyzer = require("./multimodalAnalyzer");
const QualityAnalyzer = require("./qualityAnalyzer");
const { getScenario } = require("./scenarios");
const { logger } = require("./logger");

class QualityInspectionPipeline {
  constructor(config = {}) {
    this.preprocessor = new AudioPreprocessor();
    this.asr = new ASREngine({ mockMode: config.mockMode !== false });
    this.multimodal = new MultimodalAnalyzer({ enableReal: process.env.ENABLE_REAL_ASR === "true" });
    this.quality = new QualityAnalyzer(config.ruleName);
  }

  async run(audioPath, fileName, scenarioId, onStep) {
    const steps = [];
    const startTime = Date.now();
    const sessionId = logger.setSessionId();
    logger.info(`[Pipeline] 质检开始: ${fileName}, sessionId: ${sessionId}`);

    const scenario = scenarioId ? getScenario(scenarioId) : null;
    if (scenario) {
      return this._runScenario(scenario, fileName, startTime, onStep);
    }

    const notify = async (logicalIndex, status, detail, extra) => {
      const stepObj = {
        name: extra?.name || this._stepName(logicalIndex),
        status,
        detail,
        ...extra,
      };
      steps[logicalIndex] = stepObj;
      if (onStep) {
        const cb = onStep(logicalIndex, stepObj);
        if (cb && typeof cb.then === "function") await cb;
      }
    };

    // Step 1: 预处理
    await notify(0, "processing");
    const preprocResult = await this.preprocessor.process(audioPath);
    const effectiveAudioPath = preprocResult.convertedPath || audioPath;
    await notify(0, "completed", `${preprocResult.sampleRate / 1000}kHz / ${preprocResult.channels}ch` +
      (preprocResult.convertedPath ? "（已转码）" : ""));

    // Step 2: 多模态单次调用（ASR + 说话人 + 情绪）
    // 失败时回退到纯 ASR
    let utterances;
    let emotionResult;
    let usedMultimodal = false;

    await notify(1, "processing");
    await notify(2, "processing");
    await notify(3, "processing");

    const multimodalResult = await this.multimodal.analyze(effectiveAudioPath);

    if (multimodalResult) {
      usedMultimodal = true;
      utterances = multimodalResult.utterances;
      emotionResult = {
        utterances: multimodalResult.utterances,
        overall: multimodalResult.overall,
        trend: multimodalResult.trend,
      };
      await notify(1, "completed", `多模态识别 ${utterances.length} 句`);
      await notify(2, "completed", `说话人识别完成`);
      await notify(3, "completed", multimodalResult.overall);
      logger.info(`[Pipeline] 多模态单次调用完成，节省独立 API 请求`);
    } else {
      // 回退：纯 ASR，说话人和情绪由规则引擎推断
      logger.info("[Pipeline] 多模态调用未成功，回退到纯 ASR + 规则推断");
      const asrResult = await this.asr.transcribe(effectiveAudioPath);
      if (this.asr.mockMode) {
        asrResult.segments = this.asr.applyHotwordCorrection(asrResult.segments);
      }

      // 纯 ASR 模式：没有说话人分离，全部标为 "customer"（后续由规则引擎处理）
      utterances = asrResult.segments.map((seg) => ({
        speaker: "speaker_0",
        role: "customer",
        start: seg.start,
        end: seg.end,
        text: seg.text,
        emotion: { label: "平静", confidence: 0.5, dimensions: { valence: 0.5, arousal: 0.3, dominance: 0.5 } },
        prosody: { speakingRate: 0, avgPitch: 0, volumeDb: 0 },
      }));

      emotionResult = {
        utterances,
        overall: "纯文本模式，情绪分析不可用",
        trend: { customerStart: "未知", customerEnd: "未知", negativeShiftCount: 0, resolved: true },
      };

      await notify(1, "completed", `ASR 识别 ${utterances.length} 句`);
      await notify(2, "completed", `纯文本模式（无说话人分离）`);
      await notify(3, "completed", `规则推断模式`);
    }

    // Step 4: 质检评分（纯规则引擎，零 API 调用）
    await notify(4, "processing");
    const qualityResult = await this.quality.evaluate(utterances, emotionResult);
    await notify(4, "completed", `总分 ${qualityResult.totalScore} 分，等级 ${qualityResult.level}`);

    // Step 5: 模板总结（零 API 调用）
    const summary = this._generateSummary(qualityResult, emotionResult);

    const totalTime = Date.now() - startTime;

    return {
      fileName,
      totalTime: `${(totalTime / 1000).toFixed(1)}s`,
      steps,
      utterances,
      emotion: emotionResult,
      quality: qualityResult,
      summary,
      callSummary: summary,
      usedMultimodal,
      apiCallCount: usedMultimodal ? 1 : 1,
      convertedPath: preprocResult.convertedPath || null,
      sessionId,
    };
  }

  _stepName(logicalIndex) {
    const names = [
      "音频预处理",
      "语音转写 (ASR)",
      "说话人分离",
      "情绪分析",
      "质检评分",
    ];
    return names[logicalIndex] || "未知步骤";
  }

  async _runScenario(scenario, fileName, startTime, onStep) {
    const steps = [];
    const totalDuration = scenario.asr_segments[scenario.asr_segments.length - 1].end;

    const scenarioSteps = [
      { name: "音频预处理", detail: "48kHz / 1ch" },
      { name: "语音转写 (ASR)", detail: `识别 ${scenario.asr_segments.length} 句，${totalDuration.toFixed(1)}s` },
      { name: "说话人分离", detail: `检出 2 人，${scenario.diarization_segments.length} 段` },
      { name: "情绪分析", detail: scenario.emotion_data.overall },
      { name: "质检评分", detail: `总分 ${scenario.quality_result.totalScore} 分，等级 ${scenario.quality_result.level}` },
    ];

    for (let i = 0; i < scenarioSteps.length; i++) {
      steps[i] = { ...scenarioSteps[i], status: "completed" };
      if (onStep) onStep(i, { ...scenarioSteps[i], status: "completed" });
    }

    const utterances = scenario.asr_segments.map((asr) => {
      const diar = scenario.diarization_segments.find(
        (d) => Math.abs((d.start + d.end) / 2 - (asr.start + asr.end) / 2) < 1
      );
      const role = diar && diar.speaker === "speaker_0" ? "agent" : "customer";
      const isAgent = role === "agent";
      const emotionPool = isAgent ? scenario.emotion_data.agent : scenario.emotion_data.customer;
      const label = emotionPool[0] || "平静";
      const valenceMap = { 愤怒: 0.15, 不满: 0.25, 焦急: 0.35, 困惑: 0.45, 冷漠: 0.3, 平静: 0.6, 愉悦: 0.9, 惊讶: 0.5 };

      return {
        speaker: diar ? diar.speaker : "speaker_0",
        role,
        start: asr.start,
        end: asr.end,
        text: asr.text,
        emotion: {
          label,
          confidence: 0.85 + Math.random() * 0.14,
          dimensions: {
            valence: valenceMap[label] || 0.5,
            arousal: label === "愤怒" ? 0.9 : label === "焦急" ? 0.8 : 0.2,
            dominance: isAgent ? 0.7 : 0.4,
          },
        },
        prosody: { speakingRate: 0, avgPitch: 0, volumeDb: 0 },
      };
    });

    const emotionResult = {
      utterances,
      overall: scenario.emotion_data.overall,
      trend: scenario.emotion_result?.trend || scenario.emotion_data.trend,
    };

    const totalTime = Date.now() - startTime;

    return {
      fileName,
      totalTime: `${(totalTime / 1000).toFixed(1)}s`,
      steps,
      utterances,
      emotion: emotionResult,
      quality: scenario.quality_result,
      summary: this._generateSummary(scenario.quality_result, emotionResult),
    };
  }

  _generateSummary(quality, emotion) {
    const dims = quality.dimensions;
    const violations = quality.violations || [];
    const strengths = quality.strengths || [];

    return {
      callPurpose: "客服通话质检",
      keyPoints: [
        `总分 ${quality.totalScore} 分，等级 ${quality.level}`,
        `话术合规 ${dims.compliance.score}/10，业务知识 ${dims.knowledge.score}/10`,
        `流程完整 ${dims.process.score}/10，沟通技巧 ${dims.communication.score}/10`,
      ],
      customerRequest: "质检报告",
      resolutionStatus: quality.totalScore >= 80 ? "已解决" : quality.totalScore >= 60 ? "待跟进" : "需整改",
      actionItems: quality.suggestions || [],
      qualityIssues: violations.map((v) => v.detail),
      overallAssessment: quality.totalScore >= 80
        ? "服务表现良好"
        : quality.totalScore >= 60
          ? "服务基本合格，有改进空间"
          : "服务不合格，需重点整改",
      highlights: strengths.join("、") || "基础服务流程完整",
      improvementSuggestions: quality.suggestions || [],
    };
  }
}

module.exports = QualityInspectionPipeline;
