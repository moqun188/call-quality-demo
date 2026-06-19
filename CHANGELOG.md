# 📝 版本更新日志 (Changelog)

> 格式: [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)
> 版本号: [Semantic Versioning](https://semver.org/lang/zh-CN/)

---

## [0.5.0] - 2026-06-19

### 架构瘦身（三视角优化：马斯克+乔布斯+Karpathy）

**马斯克刀 — 砍成本：**
- 删除独立情绪分析模块 (`pipeline/emotion.js`)，合并到多模态调用
- 删除独立说话人分离模块 (`pipeline/diarization.js`)，合并到多模态调用
- API 调用从 5 次降到 1 次（只保留多模态 ASR）
- 失败回退改为纯 ASR + 规则推断，不再有独立 API 调用

**乔布斯刀 — 砍功能：**
- 删除 Obsidian 导出 (`pipeline/obsidianExporter.js`)
- 删除自我进化引擎 (`pipeline/selfEvolution.js`, `public/evolution.html`)
- 删除 Token 用量统计页 (`public/token-usage.html`)
- 删除更新日志页 (`public/whats-new.html`)
- 删除 ASR 测试页 (`public/asr-test.html`)
- 前端页面从 7 个减到 3 个（首页、Dashboard、批量质检）
- 只保留 Excel 导出，JSON 导出移除

**Karpathy刀 — 简化抽象层：**
- Pipeline 从 6 步简化为 5 步
- 总结生成改为模板化（零 API 调用）
- 回退模式：纯 ASR + 规则推断，不假装有情绪分析
- 代码量减少 ~30%（-2649 行）

### 新增 (Added)
- 产品方向审查报告 (`docs/REVIEW-产品方向审查-20260619.md`)
- 技术架构审查报告 (`docs/REVIEW-技术架构审查-20260619.md`)
- Sprint 4 三视角优化任务看板 (`docs/TASK-BOARD-SPRINT4-三视角优化.md`)
- 蒸馏视角技能库：马斯克、乔布斯、张一鸣、张雪峰、Karpathy

### 修复 (Fixed)
- API Key 泄露：移除 `/api/test/asr` 响应中的 key 输出
- 错误堆栈泄露：生产环境 catch 块不返回 `err.stack`
- statsManager 并发写入：改用 SQLite `lastInsertRowid`

### 变更 (Changed)
- 产品定位确认：面向中小企业的 AI 客服质检 SaaS 工具
- 质检评分基准分从 7 降至 5，礼貌用语频次加权
- README 标题改为「CallQ — AI 客服质检 SaaS 工具」

---

## [0.4.0] - 2026-06-18

### 新增 (Added)
- **自我进化引擎** (`pipeline/selfEvolution.js`): 基于历史数据自动分析趋势、发现规则盲区、生成优化建议
- **What's New 页面** (`public/whats-new.html`): 系统更新日志时间线展示
- **自我进化仪表盘** (`public/evolution.html`): 趋势概览、维度分析、等级分布、规则有效性、盲区发现
- **春苗热线质检规则** (`rules/chunmiao-hotline.json`): 基金会热线初筛场景专属规则
- **热线话术标准版** (`obsidian-vault/qa/热线初筛话术FAQ（标准版）.md`): 合并两份文档
- **疑问清单** (`obsidian-vault/qa/疑问清单 - 待团队确认.md`): 5 个遗留疑问 + 4 个文档优化建议
- API `/api/evolution`: 自我进化洞察接口
- 首页导航新增"自我进化"和"更新日志"入口

---

## [0.3.2] - 2026-06-18

### 新增 (Added)
- **质检规则可配置化**: `rules/default.json` 外部 JSON 规则配置
- `pipeline/rulesLoader.js`: 规则加载器（支持引用解析 `$standards.opening`）
- **Obsidian 知识库增强**: frontmatter Dataview 字段、质检仪表盘自动汇总、wikilinks 内链
- API `/api/rules`、`/api/rules/:name`: 规则管理端点
- 质检接口支持 `ruleName` 参数指定规则

### 重构 (Refactored)
- `pipeline/qualityAnalyzer.js`: 从硬编码改为读取外部规则
- 移除 `server.js` 全局 pipeline 实例，改为按请求创建

---

## [0.3.1] - 2026-06-18

### 新增 (Added)
- **ESLint + Prettier**: `eslint.config.js` (v10 flat config) + `.prettierrc`
- npm scripts: `lint` / `lint:fix` / `format` / `format:check`
- **Jest 测试框架**: `jest.config.js` + 3 套件 18 测试
  - `tests/logger.test.js`: Logger 日志级别/sessionId/文件写入 (6 tests)
  - `tests/database.test.js`: 表创建/索引/CRUD (6 tests)
  - `tests/statsManager.test.js`: addInspection/getStats/getHistory/getTokenStats (6 tests)
- npm scripts: `test` / `test:watch` / `test:coverage`

### 修复 (Fixed)
- 修复 8 个 ESLint error (eqeqeq, no-empty, no-useless-escape, no-useless-assignment)

---

## [0.3.0] - 2026-06-17

### 新增 (Added)
- **SQLite 数据库** (`pipeline/database.js`): better-sqlite3 替换 JSON 文件存储
- 两张表: `inspections` + `token_usage`
- WAL 模式 + 索引优化
- 自动迁移已有 JSON 数据并备份为 `.bak`
- `pipeline/statsManager.js`: 从 JSON 文件迁移到 SQLite

---

## [0.2.0] - 2026-06-17

### 优化 (Changed)
- **P0-002**: 合并 ASR + 说话人分离 + 情绪分析为单次多模态 API 调用
  - 新增 `pipeline/multimodalAnalyzer.js`
  - API 调用次数从 3 次 → 2 次，节省 60%+ Credits

### 修复 (Fixed)
- **P0-001**: statsManager NaN Bug (`r.dimensions[k]?.score`)
- **P0-003**: uploads 质检成功后自动清理
- **P0-004**: 日志轮转 10MB + sessionId + 7天清理

### 新增 (Added)
- Token 用量统计页面 (`/token-usage.html`)

---

## [0.1.2] - 2026-06-17

### 修复 (Fixed)
- **BUG-005**: 客服/客户角色标注反转 — 双说话人关键词得分比较策略

---

## [0.1.0] - 2026-06-17

### 新增 (Added)
- 初始发布，录音质检系统 MVP
- 小米 MiMo API 集成（ASR / 说话人分离 / 情绪分析 / 通话总结）
- 4 维度质检评分（话术合规 / 业务知识 / 流程完整 / 沟通技巧）
- 多格式导出（Excel / JSON / Obsidian Markdown）
- NDJSON 流式进度推送
- Dashboard 统计面板
