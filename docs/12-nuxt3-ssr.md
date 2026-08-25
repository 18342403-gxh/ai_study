# Phase 9：Nuxt 3 SSR — AI 组件生成器主学习端

## 学习目标

- 理解 Nuxt 3 SSR 的架构优势：为什么选择 SSR 作为 AI 产品主线
- 掌握 Nuxt 3 核心概念：文件路由、布局、数据获取、状态管理
- 实现 Nitro Server 作为 BFF 透明转发层：server/api/ 路由
- 构建 SEO 友好的 AI 应用：动态 meta、结构化数据、爬虫优化
- 理解 SSR 与 CSR 的混合渲染策略：首屏 SSR + 交互 CSR

---

## 知识点

### 9.1 Nuxt 3 SSR 架构与核心概念

#### 💡 Node 基础补充 C.9：ESM 模块与动态 import

Nuxt 3 基于 Vite，默认 ESM。`import.meta` 在 ESM 中有特殊含义：

```typescript
// 动态 import 实现代码分割（Nuxt 自动处理）
const HeavyEditor = await import('./components/HeavyEditor.vue')

// import.meta.env 在 Nuxt 中自动暴露环境变量
const apiBase = import.meta.env.VITE_API_BASE

// Nuxt 特有：useRuntimeConfig() 同时在服务端和客户端可用
const config = useRuntimeConfig()
const apiKey = config.public.apiKey  // 客户端可见的配置
const secret = config.secretKey       // 仅服务端可见的配置
```

#### 💡 JS 基础补充 A.1：Proxy 响应式原理

Nuxt 3 使用 Vue 3 的 Proxy 响应式系统（替代 Vue 2 的 Object.defineProperty）：
- **优势**：能监听新增/删除属性、数组索引修改、`Map/Set` 变化
- **性能**：Proxy 懒初始化，只在访问时才做代理

#### 🤖 AI 场景价值

Nuxt 3 SSR 在 AI 产品中的独特优势：
1. **首屏更快**：AI 产品首页不需要等 JS 加载完才显示，服务器直接渲染
2. **SEO 友好**：AI 生成的内容（如组件模板展示）可被搜索引擎索引
3. **分享友好**：用户分享链接时，卡片摘要包含实际内容而非空壳
4. **Nitro Server 转发**：Nuxt 内置的 server/api 层可做 BFF 透明代理，减少跨域问题
5. **同构开发**：`useFetch` / `useAsyncData` 一套代码在服务端和客户端都能跑

#### 📚 主线知识点原理解析

**Nuxt 3 项目结构**：

```
apps/web-vue-nuxt/
├── nuxt.config.ts              # Nuxt 配置（含 Nitro 配置）
├── app.vue                     # 根组件
├── layouts/
│   ├── default.vue             # 主布局（侧边栏 + 聊天区）
│   └── auth.vue                # 登录布局
├── pages/
│   ├── index.vue               # 首页（重定向到 /chat）
│   ├── chat/
│   │   ├── index.vue           # 聊天列表
│   │   └── [sessionId].vue     # 单个会话
│   ├── generator/
│   │   ├── index.vue           # 组件生成器首页
│   │   └── [jobId].vue         # 生成任务详情
│   └── rag/
│       ├── documents.vue        # 文档管理
│       └── query.vue           # RAG 问答
├── components/
│   ├── chat/                   # 聊天相关组件
│   ├── generator/              # 生成器相关组件
│   └── common/                 # 通用组件
├── composables/                # 复用逻辑
│   ├── useSSE.ts
│   ├── useChat.ts
│   └── useAgent.ts
├── stores/                     # Pinia 状态
│   ├── chat.ts
│   └── generator.ts
├── server/api/                 # Nitro Server 路由
│   ├── chat/
│   │   └── completions.post.ts # AI 聊天代理
│   ├── rag/
│   │   ├── documents.post.ts   # 文档上传代理
│   │   └── query.post.ts       # RAG 问答代理
│   ├── tools/
│   │   ├── list.get.ts         # 工具列表代理
│   │   └── execute.post.ts     # 工具执行代理
│   └── agent/
│       ├── run.post.ts         # Agent 执行代理
│       └── [threadId]/
│           ├── pause.post.ts
│           └── resume.post.ts
├── middleware/                 # 路由中间件
│   └── auth.ts                 # 登录校验
└── plugins/                    # 插件
    └── pinia.ts                # Pinia 持久化
```

#### 💻 代码实现

**1. `nuxt.config.ts` — 核心配置**

```typescript
/**
 * 知识点 14.1：Nuxt 配置
 * 
 * 学习要点：
 * - modules: 引入 Pinia、Tailwind
 * - runtimeConfig: 区分 public（客户端可见）和 secret（仅服务端）
 * - nitro: 配置 BFF 代理转发规则
 */

export default defineNuxtConfig({
  devtools: { enabled: true },

  modules: [
    '@pinia/nuxt',
    '@nuxtjs/tailwindcss',
    '@vueuse/nuxt',
  ],

  // 环境变量（区分客户端可见 vs 仅服务端）
  runtimeConfig: {
    // 📝 面试考点：public 中的变量会暴露到客户端 Bundle
    // 所以 API Key 绝不能放 public 里
    public: {
      appName: 'AI 组件生成器',
      appVersion: '1.0.0',
      apiBase: process.env.NUXT_PUBLIC_API_BASE || 'http://localhost:3001',
    },
    // 仅服务端可见（不会打包到客户端）
    secretKey: process.env.SECRET_KEY,
  },

  // Nitro Server 配置（BFF 代理）
  nitro: {
    routeRules: {
      // API 请求直接转发到 BFF（不走 Nitro 业务逻辑）
      '/api/**': {
        proxy: 'http://localhost:3001/api/**',
      },
    },
  },

  // SSR 渲染配置
  ssr: true,

  // 页面 head/meta
  app: {
    head: {
      title: 'AI 组件生成器',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'AI 驱动的 Vue/React 组件生成器' },
      ],
    },
  },

  // TypeScript 严格模式
  typescript: {
    strict: true,
    typeCheck: false,  // 构建时检查，开发时不检查以提速
  },

  // 开发服务器代理（开发环境走 Nitro → BFF）
  devServer: {
    port: 5173,
  },
})
```

**2. Nitro Server API — 透明转发层**

```typescript
/**
 * 知识点 14.2：Nitro Server 作为 BFF 代理
 * 
 * 学习要点：
 * - defineEventHandler 定义 Nitro 路由
 * - readBody 读取请求体
 * - $fetch 转发到真正的 BFF
 * - Nitro 层只做转发，不做 AI 逻辑
 * 
 * 面试相关：
 * - 为什么 Nitro 只做转发不做 AI 逻辑？
 * - 答：因为 LangChain / LangGraph 等 AI 编排逻辑应在 BFF 层，
 *   Nitro 是边缘层，保持轻量。逻辑集中在 Express BFF。
 */

// server/api/chat/completions.post.ts
import { createError, defineEventHandler, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody(event)

  try {
    const response = await $fetch(`${config.public.apiBase}/api/chat/completions`, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        // 转发用户的 Authorization header
        ...(event.headers.get('authorization')
          ? { Authorization: event.headers.get('authorization')! }
          : {}),
      },
      // SSE 流式响应：返回 ReadableStream
      responseType: 'stream',
    })

    // 直接返回流，Nitro 会 pipe 给客户端
    return response
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: 'AI 服务暂时不可用',
    })
  }
})
```

**3. 页面 — `pages/chat/[sessionId].vue`**

```vue
<!--
  知识点 14.3：Nuxt 页面
  
  学习要点：
  - definePageMeta: 页面级 meta（标题、布局、中间件）
  - useRoute: 获取路由参数
  - onMounted: 客户端-only 的逻辑（如 SSE 连接）
-->
<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useChatStore } from '~/stores/chat'
import ChatPanel from '~/components/chat/ChatPanel.vue'
import AgentTimeline from '~/components/generator/AgentTimeline.vue'

const route = useRoute()
const store = useChatStore()
const { sessionId } = route.params as { sessionId: string }

// 页面级 meta（Nuxt 特性）
definePageMeta({
  title: 'AI 对话',
  layout: 'default',
  middleware: ['auth'],
  // 禁用 SSR 渲染此页面（纯客户端交互场景）
  // 因为 AI 对话是交互式的，SSR 意义不大
})

// 客户端-only：加载会话消息
onMounted(async () => {
  await store.loadSession(sessionId)
})

const messages = computed(() => store.getMessages(sessionId))
const isStreaming = computed(() => store.isStreaming)
</script>

<template>
  <div class="chat-page h-screen flex flex-col">
    <!-- 头部：会话标题 + 操作 -->
    <header class="flex items-center justify-between px-4 py-3 border-b">
      <h1 class="text-lg font-semibold">{{ store.activeSession?.title || '新对话' }}</h1>
      <div class="flex gap-2">
        <button @click="store.renameSession(sessionId, prompt('新名称') || '')">重命名</button>
        <button @click="store.deleteSession(sessionId)">删除</button>
      </div>
    </header>

    <!-- 主体：聊天面板 -->
    <ChatPanel
      :messages="messages"
      :is-streaming="isStreaming"
      @send="store.sendMessage"
      @stop="store.stopStreaming"
    />
  </div>
</template>
```

**4. SEO 优化 — 动态 meta**

```vue
<!--
  知识点 14.4：Nuxt SEO
  
  学习要点：
  - useHead: 动态设置页面 meta/title
  - 结构化数据：JSON-LD 供搜索引擎理解
  - 预渲染：关键页面用 prerender 生成静态 HTML
-->
<script setup lang="ts">
const route = useRoute()
const store = useChatStore()

// 动态标题：AI 组件生成器 - 商品卡片
useHead(() => ({
  title: `AI 组件生成器 - ${store.activeSession?.title || '智能助手'}`,
  meta: [
    {
      name: 'description',
      content: 'AI 驱动的 Vue/React 组件代码生成、RAG 检索、Function Calling',
    },
    // Open Graph（社交分享卡片）
    { property: 'og:title', content: 'AI 组件生成器' },
    { property: 'og:description', content: 'AI 驱动的组件代码生成工具' },
    { property: 'og:type', content: 'website' },
  ],
  // Canonical URL（避免重复内容）
  link: [
    { rel: 'canonical', href: `https://ai-generator.dev${route.fullPath}` },
  ],
}))

// 结构化数据：WebApplication Schema
useHead(() => ({
  script: [{
    type: 'application/ld+json',
    children: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'AI 组件生成器',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Web',
      description: 'AI 驱动的 Vue/React 组件代码生成工具',
    }),
  }],
}))
</script>
```

**5. Pinia Store + SSR 兼容**

```typescript
// stores/chat.ts
/**
 * 知识点 14.5：Pinia SSR 兼容
 * 
 * 学习要点：
 * - SSR 时 state 必须在服务端初始化，不能依赖 localStorage
 * - 客户端 hydration 后再从 localStorage 恢复
 * - 用 process.client 区分服务端/客户端
 */

export const useChatStore = defineStore('chat', {
  state: () => ({
    sessions: [] as Session[],
    messages: {} as Record<string, Message[]>,
    activeSessionId: null as string | null,
    isStreaming: false,
  }),

  actions: {
    // SSR 兼容的初始化
    async init() {
      if (import.meta.server) {
        // 服务端：从 API 拉取初始数据
        const data = await $fetch('/api/sessions')
        this.sessions = data
      } else {
        // 客户端：从 localStorage 恢复
        const saved = localStorage.getItem('chat-sessions')
        if (saved) {
          this.sessions = JSON.parse(saved)
        }
      }
    },

    // 流式发送（SSR 安全：onMounted 后才调用）
    async sendMessage(content: string) {
      if (import.meta.server) {
        // 服务端不应调用此方法
        throw new Error('sendMessage 只能在客户端调用')
      }
      // ... 正常流式逻辑
    },
  },
})
```

#### 📱 C 端生产化改造

| 维度 | 改造方案 |
|------|----------|
| **SSR 缓存** | 首页/文档列表等静态化页面用 `routeRules.prerender = true` 预渲染 |
| **客户端 Only** | AI 聊天、Agent 执行等交互页面用 `definePageMeta({ ssr: false })` 避免不必要的 SSR |
| **SEO** | 文档详情页预渲染 + JSON-LD 结构化数据，Google 可索引 AI 生成的组件示例 |
| **性能** | `useAsyncData` + `pick` 选项只取需要的字段，减少 payload |
| **错误边界** | Nuxt `error.vue` 全局错误页 + `createError({ fatal: true })` 渲染错误 |
| **水合** | `useHydrated()` 确保客户端水合完成后再操作 DOM |
| **预取** | `<NuxtLink>` 默认预取目标页面资源，导航更快 |

#### 🤝 与 React 对照

| Nuxt 3 SSR 概念 | React Next.js 对应 | 说明 |
|---|---|---|
| `pages/` 文件路由 | `app/` Router Handlers | 基于文件的路由 |
| `definePageMeta()` | `export const metadata` | 页面级配置 |
| `useFetch()` | `use` hook (RSC) | 同构数据获取 |
| `useAsyncData()` | `use` hook (RSC) | 带缓存的数据获取 |
| `server/api/` | `app/api/` Route Handlers | 服务端 API |
| `useRuntimeConfig()` | `process.env` + 服务器变量 | 运行时配置 |
| `defineNuxtPlugin()` | `app/layout.js` | 全局插件 |
| Nitro Engine | Next.js Serverless | 服务端引擎 |
| `routeRules` | `export const dynamic` | 路由级渲染规则 |
| `useHead()` | `next/head` / `metadata` API | 动态 head |

#### 🧠 AI + C 端专属面试题

**题 1（中级 · 原理）**：Nuxt 3 SSR 与传统 SPA 的核心区别是什么？在 AI 产品中如何选择？

> **答案要点**：
> 1. **渲染时机**：SSR 在服务器生成 HTML，SPA 在浏览器生成
> 2. **首屏时间**：SSR 首屏更快（服务器直接返回 HTML），SPA 需要等 JS 加载+执行
> 3. **SEO**：SSR 天生支持 SEO，SPA 需要额外配置 prerender 或 SSR
> 4. **AI 产品选择**：
>    - **需要 SSR**：文档展示页、组件模板展示页（需要被搜索引擎索引）、产品首页
>    - **不需要 SSR**：AI 聊天界面、Agent 执行界面（纯交互，SSR 意义不大）
> 5. **混合渲染**：Nuxt 3 支持每个页面独立配置 SSR/CSR，AI 产品通常用混合模式

**题 2（中级 · 设计）**：Nitro Server 作为 BFF 透明代理层，应该做什么、不应该做什么？

> **答案要点**：
> **应该做的**：
> 1. CORS 处理：前端同源请求，绕过浏览器跨域限制
> 2. 认证透传：转发 Authorization header
> 3. 请求日志：记录每个请求的耗时
> 4. 限流：简单的 IP 级限流
> 5. 错误格式转换：将后端错误转为前端友好格式
> 
> **不应该做的**：
> 1. ❌ AI 编排逻辑（LangChain/LangGraph 应在 Express BFF）
> 2. ❌ 数据库操作（应在 Express BFF）
> 3. ❌ 复杂业务逻辑（应在 Express BFF）
> 4. ❌ API Key 管理（Nitro 的 env 不适合存密钥）
> 
> **核心原则**：Nitro 是边缘层/网关层，Express BFF 是业务层。Nitro 只做「转发 + 基础增强」，不做业务。

**题 3（高级 · 架构）**：设计一个 SSR + BFF 的 AI 产品全栈架构，各层的职责边界是什么？

> **答案要点**：
> ```
> 浏览器
>   │
>   ▼
> Nuxt 3 SSR (Nitro) ← 边缘层：CORS、认证、限流、透明转发
>   │
>   ▼
> Express BFF (apps/server) ← 业务层：AI 编排、RAG、Agent、Function Calling、DB
>   │
>   ├── SQLite (持久化)
>   ├── AI Provider (LLM)
>   └── Vector Store (向量检索)
> ```
> 
> **职责边界**：
> - Nitro：只做 HTTP 请求转发 + 基础中间件（≤10 行代码/路由）
> - Express BFF：所有 AI 逻辑、数据逻辑、业务逻辑
> - DB：只在 BFF 层访问
> 
> **数据流向**：
> 1. 浏览器 → Nitro（同源请求）→ Express BFF → AI Provider
> 2. 浏览器 ← Nitro（SSE 流透传）← Express BFF ← AI Provider
> 
> **安全边界**：
> - Nitro 的 env 不放密钥
> - Express BFF 的 env 放 API Key
> - 前端 Bundle 绝对不含任何密钥

---

### 9.2 全栈类型共享与三端联动

#### 💡 JS 基础补充 A.13：TypeScript 项目引用

monorepo 中各包共享类型，使用 TypeScript Project References：

```json
// packages/shared/tsconfig.json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "outDir": "dist"
  }
}

// apps/web-vue-nuxt/tsconfig.json
{
  "references": [{ "path": "../../packages/shared" }]
}
```

#### 🤖 AI 场景价值

共享类型的核心价值是**保证前后端类型一致**：
- 前端 `ChatRequest` 类型 = 后端 `ChatRequest` 类型 = 零拷贝接口
- 接口变更时，TypeScript 编译期就能发现不匹配，而不是运行时 500 错误

#### 📚 主线知识点原理解析

**共享类型设计**：

```
packages/shared/
├── src/
│   ├── index.ts              # 统一导出
│   ├── api/
│   │   ├── chat.ts           # ChatRequest / ChatResponse
│   │   ├── rag.ts            # RagQueryRequest / RagQueryResponse
│   │   ├── tools.ts          # ToolDefinition / ToolCallResult
│   │   ├── agent.ts          # AgentState / AgentStreamEvent
│   │   └── generator.ts      # GeneratorRequest / GeneratorJob
│   ├── db/
│   │   ├── document.ts       # Document / DocumentChunk
│   │   ├── session.ts        # Session / Message
│   │   └── agent.ts          # AgentStateRecord / ToolCallRecord
│   └── utils/
│       ├── id.ts             # ID 生成工具
│       ├── time.ts           # 时间格式化
│       └── error.ts          # 错误码定义
└── package.json
```

#### 💻 代码实现

**共享类型定义 — `packages/shared/src/api/chat.ts`**

```typescript
/**
 * 知识点 12.3：跨项目类型共享
 * 
 * 学习要点：
 * - Brand Type：用品牌类型防止 ID 混用
 * - Discriminated Union：区分不同消息类型
 * - 前后端共用：一份类型定义在前端和 BFF 中都能用
 */

// Brand Type：防止 sessionId 和 messageId 混用
export type SessionId = string & { __brand: 'SessionId' }
export type MessageId = string & { __brand: 'MessageId' }

export type Role = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessage {
  id: MessageId
  role: Role
  content: string
  sessionId: SessionId
  createdAt: number
  // 流式相关
  streaming?: boolean
  toolCalls?: ToolCallStep[]
  citations?: Citation[]
  // 元数据
  metadata?: Record<string, unknown>
}

export interface ToolCallStep {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  args?: Record<string, unknown>
  result?: unknown
  error?: string
}

export interface Citation {
  id: string
  documentId: string
  documentName: string
  content: string
  score: number
  url?: string  // 前端点击跳转链接
}

export interface ChatRequest {
  messages: ChatMessage[]
  stream?: boolean
  temperature?: number
  maxTokens?: number
  // Function Calling
  tools?: Array<{
    name: string
    description: string
    schema: Record<string, unknown>  // JSON Schema
  }>
  // Agent
  mode?: 'chat' | 'agent' | 'generator'
  threadId?: string
}

export interface ChatResponse {
  message: ChatMessage
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

// SSE 事件类型（区分流式中的不同事件）
export type SSEEvent =
  | { type: 'token'; content: string }
  | { type: 'tool_call_start'; name: string; args: Record<string, unknown> }
  | { type: 'tool_call_end'; name: string; result: unknown }
  | { type: 'citation'; citation: Citation }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; message: string }
```

**BFF 中使用共享类型**：

```typescript
// apps/server/src/routes/chat.ts
import type { ChatRequest, ChatResponse } from '@ai/shared'

router.post('/completions', asyncHandler(async (req, res) => {
  const body = req.body as ChatRequest  // 类型安全
  // ...
}))
```

**前端中使用共享类型**：

```typescript
// apps/web-vue-nuxt/src/composables/useChat.ts
import type { ChatMessage, SSEEvent } from '@ai/shared'

const messages = ref<ChatMessage[]>([])  // 类型安全
// ...
```

#### 📱 C 端生产化改造

| 维度 | 改造方案 |
|------|----------|
| **类型自动生成** | 用 `openapi-typescript` 从 BFF 的 OpenAPI spec 自动生成前端类型 |
| **运行时校验** | 前端用 `zod` + `@ai/shared` 的类型做运行时校验，BFF 用相同 schema |
| **版本兼容** | API 路径含版本号 `/api/v1/`，类型包也按版本发布 |
| **文档生成** | `@ai/shared` 中用 JSDoc 写类型注释，TypeDoc 自动生成 API 文档 |

#### 🧠 AI + C 端专属面试题

**题 1（中级 · 原理）**：monorepo 中如何保证前后端类型一致？有哪些方案？

> **答案要点**：
> 1. **共享类型包**（本项目方案）：`packages/shared` 导出类型，前后端都引用
> 2. **OpenAPI 自动生成**：BFF 写 OpenAPI spec，前端用 `openapi-typescript` 生成类型
> 3. **tRPC**：基于 TypeScript 类型直接生成前后端接口，不需要手写类型
> 4. **GraphQL Codegen**：从 GraphQL schema 生成类型
> 
> **本项目选择方案 1 的原因**：
> - 简单直接，不需要额外工具链
> - 类型完全可控，符合教学需求
> - 适合中小型项目

**题 2（高级 · 设计）**：如何设计 API 的版本迁移策略，确保不破坏旧客户端？

> **答案要点**：
> 1. **URL 版本化**：`/api/v1/chat/completions` → `/api/v2/chat/completions`
> 2. **类型分版本**：`@ai/shared@1.x` → `@ai/shared@2.x`，前后端按版本引用
> 3. **向后兼容**：v2 的响应格式包含 v1 的所有字段，新增字段用可选
> 4. **废弃策略**：v1 保留 3 个月，日志中标记 `deprecation: true`
> 5. **特性开关**：用请求头 `X-API-Version` 控制新旧 API
> 6. **监控**：统计各版本的调用比例，低于 1% 时可以考虑移除

---

## 实践任务

### 任务 1：Nuxt 3 项目搭建

- [ ] 在 `apps/web-vue-nuxt/` 初始化 Nuxt 3 项目
- [ ] 配置 `nuxt.config.ts`（modules、runtimeConfig、nitro proxy）
- [ ] 搭建 `default.vue` 布局（侧边栏 + 主区域）
- [ ] 配置 Tailwind CSS + @vueuse

### 任务 2：Nitro Server 路由

- [ ] 创建 `server/api/chat/completions.post.ts`（AI 聊天代理）
- [ ] 创建 `server/api/rag/` 系列路由（文档、问答）
- [ ] 创建 `server/api/tools/` 系列路由（列表、执行）
- [ ] 创建 `server/api/agent/` 系列路由（run、pause、resume）
- [ ] 验证：所有 API 通过 Nitro 透明转发到 BFF

### 任务 3：页面与组件

- [ ] 创建 `pages/chat/index.vue`（会话列表页）
- [ ] 创建 `pages/chat/[sessionId].vue`（聊天详情页）
- [ ] 创建 `pages/generator/index.vue`（组件生成器首页）
- [ ] 实现 `useHead()` 动态 SEO 配置
- [ ] 实现 Pinia Store 的 SSR 兼容初始化

### 任务 4：共享类型包

- [ ] 创建 `packages/shared/` 包结构
- [ ] 定义 API 类型（chat/rag/tools/agent/generator）
- [ ] 定义 DB 类型（document/session/agent_state）
- [ ] 配置 tsconfig.json 的 project references
- [ ] 在 BFF 和前端中引用 `@ai/shared`

---

## 检验标准

- [ ] Nuxt 3 SSR 项目能正常启动：`pnpm dev:web` 访问 `http://localhost:5173`
- [ ] Nitro Server 路由正确转发到 BFF：API 请求链路 `Browser → Nitro → Express BFF → AI`
- [ ] SSR 与 CSR 混合渲染：AI 聊天页为 CSR（无 SSR 必要），文档页为 SSR（SEO 友好）
- [ ] 共享类型：`@ai/shared` 类型在 BFF 和前端中都能正确引用
- [ ] 无 CORS 问题：前端 5173 → Nitro → BFF 3001 跨域正常
- [ ] API Key 安全：前端 Bundle 中搜索 `sk-` 结果为 0
- [ ] SEO 正确：页面有动态 title、meta description、OG 标签
