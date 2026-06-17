# 📞 录音质检系统 MVP Demo

基于 Node.js + 小米 MiMo API 的客服录音质检系统。

## ✨ 功能特性

- 🎙️ **语音转写 (ASR)** - 支持多种音频格式（wav/mp3/m4a/ogg/flac）
- 👥 **说话人分离** - 自动识别客服和客户
- 😊 **情绪分析** - 逐句情绪标签 + 整体趋势
- 📝 **通话总结** - LLM 生成结构化总结
- 📊 **质检评分** - 4 维度评分（话术合规/业务知识/流程完整/沟通技巧）
- 📤 **多格式导出** - Excel / JSON / Obsidian Markdown
- 📈 **Dashboard 统计** - 可视化质检数据

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的小米 MiMo API Key：

```env
MIMO_API_KEY=tp-your-api-key-here
```

### 3. 启动服务

```bash
npm run dev
```

### 4. 访问页面

- 主页面: http://localhost:3000
- Dashboard: http://localhost:3000/dashboard.html
- ASR 测试: http://localhost:3000/asr-test.html

## 📁 项目结构

```
tracecode/
├── pipeline/              # 核心处理模块
│   ├── index.js           # Pipeline 编排器
│   ├── asr.js             # ASR 转写
│   ├── diarization.js     # 说话人分离
│   ├── emotion.js         # 情绪分析
│   ├── summarizer.js      # 通话总结
│   ├── qualityAnalyzer.js # 质检评分
│   ├── preprocessor.js    # 音频预处理
│   ├── audioConverter.js  # 格式转换
│   ├── statsManager.js    # 统计管理
│   ├── logger.js          # 日志系统
│   └── obsidianExporter.js# Obsidian 导出
├── public/                # 前端文件
│   ├── index.html         # 主页面
│   ├── dashboard.html     # 统计面板
│   ├── asr-test.html      # ASR 测试页
│   └── *.js/*.css         # 前端脚本和样式
├── obsidian-vault/        # Obsidian 知识库
├── uploads/               # 上传文件（运行时）
├── logs/                  # 日志文件（运行时）
├── server.js              # Express 服务入口
└── package.json           # 项目配置
```

## 🔧 配置说明

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MIMO_API_KEY` | 小米 MiMo API Key | - |
| `MIMO_BASE_URL` | API 地址 | `https://token-plan-cn.xiaomimimo.com/v1` |
| `ASR_MODEL` | ASR 模型 | `mimo-v2.5-asr` |
| `EMOTION_MODEL` | 情绪分析模型 | `mimo-v2.5-pro` |
| `ENABLE_REAL_ASR` | 启用真实 ASR | `true` |
| `ENABLE_REAL_DIARIZATION` | 启用真实说话人分离 | `true` |
| `ENABLE_REAL_EMOTION` | 启用真实情绪分析 | `true` |
| `ENABLE_REAL_SUMMARY` | 启用真实通话总结 | `true` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `PORT` | 服务端口 | `3000` |

### Mock 模式

如果没有 API Key，可以设置 `ENABLE_REAL_*=false` 使用模拟数据演示功能。

## 📖 API 文档

### POST /api/inspect

上传音频进行质检。

**Request:**
- Content-Type: `multipart/form-data`
- Body: `audio` (音频文件)

**Response:** NDJSON 流式响应

```json
{"type": "step", "stepIndex": 0, "step": {"name": "音频预处理", "status": "processing"}}
{"type": "step", "stepIndex": 0, "step": {"name": "音频预处理", "status": "completed"}}
...
{"type": "complete", "success": true, "data": {...}}
```

### GET /api/stats

获取质检统计数据。

### GET /api/history

获取质检历史记录。

### POST /api/export/obsidian

导出质检报告到 Obsidian。

## 🛠️ 开发指南

参见 [CONTRIBUTING.md](./CONTRIBUTING.md)

## 📋 已知问题

参见 [obsidian-vault/已知问题速查.md](./obsidian-vault/已知问题速查.md)

## 📄 License

MIT
