# 🧠 AI Frontend Lab

> 面向 AI 时代的前端工程实践平台 — 从底层原理到企业级产品，完整覆盖 AI 应用前端开发全链路。

---

## ✨ 项目亮点

- **生产级架构** — React 18 + TypeScript + Redux Toolkit + Node BFF，企业标准技术栈
- **真实 AI 能力** — 对接智谱 AI 大模型，支持流式对话、Function Calling、RAG 知识库
- **企业级知识库** — 文档上传 → 向量化 → 语义检索 → 智能问答，完整 RAG Pipeline
- **AI Agent 系统** — Think-Act-Observe 循环，多步工具调用，时间线可视化
- **36 道面试题** — 覆盖 AI 前端开发高频考点，含完整标准回答

---

## 🚀 快速开始

```bash
# 克隆项目
git clone https://github.com/18342403-gxh/ai_study.git
cd ai-frontend-lab

# 安装依赖
npm install && cd server && npm install && cd ..

# 配置环境变量
cp .env.example .env.local
cp server/.env.example server/.env
# 编辑填入你的 API Key

# 一键启动
npm run dev:all
```

启动后访问 http://localhost:5173

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────┐
│                   前端 (React)                    │
│  Vite · TypeScript · Tailwind · Redux Toolkit    │
│  antd-mobile · react-markdown · SSE Stream       │
└──────────────────────┬──────────────────────────┘
                       │ HTTP / SSE
┌──────────────────────▼──────────────────────────┐
│               Node BFF 中间层                     │
│  Express · SQLite · Embedding · 向量检索          │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│              智谱 AI (GLM-4-Flash)               │
│  Chat Completions · Function Calling · Embedding │
└─────────────────────────────────────────────────┘
```

---

## 📦 核心模块

| 模块 | 能力 | 技术关键词 |
|------|------|-----------|
| **API 基础** | 大模型 API 调用全流程 | fetch · AbortController · 错误分类 |
| **流式响应** | SSE 实时打字机效果 | ReadableStream · TextDecoder · 状态机 |
| **Prompt 工程** | 多轮对话 + Token 管理 | System Prompt · 滑动窗口 · JSON Mode |
| **聊天界面** | 产品级 Chat UI | Redux · Markdown · IntersectionObserver |
| **Function Calling** | AI 调用工具执行操作 | Tool Schema · 执行编排 · 多步链 |
| **RAG 集成** | 基于文档的智能问答 | 向量检索 · 文档分块 · 引用追踪 |
| **AI Agent** | 自主多步推理和执行 | Think-Act-Observe · 时间线 · 流式回答 |
| **知识库** | 企业级文档问答系统 | Node BFF · SQLite · Embedding · SSE |

---

## 🛠️ 命令速查

| 命令 | 说明 |
|------|------|
| `npm run dev:all` | 一键启动前端 + 后端 |
| `npm run dev` | 仅启动前端 (5173) |
| `npm run dev:server` | 仅启动后端 (3001) |
| `npm run build` | 生产构建 |
| `npm run lint` | 代码规范检查 |
| `npm run check` | 完整质量检查 (lint + build) |

---

## 🧩 后端 API

| 端点 | 说明 |
|------|------|
| `POST /api/documents/upload` | 上传文档（自动分块 + 向量化） |
| `GET /api/documents` | 文档列表 |
| `DELETE /api/documents/:id` | 删除文档 |
| `POST /api/kb/query` | 知识库问答（SSE 流式） |
| `POST /api/chat/completions` | AI 聊天代理 |

---

## 📚 面试题库

涵盖 7 大模块 **36 道**高频面试题，覆盖：

- 原理理解（SSE vs WebSocket、Redux 三原则、RAG 架构）
- 代码实现（手写 ReadableStream、AbortController 超时、textarea 自适应）
- 场景设计（Token 超限方案、Agent 系统设计、检索优化策略）

每道题均包含完整标准回答，可直接用于面试准备。

---

## 📄 License

MIT
