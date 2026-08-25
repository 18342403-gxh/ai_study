# 模块 2：流式响应

## 学习目标

- 理解 SSE（Server-Sent Events）协议的工作原理
- 掌握 `ReadableStream` + `TextDecoder` 处理流式数据
- 实现打字机效果的逐字输出，包含粘包处理
- 使用 `AbortController` 实现流式中断
- 构建生产级 `useStreaming` composable，支持状态管理、错误恢复和代码块提取

---

## 知识点

### 知识点 1：SSE 协议与 ReadableStream 基础

#### 💡 JS 基础补充

- **异步迭代器 `for...of`**：`ReadableStream` 的 `reader.read()` 返回 `{ value, done }`，配合 `while(true)` 循环消费
- **`TextDecoder`**：将 `Uint8Array`（二进制）解码为字符串，支持流式解码（`{ stream: true }`）
- **可选链 `?.`**：`response.body?.getReader()` 安全访问可能为 null 的 body
- **解构赋值**：`const { value, done } = await reader.read()` 直接解构 ReadableStream 读取结果

#### 💡 浏览器基础补充

- **ReadableStream API**：Fetch API 的 `response.body` 是一个 `ReadableStream`，代表可异步读取的字节流
- **`getReader()`**：获取流的读取器，返回 `{ read(), cancel() }` 方法
- **流消费模型**：读取器是独占的，一个 `ReadableStream` 同时只能有一个 reader
- **`TextDecoder({ stream: true })`**：流式解码模式，内部维护多字节字符的部分解码状态，避免 UTF-8 多字节字符被截断

#### 🤖 AI 场景价值

流式响应是 AI 产品**用户体验的核心差异点**。在 AI 组件生成器中，用户输入需求后，非流式模式需要等待 5-15 秒才能看到第一行代码，而流式模式下用户在 0.5 秒内就能看到代码开始逐字出现。这种"即时反馈"的体验让用户感觉 AI 在"实时思考"，而不是"卡死了"。研究表明，流式响应可将用户流失率降低 40%+。

#### 📚 主线知识点原理解析

**SSE（Server-Sent Events）协议格式**：

```
data: {"choices":[{"delta":{"content":"<"}},{"finish_reason":null}]}

data: {"choices":[{"delta":{"content":"div"}}]}

data: {"choices":[{"delta":{"content":" class=\""}},{"finish_reason":null}]}

data: [DONE]

```

**核心规则**：
1. 每条消息以 `data: ` 开头，以 `\n\n`（两个换行符）分隔事件
2. 流结束时发送 `data: [DONE]` 标记
3. 每个 chunk 是**增量内容**（delta），需要前端拼接
4. `TextDecoder` 配合 `{ stream: true }` 确保多字节字符（如中文、emoji）不会被截断

**流式数据处理管线**：

```
服务器 SSE 响应
    │
    ▼
ReadableStream (response.body)
    │ getReader()
    ▼
reader.read() → Uint8Array (二进制 chunk)
    │ TextDecoder.decode({ stream: true })
    ▼
字符串 chunk → buffer 拼接
    │ split('\n') 处理粘包
    ▼
解析 JSON → 提取 delta.content
    │
    ▼
拼接全文 → 触发 UI 更新
```

#### 💻 代码实现（Vue3 + Nuxt3）

**BFF 层流式输出** — `apps/server/src/routes/chat.ts`：

```typescript
router.post('/completions', async (req, res) => {
  const { messages, model, stream, temperature } = req.body

  const chain = createChatChain({ model, temperature })

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const controller = new AbortController()
    req.on('close', () => controller.abort())

    await chain.stream(
      { messages, stream: true },
      (delta) => {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
      },
      controller.signal
    )

    res.write('data: [DONE]\n\n')
    res.end()
  }
})
```

**BFF 模型层流式** — `apps/server/src/services/chain/model.ts`：

```typescript
async *stream(input, options) {
  const response = await fetch(`${API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: modelName, messages: input, temperature, stream: true }),
    signal: options?.signal,
  })

  const reader = response.body?.getReader()
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
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      if (trimmed === 'data: [DONE]') return

      try {
        const json = JSON.parse(trimmed.slice(6))
        const delta = json.choices?.[0]?.delta?.content || ''
        if (delta) yield delta
      } catch {}
    }
  }
}
```

**前端消费 SSE 流** — `composables/useChat.ts`：

```typescript
const sendMessage = async (content: string) => {
  const config = useRuntimeConfig()
  const response = await fetch(`${config.public.bffUrl}/api/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [...currentMessages.value.map(m => ({ role: m.role, content: m.content }))],
      stream: true,
    }),
  })

  if (!response.ok) throw new Error(`请求失败: ${response.status}`)

  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    buffer += chunk

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue

      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content || ''
        if (delta) {
          fullContent += delta
          streamingContent.value = fullContent
          updateLastAssistant(fullContent)
        }
      } catch {}
    }
  }

  updateLastAssistant(fullContent)
}
```

#### 📱 C 端生产化改造

1. **粘包处理**：每个 chunk 用 `buffer.split('\n')` 分割，`buffer.pop()` 保留未完成的行到下一轮
2. **中文/emoji 兼容**：`TextDecoder({ stream: true })` 确保多字节字符不被截断
3. **代码块实时提取**：流式过程中用正则 `/```[\s\S]*?```/` 匹配代码块，实时提取代码
4. **自动滚动到底部**：监听 `streamingContent` 变化，`watchEffect` 自动滚动聊天容器
5. **流式状态持久化**：流式中断时已接收的内容保留在消息中，不丢失

#### 🤝 与 React 对照

| 能力 | Vue3 + Nuxt3 | React |
|------|-------------|-------|
| 响应式更新 | `streamingContent.value = fullContent` | `setContent(fullContent)` |
| 自动滚动 | `watchEffect` + `nextTick` DOM 操作 | `useEffect` + `useRef` DOM 操作 |
| 流式状态 | `ref<string>` 直接拼接 | `useState<string>` 拼接 |
| Reader 管理 | `reader.read()`（同） | `reader.read()`（同） |
| SSE 解析 | `buffer.split('\n')`（同） | `buffer.split('\n')`（同） |

#### 🧠 面试题 / 常见坑

**AI 产品场景题（80%+）：**

> **Q1**：AI 组件生成器使用流式响应返回代码，但用户反馈偶尔会出现代码"粘在一起"（没有换行）或"截断"的情况。请分析原因和解决方案。

**答**：这是典型的**粘包/拆包问题**。原因：(1) TCP 层的 Nagle 算法会合并小包，一个 chunk 可能包含多条 SSE 消息（粘包）；(2) 一个 SSE 消息可能被拆分到多个 chunk（拆包）；(3) `TextDecoder` 未使用 `{ stream: true }` 导致多字节字符被截断。解决方案：① 使用 buffer 累积 chunk，按 `\n` 分割处理，`buffer.pop()` 保留未完成的行；② `TextDecoder` 使用 `{ stream: true }` 参数；③ 正确处理 `data: ` 前缀（注意冒号后可能有空格）。

> **Q2**：AI 产品中的流式响应如何实现"停止生成"功能？用户点击停止后应该做什么？

**答**：(1) 使用 `AbortController`——创建 `controller.signal` 传递给 fetch，用户点击停止时调用 `controller.abort()`；(2) BFF 层监听 `req.on('close')` 事件，客户端断开时立即中断上游 LLM 调用（避免浪费 token）；(3) 前端保留已接收的内容作为最终回复，标记为"已中断"；(4) 显示"已停止"提示，允许用户基于已有内容继续对话。

> **Q3**：流式响应过程中如果网络闪断（1-2 秒后恢复），如何实现自动恢复而不丢失已生成的内容？

**答**：(1) **断点续传**——前端记录已接收的完整内容，重连时将已有内容作为上下文发送给 AI，请求从断点继续（需 BFF 支持）；(2) **临时保存**——流式过程中每收到 N 个 chunk 就将当前内容写入 `localStorage`，网络恢复后从保存点继续；(3) **幂等设计**——BFF 为每次流式请求生成唯一 ID，重连时通过 ID 继续传输而非重新生成；(4) **用户感知**——显示"网络中断，正在尝试恢复..."提示，恢复成功后自动隐藏。

**通用技术题：**

> **Q4**：SSE 和 WebSocket 有什么区别？为什么 AI 产品选择 SSE 而不是 WebSocket？

**答**：SSE 优势：(1) 基于 HTTP，无需额外协议升级，穿透性好（WebSocket 在某些企业网络被禁用）；(2) 服务端单向推送，适合 AI 场景（AI 输出是单向的，用户不需要实时双向通信）；(3) 自动重连（浏览器内置）；(4) 更轻量，无握手开销。WebSocket 优势：(1) 双向通信；(2) 更低延迟；(3) 支持二进制传输。AI 产品选择 SSE 的核心原因：AI 输出是**单向流式传输**，不需要双向通信，SSE 更简单、更可靠。

> **Q5**：`TextDecoder` 的 `{ stream: true }` 参数到底做了什么？不加会有什么问题？

**答**：`{ stream: true }` 告诉 TextDecoder 进入流式模式，在多次 `decode()` 调用之间保留多字节字符的状态。UTF-8 编码中，一个中文/emoji 通常占 3-4 个字节。如果一个 chunk 在多字节字符的中间切割（如前 2 个字节在 chunk1，最后 1 个字节在 chunk2），没有 `stream: true` 时 chunk1 会解码出错误字符（`�`），chunk2 开头也会出现乱码。加上 `stream: true` 后，TextDecoder 会缓存不完整的字节序列，等下一个 chunk 到来时再正确解码。

---

### 知识点 2：useStreaming Composable 设计

#### 💡 JS 基础补充

- **模块级单例**：在 composable 外部定义 `ref`，所有组件共享同一状态实例，避免重复请求
- **闭包陷阱**：流式循环中的变量必须通过 ref 或闭包正确传递，避免拿到过期值
- **`while(true)` + `break`**：ReadableStream 的标准消费模式，`done` 信号作为退出条件

#### 💡 浏览器基础补充

- **`reader.cancel()`**：主动取消流读取，释放资源，与 `AbortController.abort()` 效果类似但作用于不同层级
- **`DOMException: AbortError`**：`AbortController.abort()` 触发的错误类型，需用 `err.name === 'AbortError'` 判断
- **渲染节流**：高频更新 `ref` 会触发 Vue 的批量更新（nextTick），但过于频繁的更新仍可能造成性能问题

#### 🤖 AI 场景价值

`useStreaming` composable 是 AI 产品的**流式引擎**。它封装了 SSE 协议解析、状态管理、中断控制等底层细节，上层组件只需调用 `start()` / `stop()` 就能实现流式对话。在 AI 组件生成器中，这个 composable 不仅用于对话场景，还复用到代码生成预览、文档摘要、代码审查等所有需要流式体验的功能中。

#### 📚 主线知识点原理解析

**状态机设计**：

```
          start()            stream完成
idle ───────────► streaming ──────────► done
                       │                  │
                       │ stop()/abort()   │ reset()
                       ▼                  ▼
                    aborted ◄────────────┘
```

**核心 API 设计**：

```typescript
interface UseStreamingReturn {
  content: Ref<string>              // 已接收的完整内容
  status: Ref<'idle' | 'streaming' | 'done' | 'aborted'>
  isLoading: Ref<boolean>
  error: Ref<string>
  streamingContent: Ref<string>     // 流式展示用内容（可能包含代码块）
  start: (messages: ChatMessage[]) => Promise<void>
  stop: () => void
}
```

**设计要点**：
1. **状态隔离**：`content` 存完整内容，`streamingContent` 存流式展示内容，`status` 标记当前状态
2. **并发保护**：`start()` 先检查 `status.value === 'streaming'` 防止重复调用
3. **资源清理**：`stop()` 同时调用 `controller.abort()` 和 `reader?.cancel()` 确保彻底中断
4. **错误边界**：区分 AbortError（预期中断）和其他错误（需要展示错误信息）

#### 💻 代码实现（Vue3 + Nuxt3）

**useStreaming composable** — `composables/useStreaming.ts`：

```typescript
import { ref } from 'vue'
import type { ChatMessage } from './useChat'

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'aborted'

const status = ref<StreamStatus>('idle')
const isLoading = ref(false)
const content = ref('')
const streamingContent = ref('')
const error = ref('')

let controller: AbortController | null = null
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

export function useStreaming() {
  const start = async (messages: ChatMessage[]) => {
    if (status.value === 'streaming') return

    status.value = 'streaming'
    isLoading.value = true
    error.value = ''
    content.value = ''
    streamingContent.value = ''

    controller?.abort()
    controller = new AbortController()

    try {
      const config = useRuntimeConfig()
      const response = await fetch(`${config.public.bffUrl}/api/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          stream: true,
        }),
        signal: controller.signal,
      })

      if (!response.ok) throw new Error(`请求失败: ${response.status}`)

      reader = response.body?.getReader()
      if (!reader) throw new Error('无法获取响应流')

      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        buffer += chunk

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data:')) continue

          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue

          try {
            const json = JSON.parse(data)
            const delta = json.choices?.[0]?.delta?.content || ''
            if (delta) {
              fullContent += delta
              content.value = fullContent
              streamingContent.value = fullContent
            }
          } catch {}
        }
      }

      status.value = 'done'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        status.value = 'aborted'
      } else if (err instanceof Error) {
        error.value = err.message
        status.value = 'idle'
      }
    } finally {
      isLoading.value = false
      reader?.cancel()
      controller = null
      reader = null
    }
  }

  const stop = () => {
    controller?.abort()
    reader?.cancel()
    status.value = 'aborted'
    isLoading.value = false
  }

  const reset = () => {
    status.value = 'idle'
    content.value = ''
    streamingContent.value = ''
    error.value = ''
  }

  return { status, isLoading, content, streamingContent, error, start, stop, reset }
}
```

**在 ChatInput 组件中使用**：

```vue
<script setup lang="ts">
const { start, stop, status } = useStreaming()
const { currentMessages, addMessage, updateLastAssistant } = useChat()
const input = ref('')

const send = async () => {
  if (!input.value.trim()) return

  const userMsg = { id: genId(), role: 'user' as const, content: input.value, timestamp: Date.now() }
  addMessage(userMsg)

  const assistantMsg = { id: genId(), role: 'assistant' as const, content: '', timestamp: Date.now() }
  addMessage(assistantMsg)

  await start([...currentMessages.value, userMsg])
  updateLastAssistant(content.value)
  input.value = ''
}

const isStreaming = computed(() => status.value === 'streaming')
</script>

<template>
  <div class="chat-input">
    <button v-if="isStreaming" @click="stop" class="stop-btn">■ 停止</button>
    <button v-else @click="send" :disabled="!input.trim()">发送</button>
    <textarea v-model="input" placeholder="输入你的需求..." />
  </div>
</template>
```

#### 📱 C 端生产化改造

1. **状态持久化**：流式状态（content）实时写入 IndexedDB，页面刷新后恢复
2. **代码块检测**：流式过程中检测到 ` ``` ` 代码块时自动切换代码渲染模式
3. **渲染频率控制**：使用 `requestAnimationFrame` 每帧最多更新一次 DOM，避免高频重渲染
4. **内存优化**：长响应时 content 可能达到数万字符，定期将内容移入消息历史以释放内存
5. **多点触控支持**：移动端触摸手势与流式状态正确交互，不中断流式

#### 🤝 与 React 对照

| 能力 | Vue3 useStreaming | React useStreaming |
|------|-------------------|-------------------|
| 状态管理 | 模块级 `ref`（单例） | `useState` + `useRef` |
| 并发保护 | `status.value === 'streaming'` | `status === 'streaming'` |
| 中断控制 | `controller.abort()` | `controllerRef.current?.abort()` |
| 流消费 | `reader.read()` 循环（同） | `reader.read()` 循环（同） |
| 代码提取 | `fullContent.match()`（同） | `fullContent.match()`（同） |
| 状态更新 | `content.value = fullContent` | `setContent(fullContent)` |
| DOM 节流 | `watchEffect` + `nextTick` | `useEffect` + `useRef` |

#### 🧠 面试题 / 常见坑

**AI 产品场景题（80%+）：**

> **Q1**：AI 产品中，用户在流式生成过程中关闭了页面/切换了路由，应该怎么处理？

**答**：(1) **组件卸载清理**——在 `onUnmounted` 钩子中调用 `controller.abort()` 中断请求，避免内存泄漏；(2) **状态持久化**——已接收的内容保存到 session 级存储，用户回来后可以恢复；(3) **服务端停止**——通过 `AbortController` 的 signal，BFF 层会检测到客户端断开，立即中断上游 LLM 调用（避免浪费 token）；(4) **优雅降级**——如果用户是误操作（如刷新页面），可在页面重新加载时检测到未完成的会话，询问用户是否继续。

> **Q2**：流式响应中如何实现"边生成边渲染 Markdown/代码高亮"？注意什么性能问题？

**答**：方案——(1) 使用支持增量渲染的 Markdown 解析器（如 `marked` 的 `parse` 方法）；(2) 每次收到新 chunk 时重新解析整个内容并渲染；(3) 使用 `watchEffect` + 防抖/throttle（如 16ms = 一帧）控制渲染频率。性能注意：① 完整重解析在长内容时会有性能问题，可考虑增量解析方案；② 代码高亮库（如 Prism.js）对大块内容的高亮可能耗时较长，可使用 `Web Worker` 处理；③ 使用虚拟滚动 + Markdown 渲染，避免 DOM 节点过多。

> **Q3**：AI 流式生成代码时，需要提取代码块放入代码预览器实时预览。如何在流式过程中做到"实时"？

**答**：(1) **流式正则匹配**——每接收新 chunk 后，用正则 `/```[\s\S]*?```/` 重新匹配完整代码块；(2) **增量提取优化**——只检测新增内容是否包含 ` ``` ` 开始/结束标记，避免每次全量匹配；(3) **代码预览器热更新**——检测到代码块变化时，通过 `postMessage` 或事件通知 iframe 预览器重新渲染；(4) **边界处理**——未完成的代码块（只有开始 ` ``` ` 没有结束 ` ``` `）也应该在预览器中显示，给用户即时反馈。

**通用技术题：**

> **Q4**：ReadableStream 的读取器（reader）是独占的吗？如果多个组件同时读取同一个 body 会怎样？

**答**：是的，ReadableStream 的读取器是**独占的**。一旦通过 `getReader()` 获取了读取器，流就被"锁定"（locked），不能再被其他读取器消费。如果尝试获取第二个读取器会抛出 `TypeError`。同样，`response.body` 也是独占的——只能被消费一次。如果需要多次消费（如缓存 + 透传），可以使用 `response.body.tee()` 创建两个独立的流分支。

> **Q5**：`AbortController.abort()` 和 `reader.cancel()` 有什么区别？什么时候该用哪个？

**答**：`abort()` 作用于**请求层面**——中断 fetch 的底层 TCP 连接，`reader.cancel()` 作用于**流消费层面**——释放读取器但不一定中断底层连接。选择策略：(1) 用户主动取消 → `abort()`（彻底中断，释放网络资源）；(2) 只是想停止读取但保留连接 → `reader.cancel()`（如转发场景）；(3) AI 产品场景通常用 `abort()`，因为不需要保留连接，彻底释放资源更干净。

---

### 知识点 3：SSE 解析器与粘包处理

#### 💡 JS 基础补充

- **缓冲区（Buffer）模式**：TCP 通信的经典模式，发送方的消息边界在接收方可能被打破
- **`split('\n')` 处理**：`lines.pop()` 获取最后一个元素（可能是不完整的行），保留在 buffer 中
- **正则 `/\r?\n/`**：兼容 Windows（`\r\n`）和 Unix（`\n`）的换行符
- **JSON `try-catch`**：解析 SSE 数据必须用 try-catch 包裹，单行解析失败不影响整体流程

#### 💡 Node 基础补充

- **`res.write()` 不保证立即发送**：Node.js 的 HTTP 响应使用缓冲区，可通过 `res.flushHeaders()` 或设置合适的超时控制确保数据及时推送
- **`Connection: keep-alive`**：SSE 必须设置此头部，保持 HTTP 连接不中断
- **`text/event-stream` Content-Type**：SSE 标准 MIME 类型，部分代理/CDN 需要特殊配置支持

#### 🤖 AI 场景价值

在 AI 组件生成器中，SSE 解析的**健壮性直接决定用户体验的稳定性**。粘包处理不当会导致：代码显示错乱、响应内容丢失、JSON 解析崩溃。一个生产级的 SSE 解析器需要处理至少 5 种边界情况：粘包、拆包、多字节字符截断、空行/注释行、[DONE] 标记。

#### 📚 主线知识点原理解析

**SSE 数据格式严格规范**：

```
data: {"choices":[{"delta":{"content":"你好"}}]}
              ← 注意：data 与内容之间有一个空格
              
data: [DONE]
```

**五种边界情况**：

| 情况 | 描述 | 处理方式 |
|------|------|---------|
| 粘包 | 一个 chunk 包含多条 SSE 消息 | `buffer.split('\n')` 分割处理 |
| 拆包 | 一条 SSE 消息被拆分到两个 chunk | `buffer.pop()` 保留未完成的行 |
| 多字节截断 | UTF-8 字符在 chunk 边界被截断 | `TextDecoder({ stream: true })` |
| 注释行 | SSE 协议的注释行以 `:` 开头 | `if (line.startsWith(':')) skip` |
| [DONE] | 流结束标记 | 检测到后退出循环 |

**解析器核心设计**：

```typescript
export const createSSEParser = () => {
  let buffer = ''

  return (chunk: string) => {
    buffer += chunk
    const results: string[] = []

    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line || line.startsWith(':')) continue
      if (!line.startsWith('data:')) continue

      const data = line.slice(5).trim()
      if (data === '[DONE]') return { done: true, content: '' }

      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content || ''
        results.push(delta)
      } catch {}
    }

    return { done: false, content: results.join('') }
  }
}
```

#### 💻 代码实现（Vue3 + Nuxt3）

**生产级 SSE 解析器** — `composables/sseParser.ts`：

```typescript
export interface SSEParseResult {
  content: string
  done: boolean
}

const parseLine = (line: string): string | null => {
  if (!line || line.startsWith(':')) return null
  if (!line.startsWith('data:')) return null

  const data = line.slice(5).trim()
  if (data === '[DONE]') return null

  try {
    const json = JSON.parse(data)
    return json.choices?.[0]?.delta?.content || ''
  } catch {
    return null
  }
}

export const createSSEParser = () => {
  let buffer = ''

  return (chunk: string): SSEParseResult => {
    buffer += chunk
    const results: string[] = []

    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''

    for (const line of lines) {
      const delta = parseLine(line.trim())
      if (delta !== null) {
        if (delta === '' && line.trim().startsWith('data: [DONE]')) {
          return { content: results.join(''), done: true }
        }
        results.push(delta)
      }
    }

    return { content: results.join(''), done: false }
  }
}
```

**在 useChat 中集成解析器**：

```typescript
import { createSSEParser } from './sseParser'

const sendMessage = async (content: string) => {
  const parse = createSSEParser()
  let fullContent = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    const text = decoder.decode(value, { stream: true })
    const result = parse(text)

    fullContent += result.content
    streamingContent.value = fullContent
    updateLastAssistant(fullContent)

    if (result.done) break
  }
}
```

#### 📱 C 端生产化改造

1. **解析器单元测试**：覆盖粘包、拆包、空行、注释行、[DONE]、多字节字符等所有边界
2. **解析错误监控**：解析失败的 SSE 行上报到监控系统，分析是否为 BFF 或 LLM 问题
3. **最大行数限制**：buffer 累积超过阈值时做防御性截断，防止内存泄漏
4. **类型安全**：`JSON.parse` 后用 Zod/io-ts 做 schema 验证，确保 delta 结构正确
5. **BFF 心跳机制**：每 15 秒发送 SSE 注释行 `: ping\n\n`，防止中间代理超时断开

#### 🤝 与 React 对照

| 能力 | Vue3 实现 | React 实现 |
|------|----------|-----------|
| 解析器模式 | 工厂函数 `createSSEParser()`（同） | 工厂函数 `createSSEParser()`（同） |
| Buffer 管理 | 闭包变量（同） | `useRef` 存储（同） |
| 结果消费 | `content.value = result` | `setContent(result)` |
| 错误处理 | `try-catch` 单行跳过（同） | `try-catch` 单行跳过（同） |

#### 🧠 面试题 / 常见坑

**AI 产品场景题（80%+）：**

> **Q1**：请手写一个 SSE 解析器，处理粘包/拆包/多字节字符截断等边界情况。

**答**：核心代码如上 `createSSEParser()`。关键实现要点：(1) **闭包 buffer**——通过工厂函数创建闭包变量，跨多次调用保持状态；(2) **`split(/\r?\n/)`**——兼容两种换行符；(3) **`pop()` 保留尾行**——未完成的行留在 buffer 等下一个 chunk；(4) **TextDecoder stream 模式**——处理 UTF-8 多字节截断；(5) **单行 try-catch**——某行解析失败不影响其他行。

> **Q2**：AI 产品的 SSE 流式响应偶尔会卡在中间不动（无新数据但连接未断），可能是什么原因？如何排查？

**答**：原因分析——(1) **LLM 端停顿**——模型在思考/生成中，天然会有停顿；(2) **BFF 代理层缓冲**——Node.js 的 HTTP 响应可能启用了缓冲，数据未立即推送；(3) **中间代理超时**——CDN/Nginx 的超时设置导致连接被静默断开；(4) **客户端 reader 阻塞**——UI 渲染阻塞了 reader 的消费。排查步骤：① BFF 层加日志，确认是否收到 LLM 的 delta；② 设置 `res.flushHeaders()` + 禁用 Node.js HTTP 缓冲；③ 添加 SSE 心跳（`res.write(': ping\n\n')`）；④ 客户端用 `network.oninput` 监控是否有数据到达。

> **Q3**：如何在 SSE 流中传递结构化数据（如组件的名称、类型、属性），而不仅仅是文本 content？

**答**：(1) **扩展 SSE 数据格式**——在 delta 中增加自定义字段，如 `{"choices":[{"delta":{"content":"","component":{"type":"button","props":{...}}}}]}`；(2) **双轨数据流**——content 字段用于文本展示，component 字段用于结构化渲染；(3) **前端解析时分别处理**——检测到 component 字段时触发组件预览更新，检测到 content 时触发文本渲染；(4) **流式增量构建**——component 对象可能是逐步完善的（先有 type，再有 props，再有 events），前端需要支持部分渲染。

**通用技术题：**

> **Q4**：SSE 的 `data: ` 格式中，冒号后面的空格重要吗？`data:{...}` 和 `data: {...}` 有区别吗？

**答**：根据 SSE 规范（W3C），`data:` 后面可以有一个可选空格。规范原文："If the line starts with `data:`, then the field value is the rest of the line with the leading colon and one optional leading U+0020 SPACE character removed." 所以 `data: {JSON}` 是标准格式，`data:{JSON}` 也合法。但注意 `data` 后面**不能没有冒号**。在实际实现中，建议用 `line.slice(5).trim()` 统一处理（去掉 `data:` 前缀和可能的空格）。

> **Q5**：如何设计 SSE 流的错误恢复机制？流中断后如何续传？

**答**：(1) **流 ID + 位置标记**——BFF 为每次流式请求生成唯一 ID，每个 SSE 事件带递增序号；(2) **客户端状态保存**——每收到 N 个事件保存当前状态到 IndexedDB；(3) **断点续传协议**——客户端重连时发送 `Last-Event-ID` 请求头（SSE 标准头），BFF 从断点继续推送；(4) **完整性校验**——全流程结束后校验总内容 hash，确保无丢失；(5) **超时重试**——客户端在 30 秒无新数据时主动重连，带上已接收的内容作为上下文。

---

## 实践任务

### 任务 1：基础流式打字机效果

在 `apps/web-vue-nuxt/composables/useChat.ts` 中完成：
- [ ] 使用 `fetch` + `response.body.getReader()` 消费 SSE 流
- [ ] 使用 `TextDecoder({ stream: true })` 解码二进制数据
- [ ] 正确解析 SSE 格式，提取 `delta.content`
- [ ] 实现逐字展示效果（更新 `streamingContent` ref）

### 任务 2：粘包处理 + 解析器

创建 `composables/sseParser.ts`：
- [ ] 实现 `createSSEParser()` 工厂函数
- [ ] 用 `buffer.split('\n')` + `buffer.pop()` 处理粘包/拆包
- [ ] 处理 `[DONE]` 结束标记
- [ ] 处理空行和注释行（`:` 开头）
- [ ] 为解析器编写单元测试

### 任务 3：停止生成 + AbortController

完善 `sendMessage` 方法：
- [ ] 使用 `AbortController` 实现中断
- [ ] 暴露 `stop()` 方法供 UI 调用
- [ ] 中断后保留已生成内容
- [ ] BFF 层监听 `req.on('close')` 中断上游调用

### 任务 4：代码块实时提取

在流式过程中实现：
- [ ] 检测 ` ``` ` 代码块的开始和结束
- [ ] 实时提取完整代码块（去除标记）
- [ ] 通过 `CodePreview` 组件展示提取的代码
- [ ] 支持 Markdown 渲染（带代码高亮）

---

## 检验标准

- [ ] 流式响应实现逐字展示，无明显卡顿
- [ ] 正确处理粘包/拆包，无内容错乱或丢失
- [ ] 支持"停止生成"功能，中断后保留已有内容
- [ ] 中文/emoji 字符显示正常，无乱码
- [ ] `[DONE]` 标记正确处理，流正常结束
- [ ] 代码块实时提取并在预览器中展示
- [ ] `TextDecoder({ stream: true })` 使用正确
- [ ] 理解 SSE 协议的 5 种边界情况处理
- [ ] 能解释 SSE 与 WebSocket 的核心区别