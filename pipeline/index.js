/**
 * Pipeline 编排器
 * 串联预处理 → 多模态分析（ASR+说话人+情绪）→ 质检分析
 * 
 * 优化: 优先使用单次多模态 API 调用，失败时回退到各模块独立调用
 */

require("dotenv").config();
const AudioPreprocessor = require("./preprocessor");
const ASREngine = require("./asr");
const DiarizationEngine = require("./diarization");
const EmotionAnalyzer = require("./emotion");
const MultimodalAnalyzer = require("./multimodalAnalyzer");
const QualityAnalyzer = require("./qualityAnalyzer");
const Summarizer = require("./summarizer");
const { getScenario } = require("./scenarios");
const { logger } = require("./logger");

class QualityInspectionPipeline {
  constructor(config = {}) {
    this.preprocessor = new AudioPreprocessor();
    this.asr = new ASREngine({ mockMode: config.mockMode !== false });
    this.diarization = new DiarizationEngine({ mockMode: config.mockMode !== false });
    this.emotion = new EmotionAnalyzer({ mockMode: config.mockMode !== false });
    this.multimodal = new MultimodalAnalyzer({ enableReal: config.mockMode === false });
    this.quality = new QualityAnalyzer();
    this.summarizer = new Summarizer();
    this.enableRealASR = process.env.ENABLE_REAL_ASR === "true";
  }

  // 支持进度的 run 方法，通过 onStep 回调推送进度
  async run(audioPath, fileName, scenarioId, onStep) {
    const steps = [];
    const startTime = Date.now();

    // Check if using a predefined scenario
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

    // Step 1: 预处理 + 统一格式转换（所有后续模块复用转换后的 mp3）
    await notify(0, "processing");
    const preprocResult = await this.preprocessor.process(audioPath);
    const effectiveAudioPath = preprocResult.convertedPath || audioPath;
    await notify(0, "completed", `${preprocResult.sampleRate / 1000}kHz / ${preprocResult.channels}ch` +
      (preprocResult.convertedPath ? "（已转码，后续模块复用）" : ""));

    // Step 2-4: 优先尝试多模态单次调用（ASR + 说话人 + 情绪）
    let emotionResult;
    let usedMultimodal = false;

    const multimodalResult = await this.multimodal.analyze(effectiveAudioPath);

    if (multimodalResult) {
      // 多模态调用成功！一次完成 ASR + 说话人 + 情绪
      usedMultimodal = true;
      logger.info(`[Pipeline] 使用多模态单次调用，节省 2 次 API 请求`);

      // 更新步骤状态（一次性标记完成）
      await notify(1, "completed", `多模态识别 ${multimodalResult.utterances.length} 句`);
      await notify(2, "completed", `多模态说话人识别完成`);
      await notify(3, "completed", multimodalResult.overall);

      emotionResult = {
        utterances: multimodalResult.utterances,
        overall: multimodalResult.overall,
        trend: multimodalResult.trend,
      };
    } else {
      // 回退到各模块独立调用
      logger.info("[Pipeline] 多模态调用未成功，回退到各模块独立调用");

      // Step 2: ASR 转写
      await notify(1, "processing");
      const asrResult = await this.asr.transcribe(effectiveAudioPath);
      if (this.asr.mockMode) {
        const corrected = this.asr.applyHotwordCorrection(asrResult.segments);
        asrResult.segments = corrected;
      }
      await notify(1, "completed", `识别 ${asrResult.segments.length} 句，${asrResult.duration.toFixed(1)}s`);

      // Step 3: 说话人分离
      await notify(2, "processing");
      const diarResult = await this.diarization.diarize(effectiveAudioPath);
      const utterances = this.diarization.align(asrResult.segments, diarResult.segments);
      await notify(2, "completed", `检出 ${diarResult.numSpeakers} 人，${diarResult.segments.length} 段`);

      // Step 4: 情绪分析
      await notify(3, "processing");
      emotionResult = await this.emotion.analyze(effectiveAudioPath, utterances);
      await notify(3, "completed", emotionResult.overall);
    }

    // Step 5: 通话总结生成
    await notify(4, "processing");
    const summaryResult = await this.summarizer.summarize(emotionResult.utterances, emotionResult);
    await notify(4, "completed", summaryResult.callPurpose || "总结生成完成");

    // Step 6: 质检评分
    await notify(5, "processing");
    const qualityResult = await this.quality.evaluate(emotionResult.utterances, emotionResult);
    await notify(5, "completed", `总分 ${qualityResult.totalScore} 分，等级 ${qualityResult.level}`);

    const totalTime = Date.now() - startTime;

    return {
      fileName,
      totalTime: `${(totalTime / 1000).toFixed(1)}s`,
      steps,
      utterances: emotionResult.utterances,
      emotion: emotionResult,
      quality: qualityResult,
      summary: summaryResult,
      callSummary: this._generateCallSummary(summaryResult),
      usedMultimodal,
      apiCallCount: usedMultimodal ? 2 : 5, // 多模态: 1次音频+1次文本=2次; 传统: 3次音频+1次文本+1次预处理=5次
    };
  }

  _stepName(logicalIndex) {
    const names = [
      "音频预处理",
      "语音转写 (ASR)",
      "说话人分离",
      "情绪分析",
      "通话总结生成",
      "质检评分",
    ];
    return names[logicalIndex] || "未知步骤";
  }

  async _runScenario(scenario, fileName, startTime, onStep) {
    const steps = [];
    const totalDuration = scenario.asr_segments[scenario.asr_segments.length - 1].end;

    // Simulate pipeline steps
    const scenarioSteps = [
      { name: "音频预处理", detail: "48kHz / 1ch" },
      { name: "语音转写 (ASR)", detail: `识别 ${scenario.asr_segments.length} 句，${totalDuration.toFixed(1)}s` },
      { name: "说话人分离", detail: `检出 2 人，${scenario.diarization_segments.length} 段` },
      { name: "语气语调分析", detail: scenario.emotion_data.overall },
      { name: "通话总结生成", detail: "总结生成完成" },
    ];

    const q = scenario.quality_result;
    scenarioSteps.push({ name: "质检评分", detail: `总分 ${q.totalScore} 分，等级 ${q.level}` });

    for (let i = 0; i < scenarioSteps.length; i++) {
      steps[i] = { ...scenarioSteps[i], status: "completed" };
      if (onStep) onStep(i, { ...scenarioSteps[i], status: "completed" });
    }

    // Build utterances with emotion data
    const utterances = scenario.asr_segments.map((asr) => {
      const diar = scenario.diarization_segments.find(
        (d) => Math.abs((d.start + d.end) / 2 - (asr.start + asr.end) / 2) < 1
      );
      const role = diar && diar.speaker === "speaker_0" ? "agent" : "customer";
      const isAgent = role === "agent";
      const agentIdx = scenario.asr_segments
        .slice(0, asr.id + 1)
        .filter((s) => {
          const d = scenario.diarization_segments.find(
            (dd) => Math.abs((dd.start + dd.end) / 2 - (s.start + s.end) / 2) < 1
          );
          return d && d.speaker === "speaker_0";
        }).length - 1;
      const custIdx = scenario.asr_segments
        .slice(0, asr.id + 1)
        .filter((s) => {
          const d = scenario.diarization_segments.find(
            (dd) => Math.abs((dd.start + dd.end) / 2 - (s.start + s.end) / 2) < 1
          );
          return d && d.speaker === "speaker_1";
        }).length - 1;

      const emotionPool = isAgent ? scenario.emotion_data.agent : scenario.emotion_data.customer;
      const eIdx = isAgent ? agentIdx : custIdx;
      const label = emotionPool[eIdx] || "平静";

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
            arousal: label === "愤怒" ? 0.9 : label === "焦急" ? 0.8 : label === "平静" ? 0.2 : 0.4,
            dominance: isAgent ? 0.7 : 0.4,
          },
        },
        prosody: {
          speakingRate: isAgent ? 3.5 + Math.random() : 4.0 + Math.random(),
          avgPitch: isAgent ? 200 + Math.random() * 30 : 220 + Math.random() * 40,
          volumeDb: -18 + Math.random() * 6,
        },
      };
    });

    const emotionResult = {
      utterances,
      overall: scenario.emotion_data.overall,
      trend: scenario.emotion_result ? scenario.emotion_result.trend : scenario.emotion_data.trend,
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
    return {
      title: `${quality.level}级 — ${quality.totalScore}分`,
      verdict: quality.totalScore >= 80 ? "服务表现良好" : quality.totalScore >= 60 ? "服务基本合格，有改进空间" : "服务不合格，需重点整改",
      highlights: [
        `话术合规: ${dims.compliance.score}/10 — ${dims.compliance.reason}`,
        `业务知识: ${dims.knowledge.score}/10 — ${dims.knowledge.reason}`,
        `流程完整: ${dims.process.score}/10 — ${dims.process.reason}`,
        `沟通技巧: ${dims.communication.score}/10 — ${dims.communication.reason}`,
      ],
      emotionSummary: emotion.overall,
    };
  }

  _generateCallSummary(summary) {
    if (!summary) return null;
    return {
      callPurpose: summary.callPurpose || "未知",
      keyPoints: summary.keyPoints || [],
      customerRequest: summary.customerRequest || "",
      resolutionStatus: summary.resolutionStatus || "未知",
      actionItems: summary.actionItems || [],
      qualityIssues: summary.qualityIssues || [],
      overallAssessment: summary.overallAssessment || "",
      highlights: summary.highlights || "",
      improvementSuggestions: summary.improvementSuggestions || [],
    };
  }
}

module.exports = QualityInspectionPipeline;
