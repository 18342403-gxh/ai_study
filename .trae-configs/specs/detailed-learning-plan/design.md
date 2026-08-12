# 详细学习计划 - 技术设计

## 整体架构

```
ai-frontend-lab/
├── index.html                    # viewport meta 移动端配置
├── src/
│   ├── main.tsx                  # 入口 + Router
│   ├── App.tsx                   # 路由配置 + 底部 Tab 导航
│   ├── components/               # 公共组件
│   │   ├── Layout.tsx            # 移动端全屏布局壳
│   │   ├── TabBar.tsx            # 底部导航栏
│   │   └── InterviewCard.tsx     # 面试题卡片组件
│   ├── services/
│   │   └── ai.ts                 # AI API 统一封装
│   ├── modules/
│   │   ├── 01-api-basics/        # 模块1
│   │   ├── 02-streaming/         # 模块2
│   │   ├── 03-prompt/            # 模块3
│   │   ├── 04-chat-ui/           # 模块4
│   │   ├── 05-function-calling/  # 模块5
│   │   ├── 06-rag/               # 模块6
│   │   └── 07-agent/             # 模块7
│   └── data/
│       └── interview-questions.ts # 面试题数据（按模块/知识点组织）
```

## 移动端适配方案

### viewport 配置

```html
<!-- index.html -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
```

### 布局策略

- 全屏布局：`h-screen` + `flex flex-col`
- 底部导航固定：`fixed bottom-0`，高度 56px
- 内容区域：`flex-1 overflow-y-auto pb-14`（预留底部导航空间）
- 安全区域：`pb-[env(safe-area-inset-bottom)]`

### 触摸交互规范

- 可点击元素最小尺寸：44px × 44px
- 按钮间距 ≥ 8px
- 列表项高度 ≥ 48px
- 输入框高度 ≥ 44px

## 面试题系统设计

### 数据结构

```typescript
// src/data/interview-questions.ts

interface InterviewQuestion {
  id: string                          // 唯一标识，如 "1.3-q1"
  moduleId: number                    // 所属模块 1-7
  knowledgePointId: string            // 关联知识点，如 "1.3"
  difficulty: 'junior' | 'mid' | 'senior'  // 难度
  category: 'principle' | 'coding' | 'design'  // 类型：原理/编码/设计
  question: string                    // 题目
  answerPoints: string[]              // 答案要点（数组）
  relatedCode?: string                // 关联的代码文件路径
}
```

### 面试题与知识点的关联方式

每个知识点完成后，页面底部展示关联的面试题卡片：
- 默认折叠，只显示题目和难度标签
- 点击展开查看答案要点
- 可标记「已掌握」状态（localStorage 持久化）

### 面试题卡片 UI

```
┌─────────────────────────────────┐
│ 🎯 中级 | 原理理解               │
│                                 │
│ Q: SSE 和 WebSocket 有什么区别？  │
│    各自适用什么场景？             │
│                                 │
│         [ 查看答案 ▼ ]           │
└─────────────────────────────────┘

展开后：
┌─────────────────────────────────┐
│ 🎯 中级 | 原理理解               │
│                                 │
│ Q: SSE 和 WebSocket 有什么区别？  │
│                                 │
│ 答案要点：                       │
│ • SSE 单向（服务端→客户端）       │
│ • WebSocket 双向通信             │
│ • SSE 基于 HTTP，自动重连        │
│ • AI 流式输出适合 SSE            │
│                                 │
│   [ ✅ 已掌握 ]  [ 查看答案 ▲ ]  │
└─────────────────────────────────┘
```

## 各模块页面设计

### 通用页面结构（移动端）

```
┌──────────────────────────┐
│  ← 模块 1: AI API 基础   │  ← 顶部标题栏 (44px)
├──────────────────────────┤
│                          │
│  [知识点内容区域]         │  ← 可滚动内容区
│  - 说明文字              │
│  - 代码展示              │
│  - 运行效果              │
│                          │
│  ─── 面试题 ───          │
│  [面试题卡片1]           │
│  [面试题卡片2]           │
│                          │
├──────────────────────────┤
│  📖  💬  🔧  📚  🤖    │  ← 底部 Tab 导航 (56px)
│  API 流式 Prompt 聊天 更多│
└──────────────────────────┘
```

### 模块 1 页面设计（示例）

```
ApiBasics.tsx 页面结构：
┌──────────────────────────┐
│  AI API 基础调用          │
├──────────────────────────┤
│                          │
│  输入你的问题：           │
│  ┌────────────────────┐  │
│  │                    │  │
│  └────────────────────┘  │
│                          │
│  [ 发送请求 ]            │
│                          │
│  ── 响应结果 ──          │
│  ┌────────────────────┐  │
│  │ AI 回复内容...      │  │
│  └────────────────────┘  │
│                          │
│  ── 学习面试题 ──        │
│  [面试题卡片]            │
│                          │
└──────────────────────────┘
```

### 模块 4 聊天界面设计（移动端全屏）

```
┌──────────────────────────┐
│  ← AI 聊天    [清空] [⋮] │  ← 顶部栏
├──────────────────────────┤
│                          │
│        用户消息 ──┐      │
│                   │气泡│ │
│                   └───┘  │
│  ┌───┐                   │
│  │AI │── AI 回复消息      │
│  └───┘   (Markdown渲染)  │
│                          │
│        用户消息 ──┐      │
│                   └───┘  │
│  ┌───┐                   │
│  │AI │── 流式生成中...▌   │
│  └───┘                   │
│                          │
├──────────────────────────┤
│ ┌──────────────────┐ [➤] │  ← 底部输入栏 (固定)
│ │ 输入消息...       │     │
│ └──────────────────┘     │
└──────────────────────────┘
```

## 路由设计

```typescript
// src/App.tsx
const routes = [
  { path: '/', element: <Home /> },           // 首页（模块列表）
  { path: '/m1', element: <ApiBasics /> },    // 模块1
  { path: '/m2', element: <Streaming /> },    // 模块2
  { path: '/m3', element: <PromptLab /> },    // 模块3
  { path: '/m4', element: <ChatPage /> },     // 模块4
  { path: '/m5', element: <FunctionCalling /> }, // 模块5
  { path: '/m6', element: <RagPage /> },      // 模块6
  { path: '/m7', element: <AgentPage /> },    // 模块7
]
```

## 面试题数据示例

```typescript
// src/data/interview-questions.ts（部分示例）

export const interviewQuestions: InterviewQuestion[] = [
  // 模块 1
  {
    id: '1.1-q1',
    moduleId: 1,
    knowledgePointId: '1.1',
    difficulty: 'junior',
    category: 'principle',
    question: '大模型 API 中 temperature 参数的作用是什么？设为 0 和 2 分别有什么效果？',
    answerPoints: [
      'temperature 控制输出的随机性/创造性',
      '0 = 确定性输出，每次结果几乎相同',
      '2 = 高随机性，输出更多样但可能不连贯',
      '一般推荐 0.7-1.0 平衡创造性和准确性',
    ],
  },
  {
    id: '1.3-q1',
    moduleId: 1,
    knowledgePointId: '1.3',
    difficulty: 'mid',
    category: 'coding',
    question: '如何在前端安全地管理 AI API Key？直接写在前端代码中有什么风险？',
    answerPoints: [
      '前端代码会被用户看到，API Key 会泄露',
      '推荐方案：BFF 代理层，前端只请求自己的后端',
      '开发阶段可用 .env.local + VITE_ 前缀',
      '生产环境必须通过后端转发，前端不持有 Key',
    ],
  },
  {
    id: '1.7-q1',
    moduleId: 1,
    knowledgePointId: '1.7',
    difficulty: 'mid',
    category: 'coding',
    question: '请解释 AbortController 的工作原理，如何用它实现请求超时？',
    answerPoints: [
      'AbortController 创建一个 signal 对象',
      'signal 传给 fetch 的 options',
      '调用 controller.abort() 会中断请求',
      '超时实现：setTimeout + abort()',
      '组件卸载时也应 abort 防止内存泄漏',
    ],
  },
  // 模块 2
  {
    id: '2.1-q1',
    moduleId: 2,
    knowledgePointId: '2.1',
    difficulty: 'mid',
    category: 'principle',
    question: 'SSE 和 WebSocket 有什么区别？AI 流式输出为什么选择 SSE？',
    answerPoints: [
      'SSE 单向（服务端→客户端），WebSocket 双向',
      'SSE 基于 HTTP，天然支持重连和事件类型',
      'WebSocket 需要额外的握手协议',
      'AI 输出是单向流，SSE 更轻量合适',
      'SSE 兼容性好，不需要额外服务器配置',
    ],
  },
  {
    id: '2.2-q1',
    moduleId: 2,
    knowledgePointId: '2.2',
    difficulty: 'senior',
    category: 'coding',
    question: '请手写一个 ReadableStream 的消费逻辑，处理流式 AI 响应',
    answerPoints: [
      'response.body.getReader() 获取 reader',
      'new TextDecoder() 解码二进制为文本',
      'while 循环 + reader.read() 逐块读取',
      '判断 done 为 true 时退出循环',
      '处理 chunk 可能包含多行或不完整行的情况',
    ],
  },
]
```

## 技术选型

| 用途 | 选择 | 理由 |
|------|------|------|
| 框架 | React 18 + TypeScript | 项目已有 |
| 构建 | Vite | 项目已有 |
| 样式 | Tailwind CSS | 移动端优先的 utility-first 方案 |
| 路由 | React Router v6 | 轻量、支持懒加载 |
| 状态 | Redux Toolkit | 企业级标准、DevTools、严格状态追踪 |
| Markdown | react-markdown + rehype-highlight | 成熟方案 |
| 代码高亮 | highlight.js（通过 rehype） | 体积小、语言覆盖全 |

## 开发顺序

1. **Phase 0**：项目基础设施（路由、布局、Tab 导航、面试题组件）
2. **Phase 1**：模块 1 + 模块 2（API 基础 + 流式）
3. **Phase 2**：模块 3 + 模块 4（Prompt + 聊天界面）
4. **Phase 3**：模块 5（Function Calling）
5. **Phase 4**：模块 6 + 模块 7（RAG + Agent）
6. **Phase 5**：面试题数据填充 + 整体联调
7. **Phase 6**：Monorepo 工程化改造
8. **Phase 7**：Node.js BFF 服务端开发
9. **Phase 8**：Vue3 网页端开发
10. **Phase 9**：packages/shared 公共包抽离 + 三端联调

---

## Monorepo 架构（Phase 6）

### 目录结构

```
ai_study/
├── apps/
│   ├── web-react/            # React 端（原项目，7 个学习模块）
│   │   ├── package.json      # name: "@ai-study/web-react"
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── tsconfig.json
│   │   ├── index.html
│   │   └── src/              # 原 src 完整迁移至此
│   ├── web-vue/              # Vue3 网页端（新建）
│   │   ├── package.json      # name: "@ai-study/web-vue"
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── tsconfig.json
│   │   ├── index.html
│   │   └── src/
│   └── server/               # Node.js BFF 服务端（新建）
│       ├── package.json      # name: "@ai-study/server"
│       ├── tsconfig.json
│       ├── .env.example
│       └── src/
├── packages/
│   └── shared/               # 公共类型/常量/工具
│       ├── package.json      # name: "@ai-study/shared"
│       ├── tsconfig.json
│       └── src/
│           ├── types/        # ChatRequest 等类型
│           ├── constants/    # 模型白名单等
│           └── utils/        # Token 估算、SSE 解析
├── pnpm-workspace.yaml       # pnpm workspace 配置
├── tsconfig.base.json        # 共享 TS 配置
├── package.json              # 根 package.json（scripts + workspace deps）
├── .editorconfig
├── .prettierrc
├── .eslintrc.js
├── tailwind.config.js        # 根 Tailwind 预设（可选）
└── .gitignore                # 统一忽略
```

### 技术选型更新

| 用途 | 选择 | 说明 |
|------|------|------|
| 包管理器 | **pnpm** | Workspace 原生支持、硬链接节省磁盘、严格幽灵依赖防护 |
| Node 服务端框架 | **Express** + TypeScript | 生态成熟、上手快、配合 SSE 流式非常成熟 |
| 服务端运行时 | **tsx** + nodemon(可选) | tsx 比 ts-node 快，开发友好；生产用 `tsc && node dist` |
| Vue3 路由 | **Vue Router v4** | Vue 官方路由 |
| Vue3 状态 | **Pinia** | Vue 官方推荐，替代 Vuex |
| Vue3 构建 | **Vite** + `@vitejs/plugin-vue` | 与 React 端统一构建工具 |
| 跨端通信 | **HTTP + SSE** | Web-React 和 Web-Vue 都请求 Server BFF，BFF 再调 AI 服务 |
| 包构建（shared） | 直接源码引用（初期），后续可选 `tsup` | 工作区 symlink 直接引用 TS 源文件即可 |

### 端口规划

| 项目 | 端口 | 说明 |
|------|------|------|
| apps/web-react | 5173 | React 学习端 |
| apps/web-vue | 5174 | Vue3 学习端 |
| apps/server | 3000 | BFF 服务端 |

### 根 package.json 统一脚本示例

```json
{
  "scripts": {
    "dev": "pnpm --parallel --filter @ai-study/web-react --filter @ai-study/web-vue --filter @ai-study/server dev",
    "dev:react": "pnpm --filter @ai-study/web-react dev",
    "dev:vue": "pnpm --filter @ai-study/web-vue dev",
    "dev:server": "pnpm --filter @ai-study/server dev",
    "build": "pnpm -r build",
    "build:shared": "pnpm --filter @ai-study/shared build",
    "typecheck": "pnpm -r typecheck",
    "lint": "eslint \"{apps,packages}/**/*.{ts,tsx,vue}\"",
    "format": "prettier --write \"{apps,packages}/**/*.{ts,tsx,vue,md,json}\""
  }
}
```

---

## apps/server BFF 架构设计（Phase 7）

### 请求流

```
Web (React/Vue)
     │
     ▼  /api/chat (POST)        /api/chat/stream (SSE GET/POST)
 apps/server (Express, :3000)
     │  ├─ cors middleware
     │  ├─ logger middleware
     │  ├─ routes/ai.ts
     │  └─ services/ai.ts → 调用真实 AI API (OpenAI/Azure/...)
     ▼
  AI Provider
```

### 服务端路由

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/healthz` | 健康检查，返回 { ok: true } |
| POST | `/api/chat` | 非流式聊天接口，BFF 转发给 AI Provider |
| POST/GET | `/api/chat/stream` | SSE 流式聊天接口 |
| GET | `/api/conversation/:id` | 获取会话历史（BFF 维护） |
| DELETE | `/api/conversation/:id` | 删除会话 |

### 关键类型（@ai-study/shared 共享）

```typescript
// packages/shared/src/types/chat.ts
export type Role = 'system' | 'user' | 'assistant' | 'tool';
export interface ChatMessage {
  role: Role;
  content: string;
}
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  stream?: boolean;
}
export interface ChatResponse {
  id: string;
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}
export interface SSEChunk {
  delta?: string;
  done: boolean;
  error?: string;
}
```

---

## apps/web-vue 设计（Phase 8）

### 目录结构

```
apps/web-vue/src/
├── main.ts                # 入口：createApp + Pinia + Router
├── App.vue                # 根组件
├── router/index.ts        # Vue Router 配置
├── stores/                # Pinia stores
│   └── chat.ts            # 聊天状态示例
├── composables/           # Vue composables = React Hooks
│   ├── useChat.ts         # 非流式调用
│   └── useStreaming.ts    # SSE 流式调用
├── views/                 # 页面组件
│   ├── Home.vue
│   ├── M1ApiBasics.vue
│   ├── M2Streaming.vue
│   └── M4Chat.vue
├── components/            # 子组件
│   ├── ModuleCard.vue
│   └── MessageBubble.vue
└── style.css              # Tailwind 入口
```

### 路由表

```typescript
const routes = [
  { path: '/', component: () => import('../views/Home.vue') },
  { path: '/m1', component: () => import('../views/M1ApiBasics.vue') },
  { path: '/m2', component: () => import('../views/M2Streaming.vue') },
  { path: '/m4', component: () => import('../views/M4Chat.vue') },
];
```

---

## packages/shared 设计（Phase 9）

### 导出结构

```typescript
// packages/shared/src/index.ts
export * from './types/chat';
export * from './types/rag';
export * from './types/agent';
export * from './constants/models';
export * from './constants/prompts';
export * from './utils/token';
export * from './utils/sse';
export * from './utils/id';
```

### 依赖方式

在 apps/* 中引用：
```json
// apps/web-react/package.json
"dependencies": { "@ai-study/shared": "workspace:*" }
```
```typescript
import type { ChatMessage } from '@ai-study/shared';
import { estimateTokenCount } from '@ai-study/shared';
```
