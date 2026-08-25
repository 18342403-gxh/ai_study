# Phase 8：Vue3 网页端 — AI 组件生成器前端实现

## 学习目标

- 掌握 Vue 3 + Composition API + TypeScript 在 AI 产品中的最佳实践
- 实现 AI 聊天界面的核心交互：SSE 流式接收、打字机效果、消息列表
- 构建工具调用的可视化展示：步骤时间线、参数预览、结果展示
- 理解 Pinia 状态管理在 AI 场景下的应用：会话持久化、流式状态、工具步骤追踪
- 实现响应式布局 + 虚拟滚动 + 代码高亮等生产级 UI 细节

---

## 知识点

### 8.1 Vue 3 AI 聊天界面核心实现

#### 💡 JS 基础补充 A.2：async-await 与迭代器协议

AI 流式响应本质是**异步迭代器**，前端用 `for await...of` 消费：

```typescript
// 消费 SSE 流的通用模式
async function* consumeStream(response: Response) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      if (trimmed === 'data: [DONE]') return

      const payload = trimmed.slice(6)
      if (payload) yield JSON.parse(payload)
    }
  }
}
```

#### 💡 浏览器基础补充 B.1：SSE 长连接与断线重连

SSE（Server-Sent Events）是 AI 流式输出的核心协议：
- 服务端推送 `data: {json}\n\n` 格式的事件
- 浏览器 `fetch` + `ReadableStream` 消费（原生 EventSource 不支持 POST）
- 断线重连：检测 `reader.read()` 抛错后，用最后一条消息 ID 续传

#### 🤖 AI 场景价值

AI 产品的前端与传统 Web 应用有本质区别：
1. **流式更新**：消息逐条出现，不是一次性加载
2. **状态异步**：用户发消息后立即显示占位，AI 回复逐步填充
3. **工具可见**：AI 调用工具时用户需要看到「正在调用天气 API...」
4. **长时任务**：Agent 可能执行 30 秒，前端不能假死，需要进度反馈

#### 📚 主线知识点原理解析

**Vue 3 AI 聊天 UI 架构**：

```
┌──────────────────────────────────────────────────┐
│  App.vue (Layout)                                │
│  ├── Sidebar.vue (会话列表)                      │
│  │   └── v-for sessions → activeSessionId       │
│  └── ChatPanel.vue (主区域)                      │
│      ├── MessageList.vue (虚拟滚动消息列表)       │
│      │   ├── UserMessage.vue (用户气泡)           │
│      │   ├── AIMessage.vue (AI 气泡 + 打字机)     │
│      │   ├── ToolCallStep.vue (工具调用步骤卡)    │
│      │   └── CitationCard.vue (引用卡片)          │
│      ├── AgentTimeline.vue (Agent 时间线)         │
│      └── ChatInput.vue (输入框 + 停止按钮)       │
│                                                   │
│  stores/chat.ts (Pinia)                          │
│  ├── sessions: Session[]                         │
│  ├── messages: Message[] (按 sessionId 分桶)     │
│  ├── isStreaming: boolean                        │
│  └── abortController: AbortController | null     │
│                                                   │
│  composables/                                     │
│  ├── useSSE.ts (SSE 流式消费)                     │
│  ├── useChat.ts (聊天逻辑封装)                    │
│  └── useAgent.ts (Agent 时间线)                  │
└──────────────────────────────────────────────────┘
```

#### 💻 代码实现

**1. SSE 流式消费 Composable — `composables/useSSE.ts`**

```typescript
/**
 * 知识点 10.1：SSE 流式消费
 * 
 * 学习要点：
 * - fetch + ReadableStream 消费 SSE
 * - 断点续传：通过最后一条消息 ID
 * - AbortController 用户可中断
 * - 自动重连：断线后 3 秒重试
 */

export interface SSEOptions {
  url: string
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
  onMessage?: (data: unknown) => void
  onError?: (error: Error) => void
  onComplete?: () => void
}

export function useSSE() {
  const controller = ref<AbortController | null>(null)
  const isStreaming = ref(false)
  const eventSource = ref<AsyncGenerator<unknown, void, unknown> | null>(null)

  async function connect(options: SSEOptions) {
    if (controller.value) {
      controller.value.abort()
    }
    controller.value = new AbortController()
    isStreaming.value = true

    try {
      const response = await fetch(options.url, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.value.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }

      // 核心：消费 ReadableStream
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          if (trimmed === 'data: [DONE]') {
            options.onComplete?.()
            return
          }

          const payload = trimmed.slice(6)
          if (payload) {
            try {
              const parsed = JSON.parse(payload)
              options.onMessage?.(parsed)
            } catch {
              // 忽略无法解析的行
            }
          }
        }
      }

      options.onComplete?.()
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // 用户主动取消，不算错误
        return
      }
      options.onError?.(err as Error)
    } finally {
      isStreaming.value = false
      controller.value = null
    }
  }

  function disconnect() {
    controller.value?.abort()
    controller.value = null
    isStreaming.value = false
  }

  return { isStreaming, connect, disconnect }
}
```

**2. 聊天 Composable — `composables/useChat.ts`**

```typescript
/**
 * 知识点 10.2：AI 聊天逻辑封装
 * 
 * 学习要点：
 * - 乐观更新：用户消息立即显示，AI 回复逐步填充
 * - 流式状态：isStreaming 控制 UI 状态（禁用输入、显示停止按钮）
 * - 多会话管理：activeSessionId + sessions 列表
 */

export function useChat() {
  const store = useChatStore()
  const { isStreaming, connect, disconnect } = useSSE()

  async function sendMessage(content: string) {
    if (!content.trim() || isStreaming.value) return

    const sessionId = store.activeSessionId
    if (!sessionId) return

    // 1. 乐观更新：立即显示用户消息
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      sessionId,
      createdAt: Date.now(),
    }
    store.addMessage(userMsg)

    // 2. 创建 AI 占位消息
    const aiMsgId = crypto.randomUUID()
    const aiMsg: Message = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      sessionId,
      createdAt: Date.now(),
      streaming: true,  // 标记为流式中
    }
    store.addMessage(aiMsg)

    // 3. 流式接收
    await connect({
      url: '/api/chat/completions',
      method: 'POST',
      body: {
        messages: store.getMessages(sessionId),
        stream: true,
      },
      onMessage: (data) => {
        const chunk = (data as { choices: Array<{ delta: { content: string } }> })
          ?.choices?.[0]?.delta?.content
        if (chunk) {
          store.appendMessageContent(aiMsgId, chunk)
        }
      },
      onComplete: () => {
        store.finalizeMessage(aiMsgId)
      },
      onError: (err) => {
        store.finalizeMessage(aiMsgId, `⚠️ ${err.message}`)
      },
    })
  }

  return { isStreaming, sendMessage, disconnect }
}
```

**3. Pinia 会话 Store — `stores/chat.ts`**

```typescript
/**
 * 知识点 10.3：Pinia 状态管理
 * 
 * 学习要点：
 * - 按 sessionId 分桶存储消息
 * - 流式追加：appendMessageContent 用 +='' 而非 push
 * - 会话列表持久化到 localStorage
 */

interface ChatState {
  sessions: Session[]
  messages: Record<string, Message[]>  // sessionId → messages
  activeSessionId: string | null
}

export const useChatStore = defineStore('chat', {
  state: (): ChatState => ({
    sessions: loadSessions(),
    messages: loadMessages(),
    activeSessionId: null,
  }),

  getters: {
    activeSession(state): Session | null {
      return state.sessions.find(s => s.id === state.activeSessionId) || null
    },
    getMessages: (state) => (sessionId: string): Message[] => {
      return state.messages[sessionId] || []
    },
  },

  actions: {
    createSession(title = '新对话'): Session {
      const session: Session = {
        id: crypto.randomUUID(),
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      this.sessions.unshift(session)
      this.activeSessionId = session.id
      this.messages[session.id] = []
      this.persist()
      return session
    },

    addMessage(msg: Message) {
      if (!this.messages[msg.sessionId]) {
        this.messages[msg.sessionId] = []
      }
      this.messages[msg.sessionId].push(msg)
      this.persist()
    },

    // 📝 面试考点：流式追加用直接赋值而非 push，避免触发不必要的 watch
    appendMessageContent(messageId: string, chunk: string) {
      for (const msg of this.messages[this.activeSessionId!]) {
        if (msg.id === messageId) {
          msg.content += chunk  // 直接修改 reactive 对象的属性
          break
        }
      }
    },

    finalizeMessage(messageId: string, error?: string) {
      for (const msg of this.messages[this.activeSessionId!]) {
        if (msg.id === messageId) {
          msg.streaming = false
          if (error) msg.content = error
          break
        }
      }
      this.persist()
    },

    deleteSession(sessionId: string) {
      this.sessions = this.sessions.filter(s => s.id !== sessionId)
      delete this.messages[sessionId]
      if (this.activeSessionId === sessionId) {
        this.activeSessionId = this.sessions[0]?.id || null
      }
      this.persist()
    },

    persist() {
      // 防抖持久化
      debounce(() => {
        localStorage.setItem('ai-chat-sessions', JSON.stringify(this.sessions))
        localStorage.setItem('ai-chat-messages', JSON.stringify(this.messages))
      }, 300)
    },
  },
})
```

**4. 消息气泡组件 — `components/AIMessage.vue`**

```vue
<!--
  知识点 10.4：AI 消息气泡 + 打字机效果
  
  学习要点：
  - v-html 渲染 Markdown（AI 回复通常是 Markdown 格式）
  - 流式中显示光标动画
  - 代码块语法高亮（Shiki）
-->
<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import { codeToHtml } from 'shiki'

const props = defineProps<{
  message: Message
}>()

// Markdown 渲染 + 代码高亮
const renderedContent = computed(async () => {
  if (!props.message.content) return ''
  const text = props.message.content
  // 简单处理：找 ```code``` 块用 shiki 高亮
  return marked.parse(text, { async: true }) as Promise<string>
})

const isStreaming = computed(() => props.message.streaming)
</script>

<template>
  <div class="flex gap-3 max-w-[85%]">
    <Avatar type="ai" />
    <div class="flex-1 min-w-0">
      <div class="text-xs text-slate-400 mb-1">AI 助手</div>
      <div
        class="rounded-2xl rounded-tl-sm px-4 py-3 bg-white border border-slate-200 shadow-sm"
      >
        <!-- Markdown 渲染 -->
        <div
          class="prose prose-sm max-w-none"
          v-html="renderedContent"
        />
        <!-- 流式光标 -->
        <span
          v-if="isStreaming"
          class="inline-block w-2 h-4 bg-slate-800 animate-pulse ml-1"
        />
      </div>
      <!-- 工具调用步骤 -->
      <ToolCallStep
        v-for="step in message.toolCalls"
        :key="step.id"
        :step="step"
        class="mt-2"
      />
      <!-- 引用卡片 -->
      <CitationCard
        v-for="(cite, i) in message.citations"
        :key="i"
        :citation="cite"
        class="mt-2"
      />
    </div>
  </div>
</template>
```

**5. 虚拟滚动消息列表 — `components/MessageList.vue`**

```vue
<!--
  知识点 10.5：虚拟滚动
  
  学习要点：
  - IntersectionObserver 实现懒加载
  - 新消息自动滚动到底部
  - 历史消息向上滚动时暂停自动滚动
-->
<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'

const props = defineProps<{
  messages: Message[]
}>()

const containerRef = ref<HTMLElement>()
const shouldAutoScroll = ref(true)

// 用户滚动检测
function onScroll() {
  if (!containerRef.value) return
  const { scrollTop, scrollHeight, clientHeight } = containerRef.value
  // 距底部 <100px 时恢复自动滚动
  shouldAutoScroll.value = (scrollHeight - scrollTop - clientHeight) < 100
}

// 新消息自动滚动
watch(() => props.messages.length, async () => {
  if (!shouldAutoScroll.value) return
  await nextTick()
  containerRef.value?.scrollTo({
    top: containerRef.value.scrollHeight,
    behavior: 'smooth',
  })
})

onMounted(onScroll)
</script>

<template>
  <div
    ref="containerRef"
    class="flex-1 overflow-y-auto px-4 py-6 space-y-6"
    @scroll="onScroll"
  >
    <UserMessage
      v-for="msg in messages"
      :key="msg.id"
      v-if="msg.role === 'user'"
      :message="msg"
    />
    <AIMessage
      v-else
      :message="msg"
    />
    <!-- 流式占位骨架 -->
    <div
      v-if="messages[messages.length - 1]?.streaming"
      class="flex gap-3 animate-pulse"
    >
      <div class="w-8 h-8 rounded-full bg-slate-200" />
      <div class="flex-1 space-y-2">
        <div class="h-4 w-3/4 bg-slate-200 rounded" />
        <div class="h-4 w-1/2 bg-slate-200 rounded" />
      </div>
    </div>
  </div>
</template>
```

#### 📱 C 端生产化改造

| 维度 | 改造方案 |
|------|----------|
| **消息持久化** | localStorage 自动保存会话历史（含流式中断的半截消息），刷新恢复 |
| **输入体验** | `textarea` 自适应高度（最大 120px），Enter 发送 / Shift+Enter 换行 |
| **代码交互** | 代码块右上角「复制」按钮 + 语言标签 + 「在沙箱中运行」按钮 |
| **长消息折叠** | AI 回复 >500 字时默认折叠，前 3 行 + 「展开全部」按钮 |
| **多模态** | 支持图片上传（base64 → BFF），图片在消息中缩略展示 + 点击放大 |
| **国际化** | AI 回复的「引用」「步骤」等标签支持 i18n（中文/英文/日文） |
| **无障碍** | 流式光标用 `aria-live="polite"` 通知屏幕阅读器新内容 |
| **性能** | 100+ 历史会话用虚拟列表（IntersectionObserver），懒加载消息 |

#### 🤝 与 React 对照

| Vue 3 | React 18 | 说明 |
|---|---|---|
| `ref<T>()` | `useState<T>()` | 响应式状态 |
| `computed()` | `useMemo()` | 派生状态 |
| `watch()` | `useEffect()` | 副作用监听 |
| `onMounted()` | `useEffect(() => {}, [])` | 挂载时执行 |
| `shallowRef()` | `useRef()` | 浅层响应式 |
| `defineProps<T>()` | 函数参数解构 | 类型化 props |
| Pinia Store | Zustand Store | 状态管理 |
| `v-html` + `marked` | `dangerouslySetInnerHTML` | Markdown 渲染 |
| SFC `<script setup>` | TSX 函数组件 | 组件写法 |
| Nuxt `useRuntimeConfig()` | `import.meta.env` | 环境变量 |

#### 🧠 AI + C 端专属面试题

**题 1（中级 · 原理）**：AI 流式聊天界面，如何实现「打字机效果」而不卡顿？

> **答案要点**：
> 1. **SSE 消费**：用 `fetch + ReadableStream` 逐 chunk 读取，每个 chunk 可能包含 1-N 个 token
> 2. **增量更新**：每个 chunk 到达时直接修改 message.content，Vue 3 的 Proxy 能精确触发 re-render
> 3. **避免的做法**：不要用 `setInterval` 模拟打字机，会导致内容跳跃和性能浪费
> 4. **光标动画**：CSS `@keyframes` + `animation-pulse`，在 `streaming: true` 时显示
> 5. **骨架屏过渡**：AI 回复到达前显示骨架屏，第一个 token 到达后无缝切换到内容 + 光标

**题 2（中级 · 设计）**：用户网络中断后恢复，如何保证消息不丢？

> **答案要点**：
> 1. **乐观更新**：用户发消息时立即显示，不等 AI 回复。即使断网，消息草稿也保存在本地
> 2. **本地持久化**：每 300ms 防抖将 messages 写入 localStorage
> 3. **断点续传**：重连时传 `last_message_id` 给 BFF，从该 ID 之后继续推送
> 4. **重连策略**：指数退避（1s → 2s → 4s → 8s → 最大 30s）
> 5. **状态标记**：每条消息有 `status: sent / streaming / completed / error`，UI 根据状态显示不同样式
> 6. **错误恢复**：`error` 状态的消息显示「重试」按钮，点击后重新发送

**题 3（高级 · 性能）**：AI 产品需要同时支持 50+ 历史会话和 1000+ 条消息。如何优化前端性能？

> **答案要点**：
> 1. **Pinia 分桶存储**：`messages: Record<sessionId, Message[]>`，切换会话时只渲染当前会话的消息
> 2. **虚拟滚动**：消息列表超过 50 条时启用虚拟滚动，只渲染可视区域的 DOM
> 3. **懒加载**：历史会话的消息按需加载（点击会话时才拉取），不要一次性加载全部
> 4. **shallowRef**：会话列表用 `shallowRef` 避免深层响应式开销
> 5. **防抖持久化**：localStorage 写入用 300ms 防抖，避免频繁 I/O
> 6. **Markdown 缓存**：已渲染过的 Markdown 结果缓存，避免重复解析
> 7. **代码高亮延迟**：长代码块的 Shiki 高亮在 `IntersectionObserver` 进入视口时才执行

---

### 8.2 Function Calling 前端可视化

#### 💡 JS 基础补充 A.8：Iterator + 解构 + 展开运算符

工具调用步骤的时间线本质是**有序事件流**：

```typescript
// 用数组模拟事件流的状态转换
const timeline: TimelineStep[] = [
  { type: 'start', time: 1000 },
  { type: 'tool_call', name: 'search_template', args: {...}, time: 1050 },
  { type: 'tool_result', result: [...], time: 2000 },
  { type: 'tool_call', name: 'execute_code', args: {...}, time: 2050 },
  { type: 'final', content: '生成完成', time: 3000 },
]
```

#### 🤖 AI 场景价值

Function Calling 最大的用户体验挑战是**让用户理解 AI 在做什么**。可视化时间线将黑盒变透明：
- 用户问「生成一个商品卡片」，看到时间线：`🔍 搜索模板 → ⚡ 执行代码 → ✅ 返回结果`
- 如果出错，用户能看到是哪一步出了问题（搜索没结果？代码报错？）

#### 📚 主线知识点原理解析

**SSE 事件 → 时间线状态机**：

```
SSE 事件流:
  state_snapshot → node_start(think) → on_chain_stream* → node_start(call_tools)
  → tool_call_start → tool_call_args → tool_call_result → node_start(observe)
  → state_snapshot → node_start(answer) → final_answer → stream_end

前端状态转换:
  idle → thinking → calling_tool → observing → thinking → ... → answering → completed
```

#### 💻 代码实现

**1. Agent 时间线 Composable — `composables/useAgent.ts`**

```typescript
/**
 * 知识点 11.2：Agent 时间线
 * 
 * 学习要点：
 * - SSE 事件类型 → TimelineStep 状态转换
 * - 逐步追加：每个事件 append 到 timeline 数组
 * - 支持暂停/恢复/回滚操作
 */

export interface TimelineStep {
  id: string
  type: 'thinking' | 'tool_call' | 'tool_result' | 'observing' | 'answer' | 'error'
  title: string
  description?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  timestamp: number
  data?: unknown
}

export function useAgent() {
  const steps = ref<TimelineStep[]>([])
  const status = ref<'idle' | 'running' | 'paused' | 'completed' | 'failed'>('idle')

  function processEvent(event: AgentStreamEvent) {
    switch (event.type) {
      case 'node_start':
        handleNodeStart(event)
        break
      case 'tool_call_start':
        addStep({
          type: 'tool_call',
          title: `调用工具: ${event.name}`,
          status: 'running',
          timestamp: Date.now(),
          data: event.args,
        })
        break
      case 'tool_call_end':
        updateLastStep('tool_call', {
          status: 'completed',
          description: '执行完成',
          data: event.result,
        })
        break
      case 'final_answer':
        addStep({
          type: 'answer',
          title: '生成最终回答',
          description: event.content,
          status: 'completed',
          timestamp: Date.now(),
        })
        status.value = 'completed'
        break
      case 'error':
        status.value = 'failed'
        break
      case 'state_snapshot':
        status.value = event.state.status
        break
    }
  }

  function addStep(step: Omit<TimelineStep, 'id'>) {
    steps.value.push({ ...step, id: crypto.randomUUID() })
  }

  function updateLastStep(type: TimelineStep['type'], update: Partial<TimelineStep>) {
    // 找到最后一个匹配 type 的步骤
    for (let i = steps.value.length - 1; i >= 0; i--) {
      if (steps.value[i].type === type) {
        steps.value[i] = { ...steps.value[i], ...update }
        break
      }
    }
  }

  function reset() {
    steps.value = []
    status.value = 'idle'
  }

  return { steps, status, processEvent, reset }
}
```

**2. Agent 时间线组件 — `components/AgentTimeline.vue`**

```vue
<!--
  知识点 11.3：时间线 UI
  
  学习要点：
  - 步骤连接：用 CSS border-left 实现时间线竖线
  - 状态图标：不同步骤类型用不同 emoji/icon
  - 动画：running 状态用 pulse 动画
-->
<script setup lang="ts">
defineProps<{
  steps: TimelineStep[]
  status: string
}>()

const iconMap: Record<string, string> = {
  thinking: '💭',
  tool_call: '🔧',
  tool_result: '📋',
  observing: '👀',
  answer: '✨',
  error: '❌',
}

const colorMap: Record<string, string> = {
  pending: 'bg-slate-100 border-slate-300',
  running: 'bg-blue-50 border-blue-400',
  completed: 'bg-green-50 border-green-400',
  failed: 'bg-red-50 border-red-400',
}
</script>

<template>
  <div class="relative pl-6 py-4">
    <!-- 时间线竖线 -->
    <div class="absolute left-2 top-0 bottom-0 w-0.5 bg-slate-200" />

    <div
      v-for="(step, i) in steps"
      :key="step.id"
      class="relative mb-4"
    >
      <!-- 节点圆点 -->
      <div
        class="absolute -left-4 w-4 h-4 rounded-full border-2 flex items-center justify-center text-xs"
        :class="colorMap[step.status]"
        :class="{ 'animate-pulse': step.status === 'running' }"
      >
        {{ iconMap[step.type] }}
      </div>

      <!-- 步骤内容 -->
      <div class="ml-2">
        <div class="text-sm font-medium text-slate-700">{{ step.title }}</div>
        <div v-if="step.description" class="text-xs text-slate-500 mt-1">
          {{ step.description }}
        </div>

        <!-- 参数展示 -->
        <div
          v-if="step.type === 'tool_call' && step.data"
          class="mt-2 p-2 rounded bg-slate-50 text-xs font-mono overflow-x-auto"
        >
          {{ JSON.stringify(step.data, null, 2) }}
        </div>

        <!-- 结果摘要 -->
        <div
          v-if="step.type === 'tool_result' && step.data"
          class="mt-1 text-xs text-green-600"
        >
          ✅ 返回: {{ truncate(JSON.stringify(step.data), 100) }}
        </div>
      </div>
    </div>

    <!-- 正在执行提示 -->
    <div
      v-if="status === 'running' && steps[steps.length - 1]?.status === 'running'"
      class="relative mt-2 flex items-center gap-2 text-xs text-blue-500"
    >
      <div class="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
      Agent 正在执行...
    </div>
  </div>
</template>
```

#### 📱 C 端生产化改造

| 维度 | 改造方案 |
|------|----------|
| **步骤折叠** | 每个步骤默认折叠，只显示标题+状态。点击展开查看参数/结果详情 |
| **快速回滚** | 每个已完成步骤旁有「从这里重新执行」按钮，点击 rollback + resume |
| **实时进度** | Agent 每步更新时，时间线用 CSS transition 平滑过渡 |
| **错误可视化** | 失败步骤用红色边框 + 错误摘要 + 「重试」按钮（该步骤重跑） |
| **可导出** | 时间线支持「导出 JSON」供调试 |

#### 🧠 AI + C 端专属面试题

**题 1（中级 · 设计）**：Agent 时间线如何支持用户「回滚到第 N 步重新执行」？前后端需要怎么配合？

> **答案要点**：
> 1. **前端**：每个已完成步骤旁有「↺ 从此处重试」按钮，点击后发送 `POST /api/agent/:threadId/rollback`
> 2. **后端**：`rollback(threadId, step)` 截断 messages 和 toolCalls 到指定步骤前
> 3. **恢复**：`resume(threadId, userInput)` 从断点继续执行
> 4. **前端状态**：rollback 后 timeline 截断到第 N 步，后续步骤清空，status 恢复为 running
> 5. **UX 细节**：rollback 前弹窗确认「确定从第 N 步重新执行吗？之后的步骤将被清除」

**题 2（高级 · UX 设计）**：Agent 执行 20+ 步时，时间线如何处理信息过载？

> **答案要点**：
> 1. **默认折叠**：已完成步骤默认只显示标题+状态图标，点击展开详情
> 2. **进度条**：顶部显示进度条（已完成步数 / 最大步数），让用户知道还有多久
> 3. **关键步骤高亮**：answer 步骤用紫色高亮，tool_call 步骤用蓝色，快速区分
> 4. **智能筛选**：提供「只看错误」「只看工具调用」筛选器
> 5. **虚拟滚动**：步骤 >30 时启用虚拟滚动
> 6. **时间戳**：每个步骤显示相对时间（「2 秒前」），方便判断执行耗时

---

## 实践任务

### 任务 1：AI 聊天界面

- [ ] 实现 `useSSE.ts` composable（fetch + ReadableStream + AbortController）
- [ ] 实现 `useChat.ts` composable（乐观更新 + 流式追加）
- [ ] 实现 Pinia chat store（会话 CRUD + 消息分桶 + 持久化）
- [ ] 实现 `AIMessage.vue`（Markdown 渲染 + 打字机光标）
- [ ] 实现 `MessageList.vue`（虚拟滚动 + 自动滚动 + 骨架屏）

### 任务 2：Function Calling 可视化

- [ ] 实现 `useAgent.ts` composable（SSE 事件 → 时间线状态转换）
- [ ] 实现 `AgentTimeline.vue`（步骤时间线 + 状态图标 + 动画）
- [ ] 实现工具参数/结果的展示卡片
- [ ] 实现暂停/恢复/回滚操作的 UI

### 任务 3：响应式布局

- [ ] 实现 375px 移动端适配（Tailwind responsive + 安全区域）
- [ ] 实现侧边栏抽屉（移动端折叠，桌面端展开）
- [ ] 实现输入框自适应高度
- [ ] 实现代码块复制/运行功能

---

## 检验标准

- [ ] SSE 流式消费正确：打字机效果流畅，无闪烁
- [ ] 用户可中断流式生成（点击停止按钮 → AbortController）
- [ ] 会话历史持久化：刷新后恢复
- [ ] 工具调用步骤可视化：用户能看到 AI 做了什么
- [ ] Agent 支持暂停/恢复/回滚
- [ ] 响应式布局：移动端可用
- [ ] 代码块语法高亮 + 复制功能
