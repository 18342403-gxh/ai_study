# 🤖 AI 组件生成器 — 学习计划

## 总览

本学习计划基于 **AI 组件生成器** 产品主线，从前端工程师视角系统学习如何构建 AI 驱动的 Web 应用。共 **13 个模块**，建议按顺序推进，每个模块包含理论学习和动手实践。

## 前置要求

- 熟悉 **Vue 3 + TypeScript** 基础（Composition API、SFC、Pinia）
- 了解 HTTP 请求、异步编程、浏览器事件循环
- 有一个可用的 AI API Key（智谱 AI / OpenAI 兼容接口）
- Node.js ≥ 18、pnpm ≥ 9

## 项目架构

```
┌─────────────────────────────────────────────────────────┐
│                    AI 组件生成器                          │
│  apps/generator (Nuxt 3 SSR, 产品主线 ⭐)                │
├─────────────────────────────────────────────────────────┤
│                    教学主线                               │
│  apps/web-vue-nuxt (Nuxt 3 SSR, 7 模块教学落地端)       │
├─────────────────────────────────────────────────────────┤
│                    对照参考                               │
│  apps/web-vue (Vue 3 SPA) / apps/web-react (React 18)  │
├─────────────────────────────────────────────────────────┤
│                    BFF 服务层                            │
│  apps/server (Express :3001 + LangChain 编排)            │
└─────────────────────────────────────────────────────────┘
```

## 学习路线图

```
Week 1-2          Week 3-4          Week 5-6          Week 7-8
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 模块 1   │    │ 模块 3   │    │ 模块 5   │    │ 模块 7   │
│ AI API   │───▶│ Prompt   │───▶│ Function │───▶│ AI Agent │
│ 基础调用 │    │ 工程     │    │ Calling  │    │ 编排     │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
      │               │               │               │
      ▼               ▼               ▼               ▼
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 模块 2   │    │ 模块 4   │    │ 模块 6   │    │ 模块 8   │
│ 流式响应 │    │ 多轮对话 │    │ RAG 检索 │    │ Vue3/Nuxt│
└──────────┘    └──────────┘    └──────────┘    │ 中高级   │
                                                └──────────┘
                                                      │
                                                      ▼
                                                ┌──────────┐
                                                │ 模块 9   │
                                                │ 面试题   │
                                                └──────────┘
```

## 模块概览

### 基础 AI 模块（前端视角）

| # | 模块 | 文档 | 预计时间 | 产出 |
|---|------|------|---------|------|
| 1 | AI API 基础调用 | [01-ai-api-basics.md](./01-ai-api-basics.md) | 3-4 天 | 能通过 BFF 代理调用 AI 并展示结果 |
| 2 | 流式响应 | [02-streaming.md](./02-streaming.md) | 3-4 天 | 实现 SSE 打字机效果的逐字输出 |
| 3 | Prompt 工程 | [03-prompt-engineering.md](./03-prompt-engineering.md) | 4-5 天 | 掌握组件生成器 Prompt 模板设计 |
| 4 | 多轮对话 UI | [04-chat-ui.md](./04-chat-ui.md) | 4-5 天 | 完成多会话管理与历史持久化 |
| 5 | Function Calling | [05-function-calling.md](./05-function-calling.md) | 4-5 天 | 实现工具调用与结构化输出 |
| 6 | RAG 检索增强 | [06-rag.md](./06-rag.md) | 5-7 天 | 实现模板库检索与引用溯源 |
| 7 | AI Agent 编排 | [07-ai-agent.md](./07-ai-agent.md) | 5-7 天 | 构建多步推理的 Agent 界面 |

### 全栈进阶模块（BFF + SSR + 产品主线）

| # | 模块 | 文档 | 预计时间 | 产出 |
|---|------|------|---------|------|
| 8 | Vue3/Nuxt3 中高级 | [08-vue3-nuxt-advanced.md](./08-vue3-nuxt-advanced.md) | 3-4 天 | 掌握 SSR 项目的工程化实践 |
| 9 | AI 面试题 | [09-ai-interview-questions.md](./09-ai-interview-questions.md) | 持续 | AI 产品工程师高频题覆盖 |
| 10 | Node.js BFF 服务端 | [10-nodejs-bff.md](./10-nodejs-bff.md) | 7-10 天 | Express 中间件 + AI 编排层 + RAG + Agent 状态机 |
| 11 | Vue3 网页端 | [11-vue3-web.md](./11-vue3-web.md) | 5-7 天 | AI 聊天界面 + Function Calling 可视化 + Agent 时间线 |
| 12 | Nuxt 3 SSR 主学习端 | [12-nuxt3-ssr.md](./12-nuxt3-ssr.md) | 5-7 天 | SSR 架构 + Nitro 代理 + SEO + 三端类型共享 |
| 13 | AI 组件生成器 | [13-ai-generator.md](./13-ai-generator.md) | 7-10 天 | 5 节点编排 + 代码生成 + 沙箱预览 + 迭代优化 |

## 每个模块的教学结构

每个知识点严格遵循 **7 段式讲解结构**：

```
1. 💡 JS / 💡 浏览器 / 💡 Node 基础补充（至少 1 类）
2. 🤖 AI 场景价值（在 AI 组件生成器里解决什么真实问题）
3. 📚 主线知识点原理解析
4. 💻 代码实现（项目真实业务代码）
5. 📱 C 端生产化改造（3-5 个改造点）
6. 🤝 与 React 对照（API 映射 + 实现差异）
7. 🧠 面试题 / 常见坑（AI 产品场景题 ≥ 80%）
```

## AI 主例池

所有代码示例均来自项目真实业务，禁止使用非 AI 场景 Demo：

| 业务场景 | 对应模块 | 核心技术 |
|---------|---------|---------|
| 流式打字机 + 粘包处理 | m2 | SSE / ReadableStream / AbortController |
| 多轮会话管理 | m4 | useChat / 单例模式 / 会话持久化 |
| 组件代码生成 | m1-m3 | BFF 代理 / Prompt 模板 / Token 压缩 |
| 工具调用（代码执行、模板查询） | m5 | Function Calling / Zod Schema / 安全沙箱 |
| 模板库检索 | m6 | RAG / 向量检索 / 引用溯源 |
| Agent 自动编排 | m7 | LangGraph StateGraph / Checkpointer |
| BFF 中间件管线 | m10 | Express / Logger / ErrorHandler / Zod 校验 |
| RAG 4 步流水线 | m10 | Loader / Splitter / Embeddings / VectorStore |
| Agent StateGraph | m10 | 4 节点状态机 / Human-in-the-loop |
| AI 聊天 UI | m11 | SSE / Pinia / 虚拟滚动 / 打字机效果 |
| Function Calling 可视化 | m11 | 时间线 / 参数预览 / 步骤卡片 |
| Nuxt 3 SSR 架构 | m12 | Nitro / useFetch / routeRules / SEO |
| 跨端类型共享 | m12 | packages/shared / Brand Type / Discriminated Union |
| Generator 5 节点编排 | m13 | clarify / retrieve / generate / preview / iterate |
| 代码沙箱预览 | m13 | Worker Threads / iframe sandbox / 实时预览 |

## 学习原则

1. **先跑通再优化** — 每个模块先实现最小可用版本
2. **理解数据流** — 重点关注前端与 BFF、BFF 与 AI 服务之间的数据交互
3. **动手为主** — 每个知识点都要对照项目源码验证
4. **逐步迭代** — 在前一个模块基础上扩展，最终形成完整应用
5. **对照学习** — 每个 Vue 知识点都有 React 对照表

## 最终目标

完成全部模块后，你将拥有一个功能完整的 AI 组件生成器，具备：

### AI 能力
- ✅ 流式对话生成 + 打字机效果
- ✅ 多轮上下文管理 + Token 压缩
- ✅ 工具调用（代码执行、模板查询）
- ✅ RAG 知识库检索 + 引用溯源
- ✅ Agent 多步推理 + 时间线展示
- ✅ Generator 5 节点编排（clarify → retrieve → generate → preview → iterate）

### 工程能力
- ✅ Vue3/Nuxt3 SSR 工程化实践
- ✅ Node.js BFF 服务端（Express + 中间件 + RAG + Agent）
- ✅ 跨端类型共享（monorepo + packages/shared）
- ✅ 代码沙箱预览 + 实时渲染
- ✅ AI 产品工程师面试能力

## 推荐工具和库

| 用途 | 推荐 |
|------|------|
| 前端框架 | Nuxt 3 SSR + Vue 3 |
| 状态管理 | Pinia（全局）+ Composables（局部） |
| 样式方案 | Tailwind CSS |
| AI SDK | LangChain.js / LangGraph（BFF 端） |
| 代码高亮 | Shiki |
| 数据库 | SQLite（Better-SQLite3） |
| 向量存储 | better-sqlite3 + 余弦相似度 |
| 参数校验 | Zod |
| 后端框架 | Express 5 |
| ORM | Drizzle ORM（可选） |
| 进程管理 | PM2 / Docker |
| 代码编辑 | Monaco Editor |
| TypeScript 运行时 | tsx / ts-node |
| 包管理 | pnpm (workspace) |
