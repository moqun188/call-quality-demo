# 协作开发指南

## 分支策略

```
main        - 生产环境，稳定版本
  └── dev   - 开发环境，集成测试
       ├── feature/xxx  - 新功能开发
       ├── bugfix/xxx   - Bug 修复
       └── refactor/xxx - 重构优化
```

## 工作流程

### 1. 开始新任务
```bash
# 从 dev 创建功能分支
git checkout dev
git pull origin dev
git checkout -b feature/你的功能名称
```

### 2. 开发过程中
```bash
# 频繁提交小改动
git add .
git commit -m "feat: 添加 xxx 功能"

# 定期同步 dev 分支
git fetch origin
git rebase origin/dev
```

### 3. 完成开发
```bash
# 推送到远程
git push origin feature/你的功能名称

# 在 GitHub 创建 Pull Request 到 dev 分支
# 等待代码审查后合并
```

## Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Type 类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | feat(asr): 添加音频缓存功能 |
| `fix` | Bug 修复 | fix(stats): 修复 avgDimensions NaN 问题 |
| `docs` | 文档更新 | docs: 更新 README |
| `style` | 代码格式（不影响功能） | style: 格式化代码 |
| `refactor` | 重构 | refactor(pipeline): 合并 API 调用 |
| `perf` | 性能优化 | perf: 添加 MD5 缓存 |
| `test` | 测试相关 | test: 添加 ASR 单元测试 |
| `chore` | 构建/工具相关 | chore: 更新依赖 |

### Scope 范围

- `asr` - ASR 模块
- `diarization` - 说话人分离
- `emotion` - 情绪分析
- `summarizer` - 通话总结
- `quality` - 质检评分
- `api` - 后端接口
- `ui` - 前端界面
- `docs` - 文档

## 代码审查清单

提交 PR 前，请确认：

- [ ] 代码风格一致
- [ ] 添加必要的注释
- [ ] 更新相关文档
- [ ] 测试通过
- [ ] 无敏感信息（API Key 等）

## 环境配置

```bash
# 1. 克隆仓库
git clone <repo-url>
cd call-quality-demo

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入你的 API Key

# 4. 启动服务
npm run dev
```

## 联系方式

如有问题，请在 GitHub Issues 中提出。
