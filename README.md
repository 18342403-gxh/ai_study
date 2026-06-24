# AI 前端开发实验室

前端 AI 应用开发学习项目 + 企业级知识库系统。以移动端 Web 为呈现形式，覆盖 AI 前端开发全链路。

## 快速启动

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装依赖

```bash
# 前端依赖
npm install

# 后端依赖
cd server && npm install && cd ..
```

### 配置环境变量

```bash
# 前端（已有 .env.example 模板）
cp .env.example .env.local
# 编辑 .env.local 填入你的 API Key

# 后端
cp server/.env.example server/.env
# 编辑 server/.env 填入你的 API Key
```

### 启动项目

```bash
# 一键启动前端 + 后端（推荐）
npm run dev:all

# 单独启动前端
npm run dev

# 单独启动后端
npm run dev:server
```

启动后：
- 前端：http://localhost:5173
- 后端：http://localhost:3001
- 健康检查：http://localhost:3001/api/health

## 项目结构

```
ai-frontend-lab/
├── src/                          # 前端源码
│   ├── main.tsx                  # 入口（BrowserRouter + Redux Provider）
│   ├── App.tsx                   # 路由配置 + TabBar
│   ├── components/               # 公共组件
│   │   ├── Layout.tsx            # 移动端布局壳
│   │   ├── TabBar.tsx            # 底部导航
│   │   ├── InterviewCard.tsx     # 面试题卡片
│   │   ├── MarkdownRenderer.tsx  # Markdown 渲染
│   │   └── CodeBlock.tsx         # 代码块（高亮+复制）
│   ├── store/                    # Redux Toolkit 状态管理
│   │   ├── index.ts              # Store 配置
│   │   └── chatSlice.ts          # 聊天状态 Slice
│   ├── services/
│   │   └── ai.ts                 # AI API 统一封装
│   ├── modules/                  # 学习模块
│   │   ├── 01-api-basics/        # API 基础调用
│   │   ├── 02-streaming/         # 流式响应
│   │   ├── 03-prompt/            # Prompt 工程
│   │   ├── 04-chat-ui/           # 聊天界面
│   │   ├── 05-function-calling/  # Function Calling
│   │   ├── 06-rag/              # RAG 前端集成
│   │   └── 07-agent/            # AI Agent
│   └── data/
│       └── interview-questions.ts # 面试题数据（36道）
├── server/                       # Node BFF 中间层
│   ├── src/
│   │   ├── index.ts              # Express 入口
│   │   ├── db/index.ts           # SQLite 数据库
│   │   ├── services/
│   │   │   ├── embedding.ts      # Embedding 向量化
│   │   │   └── chunker.ts        # 文档分块
│   │   └── routes/
│   │       ├── documents.ts      # 文档管理 API
│   │       ├── kb.ts             # 知识库问答 API
│   │       └── chat.ts           # AI 聊天代理
│   ├── data/                     # SQLite 数据文件
│   └── uploads/                  # 上传文件存储
├── docs/                         # 学习文档
└── .kiro/                        # Kiro 配置（specs + steering）
```

## 技术栈

### 前端

| 用途 | 技术 |
|------|------|
| 框架 | React 18 + TypeScript |
| 构建 | Vite 5 |
| 样式 | Tailwind CSS 4（暗色科技主题） |
| 路由 | React Router v7（懒加载） |
| 状态管理 | Redux Toolkit + react-redux |
| UI 组件 | antd-mobile + antd-mobile-icons |
| Markdown | react-markdown + remark-gfm |
| 代码规范 | ESLint + pre-commit hook |

### 后端

| 用途 | 技术 |
|------|------|
| 框架 | Express + TypeScript |
| 数据库 | SQLite (better-sqlite3) |
| 向量化 | 智谱 Embedding API |
| 文档解析 | pdf-parse + 原生文本读取 |
| 热重载 | tsx watch |

### AI 服务

| 用途 | 服务 |
|------|------|
| 聊天/Agent | 智谱 glm-4-flash（免费） |
| Embedding | 智谱 embedding-3 |

## 可用命令

| 命令 | 说明 |
|------|------|
| `npm run dev:all` | 一键启动前端 + 后端 |
| `npm run dev` | 仅启动前端 |
| `npm run dev:server` | 仅启动后端 |
| `npm run build` | 构建前端（tsc + vite build） |
| `npm run lint` | ESLint 代码检查 |
| `npm run lint:fix` | ESLint 自动修复 |
| `npm run check` | lint + build 完整检查 |

## 学习模块

| # | 模块 | 核心知识点 | 面试题 |
|---|------|-----------|--------|
| 1 | AI API 基础 | fetch 封装、AbortController、错误处理 | 5 道 |
| 2 | 流式响应 | SSE、ReadableStream、粘包处理 | 4 道 |
| 3 | Prompt 工程 | System Prompt、多轮对话、滑动窗口 | 4 道 |
| 4 | 聊天界面 | Redux、Markdown 渲染、自动滚动 | 7 道 |
| 5 | Function Calling | 工具 Schema、执行编排、多步链 | 4 道 |
| 6 | RAG 集成 | 文件上传、向量检索、引用展示 | 8 道 |
| 7 | AI Agent | Think-Act-Observe、时间线 UI | 4 道 |

总计 **36 道面试题**，全部包含完整标准回答。

## 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/documents/upload` | 上传文档（multipart/form-data） |
| GET | `/api/documents` | 获取文档列表 |
| DELETE | `/api/documents/:id` | 删除文档 |
| POST | `/api/kb/query` | 知识库问答（向量检索+流式回答） |
| POST | `/api/chat/completions` | AI 聊天代理（隐藏 Key） |
