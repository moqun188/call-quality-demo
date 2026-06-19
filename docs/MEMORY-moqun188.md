# moqun188 个人任务记忆

> 最后更新：2026-06-19
> 角色：后端/架构

---

## 已完成

| 日期 | 任务 | 版本 | 说明 |
|------|------|------|------|
| 06-17 | 项目初始化 + MVP | v0.1.0 | 全栈 |
| 06-17 | NaN Bug 修复 | v0.1.2 | statsManager |
| 06-17 | 多模态 API 优化 | v0.2.0 | 3 次→1 次 |
| 06-17 | uploads 清理 | v0.2.0 | 质检后自动删除 |
| 06-17 | 日志轮转 | v0.2.0 | 10MB + 7 天清理 |
| 06-18 | SQLite 数据库 | v0.3.0 | better-sqlite3 |
| 06-18 | 质检规则可配置化 | v0.3.2 | rulesLoader + default.json |
| 06-18 | Jest 测试框架 | v0.3.2 | 3 套件 18 测试 |
| 06-18 | ESLint + Prettier | v0.3.2 | 代码规范 |
| 06-18 | CI/CD | v0.4.0 | GitHub Actions |
| 06-18 | 批量质检队列 | v0.4.0 | batchQueue.js |
| 06-18 | 说话人角色检测重写 | v0.4.0 | 排他性模式评分 |
| 06-19 | API Key 泄露修复 | v0.5.0 | S3-001 |
| 06-19 | 堆栈泄露修复 | v0.5.0 | S3-002 |
| 06-19 | 并发写入修复 | v0.5.0 | S3-003 |
| 06-19 | Pipeline 瘦身 | v0.5.0 | 删除 emotion/diarization 独立模块 |

## 当前任务（Sprint 5）

| # | 任务 | 优先级 | 预估 |
|---|------|--------|------|
| S5-001 | 合并 asr.js + multimodalAnalyzer.js 为一个 ASR 模块 | P0 | 3h |
| S5-002 | 删除 summarizer.js | P0 | 0.5h |
| S5-003 | scenarios.js 外部化为 JSON | P0 | 1h |
| S5-005 | 质检准确率 benchmark | P0 | 2h |
| S5-006 | ASR 准确率测试 (CER) | P0 | 1h |
| S5-010 | 预处理与 API 并行化 | P1 | 2h |
| S5-011 | 相同文件缓存 | P1 | 1h |
| S5-013 | 反馈数据→规则迭代 | P2 | 3h |
| S5-014 | 多租户 + JWT 认证 | P2 | 6h |

## 待完成（Backlog）

- 多租户 + JWT 认证
- SaaS 定价模型
- 行业规则模板（电商/金融/医疗）
- 专用 ASR 模型微调
- 实时流式质检

## 技术笔记

- Pipeline 现在只有 1 次 API 调用（多模态），失败回退纯 ASR + 规则推断
- qualityAnalyzer 从外部 JSON 加载规则，支持多场景
- SQLite WAL 模式 + AUTOINCREMENT
- 批量队列支持 20 文件并发上传
