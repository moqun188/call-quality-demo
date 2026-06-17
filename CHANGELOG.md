# 📝 版本更新日志 (Changelog)

> 格式: [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)
> 版本号: [Semantic Versioning](https://semver.org/lang/zh-CN/)

---

## [Unreleased] - 开发中

### 已知问题
- statsManager.avgDimensions NaN Bug（P0-001）
- 4 次重复 API 调用（P0-002）
- uploads 目录不清理（P0-003）
- 日志无轮转（P0-004）

---

## [0.1.1] - 2026-06-17

### 修复 (Fixed)
- **BUG-005**: 修复客服/客户角色标注反转问题
  - 根因: `pipeline/diarization.js` 的 `align()` 方法硬编码 `speaker_0 = agent`，但小米 MiMo API 的说话人编号是任意的
  - 修复: 新增 `_detectRoles()` 方法，基于「第一个说话人默认为客服」+ 关键词校验自动检测角色
  - 策略: 检测到客服关键词（请问/欢迎致电/帮您等）和客户关键词（我想/退货/退款等），如果第一个说话人包含更多客户特征则自动交换角色
  - 负责人: moqun188
  - 影响范围: pipeline/diarization.js

---

## [0.1.0] - 2026-06-17

### 新增 (Added)
- 初始发布，录音质检系统 MVP
- 小米 MiMo API 集成（ASR / 说话人分离 / 情绪分析 / 通话总结）
- 4 维度质检评分（话术合规 / 业务知识 / 流程完整 / 沟通技巧）
- 多格式导出（Excel / JSON / Obsidian Markdown）
- NDJSON 流式进度推送
- Dashboard 统计面板
- ASR 测试页面
- 完整的日志系统
- GitHub 仓库: https://github.com/moqun188/call-quality-demo

### 文档 (Docs)
- 长期演进规划 (P0-P3)
- 协作开发指南
- 分支策略
- P0 任务清单
