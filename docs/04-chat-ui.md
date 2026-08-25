# 模块 4：多轮对话 UI — 组件生成器的会话管理

## 学习目标

- 理解 AI 产品中多轮对话 UI 的核心架构（会话管理、消息模型、状态机）
- 掌握 Vue3 Composable 模式实现跨组件状态共享，替代 Pinia 轻量方案
- 实现 SSR 安全的会话持久化（localStorage + Nuxt runtimeConfig）
- 理解 Token 压缩策略（滑动窗口、摘要压缩）在前端的落地
- 能构建生产级 C 端聊天界面（流式渲染、虚拟滚动、错误重试）

---

## 知识点

### 4.1 多轮对话 UI 架构总览

#### 💡 JS 基础补充

- **单例模式**：模块级变量 + 闭包实现跨组件状态共享。`useChat.ts` 中 `const sessions = ref<ChatSession[]>([])` 定义在函数外部，模块加载时初始化一次，所有调用 `useChat()` 的组件共享同一份状态。对比 Pinia store 本质也是模块级单例，Composable 方式更轻量、无需注册。
- **可选链 (?.) 与空值合并 (??)**：`activeSession.value?.messages ?? []` 在 `activeSession` 为 `null` 时安全返回空数组，避免访问 `null.messages` 抛 TypeError。
- **Proxy 响应式原理**：Vue3 的 `ref()` 内部使用 Proxy 实现依赖收集，当 `sessions.value` 被修改时，所有引用它的 computed / template 自动更新。

#### 🤖 AI 场景价值

AI 组件生成器（如 Cursor、CodeBuddy）的核心交互就是多轮对话：
- **会话管理**：用户可能同时进行多个生成任务（搜索框、数据表格、登录表单），需要会话列表支持切换/删除/重命名
- **历史上下文**：每轮对话的 messages 数组作为上下文传给模型，模型基于历史生成更精准的代码
- **Token 预算**：组件生成器场景下历史消息包含大量代码，Token 消耗远高于普通对话，需要压缩策略
- **流式体验**：代码生成往往需要 3-10 秒，SSE 流式输出 + 打字机动画是基本体验要求

#### 📚 主线知识点原理解析

**聊天 UI 的三层架构**：

```
┌──────────────────────────────────────────────────┐
│  UI 层 (Vue Components)                           │
│  ChatBubble / ChatInput / MessageList             │
│  职责：渲染消息、处理用户输入                       │
├──────────────────────────────────────────────────┤
│  状态层 (Composable)                              │
│  useChat()                                        │
│  职责：会话 CRUD、消息管理、SSE 解析、持久化         │
├──────────────────────────────────────────────────┤
│  网络层 (BFF Proxy)                               │
│  /api/chat → LangChain Chain → LLM API            │
│  职责：Key 安全、流式转发、模型路由                  │
└──────────────────────────────────────────────────┘
```

**消息模型**：

```typescript
interface ChatMessage {
  id: string           // 唯一标识，用于 Vue key
  role: 'user' | 'assistant' | 'system'
  content: string      // 消息内容（可能包含 Markdown + 代码块）
  timestamp: number    // 毫秒时间戳
  code?: string        // 从 content 中提取的纯代码（用于预览面板）
}

interface ChatSession {
  id: string
  title: string        // 自动取首条 user 消息前 20 字
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}
```

**核心状态机**：

```
idle ──sendMessage──→ loading ──streaming──→ success / error
  ↑                                                        │
  └────────────────createNewSession────────────────────────┘
```

#### 💻 代码实现（Vue3 + Nuxt3 真实业务代码）

**1. Composable 单例状态 — `composables/useChat.ts`**

```typescript
import { ref, computed } from 'vue'

// 模块级单例状态：所有组件共享
const sessions = ref<ChatSession[]>([])
const activeSessionId = ref<string>('')
const isLoading = ref(false)
const initialized = ref(false)

export function useChat() {
  const activeSession = computed(() =>
    sessions.value.find(s => s.id === activeSessionId.value) || null
  )
  const currentMessages = computed<ChatMessage[]>(
    () => activeSession.value?.messages ?? []
  )
  // ...
}
```

**2. SSR 安全的持久化**

```typescript
const STORAGE_KEY = 'ai-generator-sessions'

function loadSessions(): ChatSession[] {
  try {
    if (typeof localStorage !== 'undefined') { // SSR 安全判断
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    }
  } catch {}
  return []
}

function saveSessions(sessions: ChatSession[]) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
    }
  } catch {}
}
```

**3. SSE 流式解析（核心逻辑）**

```typescript
async function sendMessage(content: string) {
  const response = await fetch(`${config.public.bffUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [...currentMessages.value],
      stream: true,
    }),
  })

  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''  // 粘包处理：保留最后一个不完整行

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      if (trimmed === 'data: [DONE]') continue

      const json = JSON.parse(trimmed.slice(5).trim())
      const delta = json.choices?.[0]?.delta?.content || ''
      if (delta) {
        fullContent += delta
        updateLastAssistant(fullContent)  // 增量更新最后一条 assistant 消息
      }
    }
  }
}
```

**4. 模板集成 — `pages/index.vue`**

```vue
<script setup lang="ts">
const chat = useChat()
const { currentMessages, activeSessionTitle, isLoading, sendMessage, loadOrCreateSession } = chat

onMounted(() => {
  loadOrCreateSession()  // 首次加载：从 localStorage 恢复或创建新会话
})
</script>

<template>
  <main class="flex-1 overflow-y-auto">
    <div v-for="(msg, idx) in currentMessages" :key="msg.id">
      <ChatBubble
        :content="msg.content"
        :role="msg.role"
        :is-streaming="isLoading && idx === currentMessages.length - 1 && msg.role === 'assistant'"
      />
    </div>
  </main>
  <ChatInput :disabled="isLoading" @send="sendMessage" />
</template>
```

#### 📱 C 端生产化改造

| 维度 | 现状 | 改造方案 |
|------|------|----------|
| 存储容量 | localStorage ~5MB | 迁移 IndexedDB（`idb` 库封装），支持 500MB+ 会话数据 |
| 消息限流 | 无限制 | 每会话上限 100 条，超出自动归档到 `archived` 字段 |
| 错误重试 | 无 | 网络断开时指数退避重连（1s → 2s → 4s → 8s，上限 3 次） |
| Token 压缩 | 无 | 超过 40 条消息时，调用 `/api/compress` 摘要压缩早期消息 |
| 虚拟滚动 | 无 | 消息 > 200 条时启用虚拟滚动（`vue-virtual-scroller`） |
| 自动滚动 | 无 | IntersectionObserver 监听底部哨兵，用户上翻时暂停自动滚动 |
| 多设备同步 | 无 | 服务端会话同步（WebSocket 推送 + 增量拉取） |

**Token 压缩实现示例**：

```typescript
async function compressHistory(messages: ChatMessage[]): Promise<ChatMessage[]> {
  if (messages.length <= 40) return messages

  const toCompress = messages.slice(0, -20)
  const recent = messages.slice(-20)

  const res = await fetch('/api/compress', {
    method: 'POST',
    body: JSON.stringify({ messages: toCompress }),
  })
  const { summary } = await res.json()

  return [
    { role: 'system', content: `[历史摘要] ${summary}` },
    ...recent,
  ]
}
```

#### 🤝 与 React 对照

| Vue3 (本项目) | React | 说明 |
|---------------|-------|------|
| `ref()` | `useState()` | Vue ref 自动解包，React useState 需手动 setter |
| `computed()` | `useMemo()` | Vue computed 自动缓存依赖，useMemo 需手动指定 deps |
| `watchEffect()` | `useEffect()` | Vue 自动收集依赖，React 需手动 deps 数组 |
| Composable 单例 | Redux / Zustand store | 都是模块级单例，Composable 更轻量无需 Provider |
| `provide/inject` | `Context.Provider` | Vue 默认组件树注入，React 需显式包裹 |
| `onMounted()` | `useEffect(() => {}, [])` | 生命周期钩子命名不同，语义一致 |
| Nuxt `useRuntimeConfig()` | `.env` + `import.meta.env` | 服务端/客户端环境变量隔离 |
| SSE `ReadableStream` | 相同 | 浏览器标准 API，两端一致 |

#### 🧠 面试题 / 常见坑

**题 1（中级 · 原理）**：AI 产品中多轮对话的 messages 数组是如何维护的？为什么不能只传最后一轮？

> **答案要点**：
> 1. LLM 无状态，每轮对话必须传完整 messages 数组作为上下文，模型才能"记得"之前的对话
> 2. messages 结构固定：`[system, user1, assistant1, user2, assistant2, ...]`，role 必须交替
> 3. 只传最后一轮会导致模型丢失上下文，无法引用之前讨论的内容
> 4. 工程权衡：消息越多上下文越长 → Token 消耗越大 → 成本越高 + 延迟越高，因此需要滑动窗口 / Token 压缩
> 5. 对比传统 Session：传统服务端 Session 存在服务端内存，而 LLM "Session" 存在客户端，每次发完整历史

**题 2（中级 · 编码）**：SSE 流式解析中，为什么需要 buffer + split('\n') + pop() 模式？直接按行处理会有什么问题？

> **答案要点**：
> 1. **粘包**：一个 TCP chunk 可能包含多个完整 SSE 事件（多行 data:）
> 2. **拆包**：一个 SSE 事件可能被拆分到两个 chunk 中
> 3. `buffer.split('\n')` 按换行分割后，`pop()` 返回最后一个元素——它可能是不完整的（被拆包的），需要拼到下一个 chunk 才能组成完整行
> 4. 如果直接 `split('\n')` 就处理，遇到拆包场景会解析出不完整的 JSON → JSON.parse 报错
> 5. 通用模式：所有流式协议（TCP、Kafka、SSE）都用此模式

**题 3（高级 · 设计）**：当对话历史超过 Token 限制时，有哪些压缩策略？各有什么优缺点？

> **答案要点**：
> 1. **滑动窗口**：只保留最近 N 轮（如 10 轮）。优点：简单；缺点：早期重要信息丢失
> 2. **Token 预算裁剪**：设定上限（如 4000 Token），从最早消息逐条删除直到在预算内。优点：精确控制；缺点：仍丢失信息
> 3. **摘要压缩**：让 AI 总结早期对话为一段摘要，替换原始消息。优点：保留关键信息；缺点：摘要本身消耗 Token + 可能丢失细节
> 4. **向量检索（RAG 思路）**：历史消息存入向量库，每次检索最相关的几条拼入上下文。优点：检索精准；缺点：实现复杂
> 5. **重要消息标记**：用户标记的关键消息始终保留，其余按策略裁剪。优点：用户可控；缺点：需要额外交互

**题 4（高级 · 设计）**：Vue3 Composable 单例模式 vs Pinia store，在 AI 产品场景下如何选择？

> **答案要点**：
> 1. **Composable 单例**：模块级 `ref` + 闭包，零依赖、轻量、自动按需加载。缺点：不支持 DevTools 时间旅行、不支持 SSR hydration
> 2. **Pinia store**：完整的状态管理方案，支持 DevTools、插件系统、SSR。缺点：需要注册、增加打包体积
> 3. **选择策略**：AI 场景下会话状态需要持久化 + DevTools 调试 → 选 Pinia；纯 UI 局部状态 → 选 Composable
> 4. **本项目选择 Composable 单例**：因为会话状态结构简单（数组 CRUD），不需要时间旅行，SSR 通过 `typeof localStorage` 判断实现安全

**题 5（中级 · 编码）**：Nuxt SSR 模式下访问 localStorage 会报什么错？如何做 SSR 安全判断？

> **答案要点**：
> 1. SSR 期间 `localStorage` 未定义，直接 `localStorage.getItem()` 会抛 `ReferenceError: localStorage is not defined`
> 2. 安全判断方式一：`typeof localStorage !== 'undefined'`（本项目使用）
> 3. 安全判断方式二：`import { useRuntimeConfig } from '#app'` + `process.client` 判断
> 4. 安全判断方式三：`onMounted` 钩子中才访问 localStorage（保证仅客户端执行）
> 5. SSR 安全原则：所有浏览器 API（localStorage、window、document、navigator）都必须做环境判断

**题 6（中级 · 原理）**：流式渲染 AI 回复时，为什么需要 `{ stream: true }` 参数？TextDecoder 的 stream 选项有什么作用？

> **答案要点**：
> 1. `TextDecoder.decode(value, { stream: true })` 中的 `stream: true` 告诉解码器：输入可能是不完整的多字节字符（如 UTF-8 中文 3 字节被拆分到两个 chunk），不要报错，等下次输入拼接
> 2. 如果不传 `stream: true`，遇到被截断的多字节字符时会产生乱码（用替换字符 U+FFFD 替代）
> 3. AI 回复中大量中文 + 代码（含特殊字符），stream: true 是必须的
> 4. `decoder.decode(value)` 必须同一个实例，跨 chunk 保持解码状态

**题 7（高级 · 设计）**：设计一个支持 10 万条历史消息的聊天界面，需要考虑哪些性能优化？

> **答案要点**：
> 1. **虚拟滚动**：`vue-virtual-scroller` 只渲染可视区域的 DOM，10 万条始终只渲染 20-30 条
> 2. **分块渲染**：新消息到达时分 3-5 帧渲染，避免单次大量 DOM 更新阻塞主线程
> 3. **消息懒加载**：历史消息分页加载（每页 50 条），滚动到顶部时加载更早数据
> 4. **记忆化**：`v-memo` 或 `computed` 缓存已渲染消息的 Markdown 解析结果
> 5. **Web Worker 解析**：将 Markdown 解析、代码高亮放到 Worker 中执行，不阻塞主线程
> 6. **IndexedDB 存储**：localStorage 不够大容量，用 IndexedDB 存历史消息
> 7. **数据裁剪**：历史消息仅保留摘要，详情按需加载

**题 8（中级 · 编码）**：AI 回复中包含 Markdown 代码块，如何自动提取代码并在独立面板展示？

> **答案要点**：
> 1. 正则提取：`content.match(/```[\s\S]*?```/)` 匹配代码块
> 2. 清理标记：`code.replace(/```\w*\n?/g, '').replace(/```$/, '')` 去除语言标识和闭合标记
> 3. 实时提取：在 SSE 流式解析的每轮 `delta` 更新中同步提取，用户看到完整回复时代码已提取完成
> 4. 存储到消息对象的 `code` 字段，独立面板通过 `previewCode.value = code` 展示
> 5. 边界处理：无代码块时隐藏"查看代码"按钮，多个代码块取第一个

---

## 实践任务

### 任务 1：useChat Composable 实现

- 实现 `useChat()` 单例状态管理（sessions / activeSessionId / isLoading）
- 实现会话 CRUD（createNewSession / switchSession / deleteSession / updateSessionTitle）
- 实现 SSR 安全的 localStorage 持久化
- 实现 SSE 流式消息发送与解析

### 任务 2：聊天 UI 组件搭建

- 实现 ChatBubble 消息气泡组件（区分 user / assistant 样式，支持打字机动画）
- 实现 ChatInput 输入组件（textarea 自适应高度、Enter 发送 / Shift+Enter 换行）
- 实现消息列表自动滚动 + 用户上翻暂停

### 任务 3：Token 压缩策略

- 实现滑动窗口裁剪（保留最近 10 轮）
- 实现 Token 预算计算（估算 messages 的 Token 数）
- 实现摘要压缩（调用 BFF `/api/compress` 接口）

### 任务 4（进阶）：C 端生产化

- 迁移 localStorage → IndexedDB（使用 `idb` 库）
- 实现错误重试（指数退避 + 网络恢复检测）
- 实现虚拟滚动（消息 > 200 条时自动启用）
- 实现会话导出/导入（JSON 格式备份）

---

## 检验标准

- [ ] `useChat()` Composable 实现了完整的会话管理，支持多会话切换
- [ ] SSE 流式解析正确处理粘包/拆包，无 JSON 解析错误
- [ ] SSR 模式下无 `localStorage` 访问报错，客户端刷新后会话恢复
- [ ] Token 压缩在消息超限时自动触发，压缩后对话仍能正常进行
- [ ] 聊天界面支持自动滚动、打字机动画、消息时间戳
- [ ] 生产化改造：IndexedDB 存储、错误重试、虚拟滚动至少实现一项