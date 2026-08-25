# 模块 1：AI API 基础调用

## 学习目标

- 理解大模型 Chat Completions API 的请求/响应结构
- 掌握 BFF 代理架构实现 API Key 安全管理
- 使用 Vue3 + useFetch 发起 AI API 调用并展示结果
- 处理常见错误（401/429/500）和请求超时边界情况
- 理解 Token 计费方式和成本控制

---

## 知识点

### 知识点 1：Chat Completions API 核心概念

#### 💡 JS 基础补充

- **fetch API**：浏览器原生 HTTP 请求方法，返回 Promise，是 AI 调用的基础
- **可选链 `?.`**：安全访问嵌套对象，如 `response.choices?.[0]?.message?.content`
- **空值合并 `??`**：提供默认值，如 `temperature ?? 0.7`
- **Proxy 响应式**：Vue3 的 `ref/reactive` 基于 Proxy 实现依赖收集，对比 React 的 `useState`

#### 🤖 AI 场景价值

在 AI 组件生成器中，用户输入"帮我生成一个登录表单组件"，系统需要将这段自然语言封装成标准的 Chat Completions API 请求发送给大模型。理解 API 的请求结构是后续所有 AI 功能的基石——组件生成、代码审查、对话问答都基于这个接口。

#### 📚 主线知识点原理解析

**Chat Completions API** 是目前所有主流 LLM 提供商（智谱、OpenAI、Anthropic 等）都支持的对话接口。核心结构：

```typescript
interface ChatRequest {
  model: string              // 模型标识，如 "glm-4-flash"、"gpt-4o"
  messages: Message[]        // 消息数组，按顺序组成对话上下文
  temperature?: number       // 0-2，越高随机性越强，代码生成建议 0.2-0.5
  max_tokens?: number        // 最大输出 token 数，防止超长响应
  stream?: boolean           // 是否流式响应（模块 2 详解）
}

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}
```

**三种消息角色** 各司其职：
- `system`：人设和行为规则，始终放在 messages 数组首位
- `user`：用户输入，每轮对话追加一条
- `assistant`：AI 历史回复，用于维持多轮上下文

**Token 计费**：LLM 按 token 计费（输入 + 输出），1 个汉字约 1-2 个 token，1 个英文单词约 1-1.5 个 token。

#### 💻 代码实现（Vue3 + Nuxt3 + useFetch）

**前端 composable** — `composables/useChat.ts`：

```typescript
const sendMessage = async (content: string) => {
  const config = useRuntimeConfig()

  const response = await fetch(`${config.public.bffUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [...currentMessages.value.map((m) => ({ role: m.role, content: m.content }))],
      stream: false,
    }),
  })

  if (!response.ok) throw new Error(`请求失败: ${response.status}`)

  const data = await response.json()
  const reply = data.choices?.[0]?.message?.content || ''
  updateLastAssistant(reply)
}
```

**BFF 代理层** — `apps/server/src/routes/chat.ts`：

```typescript
router.post('/completions', async (req, res) => {
  const { messages, model, temperature } = req.body

  const chain = createChatChain({ model, temperature })

  const result = await chain.invoke({ messages })

  res.json({
    choices: [{
      message: { role: 'assistant', content: result.content },
      finish_reason: 'stop',
    }],
  })
})
```

**BFF 模型层** — `apps/server/src/services/chain/model.ts`：

```typescript
const API_URL = process.env.AI_API_URL || 'https://open.bigmodel.cn/api/paas/v4'
const API_KEY = process.env.AI_API_KEY || ''

async invoke(input) {
  const response = await fetch(`${API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: modelName, messages: input, temperature, stream: false }),
  })

  if (!response.ok) throw new Error(`AI 请求失败 (${response.status})`)
  const data = await response.json()
  return data.choices[0]?.message?.content || ''
}
```

#### 📱 C 端生产化改造

1. **请求超时控制**：`AbortController` + `setTimeout`，30 秒超时自动中断
2. **Loading 状态管理**：`isLoading` ref + 按钮禁用/骨架屏，防止重复提交
3. **Token 预算监控**：显示当前对话消耗的 token 数，接近上限时提示用户
4. **错误分类展示**：401 提示"请检查 API 配置"、429 提示"请求过于频繁"、500 提示"服务暂时不可用"
5. **请求队列**：连续发送消息时排队串行执行，避免多请求并发导致的状态混乱

#### 🤝 与 React 对照

| 能力 | Vue3 + Nuxt3 | React |
|------|-------------|-------|
| 状态管理 | `ref()` / `reactive()` | `useState()` |
| 计算属性 | `computed()` | `useMemo()` |
| 副作用 | `watchEffect()` | `useEffect()` |
| Composable | `useChat()` 模块级单例 | `useChat()` Hook + Context |
| 请求取消 | `AbortController`（同） | `AbortController`（同） |
| 服务端配置 | `useRuntimeConfig()` | `import.meta.env` |
| HTTP 客户端 | `fetch()` / `useFetch()` | `fetch()` / SWR / React Query |

#### 🧠 面试题 / 常见坑

**AI 产品场景题（80%+）：**

> **Q1**：你在开发 AI 组件生成器，用户反馈 AI 有时候会"忘记"之前的要求，比如之前说要用 Vue3，后面又生成了 React 代码。请分析原因并给出解决方案。

**答**：这是典型的上下文窗口限制问题。原因：(1) LLM 的上下文窗口有上限（如 128K token），对话历史过长会导致早期消息被截断；(2) 中间的关键信息（如技术栈要求）被后续大量消息"淹没"。解决方案：① 将"技术栈要求"放入 system prompt，system 消息始终保留；② 实现滑动窗口策略，只保留最近 N 轮对话；③ 对历史对话做摘要压缩，用摘要替代原始消息以节省 token。

> **Q2**：AI 产品中如何设计 API Key 管理方案？前端直接存 Key 有什么风险？请设计一套完整的方案。

**答**：前端暴露 API Key 的风险：(1) 浏览器 DevTools 可直接查看；(2) 爬虫/抓包工具可拦截；(3) 前端代码上传到 CDN 后任何人都能获取。完整方案：① **BFF 代理层**——前端只请求自己的 BFF 接口，BFF 在服务端注入 API Key 后转发给 LLM；② **Key 轮换机制**——支持多 Key 池，按请求量轮询分发；③ **限流策略**——BFF 层按用户/IP 做速率限制，防止 Key 被滥用；④ **环境变量管理**——生产环境 Key 存在服务器环境变量或密钥管理服务（如 Vault），不写入代码。

> **Q3**：AI 组件生成器的请求耗时较长（3-10 秒），如何优化用户体验？

**答**：(1) 流式响应（模块 2 详解）——边生成边展示，用户感知等待时间缩短 70%+；(2) 乐观更新——用户发消息后立即显示用户气泡和"正在输入"动画；(3) 预加载——空闲时预加载模型连接；(4) 并行请求——组件生成 + 代码审查并行调用不同模型；(5) 骨架屏 + 进度条——给用户明确的等待预期。

**通用技术题：**

> **Q4**：fetch 和 XMLHttpRequest 有什么区别？为什么现代 AI 产品选择 fetch？

**答**：fetch 优势：(1) Promise 接口，支持 async/await，代码更简洁；(2) 内建 CORS 支持；(3) 与 Service Worker 原生集成；(4) 支持 ReadableStream，是实现 SSE 流式响应的基础。XMLHttpRequest 优势：(1) 请求进度事件（upload/download progress）；(2) 更广泛的浏览器兼容性。AI 产品选择 fetch 主要因为其与 ReadableStream 的无缝集成为 SSE 流式响应提供了原生支持。

> **Q5**：fetch 的错误处理为什么要额外判断 `response.ok`？

**答**：fetch 只有在**网络层面失败**时（如 DNS 解析失败、网络断开）才会 reject。HTTP 4xx/5xx 错误在 fetch 看来是"成功的 HTTP 响应"，不会触发 reject。因此必须手动检查 `response.ok` 或 `response.status` 来区分 HTTP 错误。这是面试高频考点，约 70% 候选人会踩坑。

---

### 知识点 2：BFF 代理架构与 API Key 安全

#### 💡 浏览器基础补充

- **同源策略（CORS）**：浏览器限制跨域请求，BFF 作为中间层可统一处理 CORS
- **`import.meta.env`**：Vite/Nuxt 环境变量，只有 `VITE_` / `NUXT_` 前缀的变量会暴露给前端
- **SSR 安全**：Nuxt SSR 期间 `localStorage` 不可用，需用 `typeof localStorage !== 'undefined'` 做环境判断

#### 💡 Node 基础补充

- **`process.env`**：Node.js 环境变量，服务端代码可安全读取，不会泄露到前端
- **Express Router**：模块化路由，用 `Router` 实例拆分不同业务路径
- **请求体大小限制**：Express 默认 body parser 限制约 100KB，AI 场景需适当调大

#### 🤖 AI 场景价值

AI 组件生成器的 BFF 层是前端与 LLM 之间的**安全屏障 + 协议适配层**。它解决三个核心问题：(1) **密钥安全**——API Key 只存在服务端；(2) **协议转换**——前端的业务请求格式转换为 LLM 标准格式；(3) **统一入口**——未来切换模型提供商时只需改 BFF，前端无感知。

#### 📚 主线知识点原理解析

**BFF（Backend For Frontend）架构**：

```
┌─────────────┐    HTTP POST     ┌─────────────┐    HTTP POST     ┌─────────┐
│  Vue3 前端  │ ──────────────► │   BFF 层    │ ──────────────► │  LLM    │
│  useFetch   │   /api/chat     │  Express    │   /chat/completions   │ 智谱/OpenAI│
└─────────────┘                  └─────────────┘                  └─────────┘
                                       │
                                       │ process.env.AI_API_KEY
                                       ▼
                                 ┌─────────────┐
                                 │  环境变量    │
                                 │  (不暴露)    │
                                 └─────────────┘
```

**关键设计要点**：
1. **API Key 存储**：仅存在 BFF 服务器的 `process.env` 或密钥管理服务中
2. **请求透传**：BFF 接收前端的 `messages`，注入 API Key 后转发给 LLM
3. **统一模型管理**：BFF 可维护默认模型、支持模型切换、做 A/B 测试
4. **速率限制**：BFF 层可做用户级/IP 级限流，防止 Key 被恶意滥用

#### 💻 代码实现（Vue3 + Nuxt3 + BFF 代理）

**Nuxt 前端** — `composables/useChat.ts` + `nuxt.config.ts`：

```typescript
// nuxt.config.ts — 配置 BFF URL
export default defineNuxtConfig({
  runtimeConfig: {
    bffUrl: process.env.BFF_URL || 'http://localhost:3001',
    public: {
      appName: 'AI 组件生成器',
    },
  },
})

// composables/useChat.ts — 调用 BFF
const sendMessage = async (content: string) => {
  const config = useRuntimeConfig()

  const response = await fetch(`${config.public.bffUrl}/api/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [...currentMessages.value.map(m => ({ role: m.role, content: m.content }))],
      stream: false,
    }),
  })

  if (!response.ok) throw new Error(`请求失败: ${response.status}`)
  const data = await response.json()
  updateLastAssistant(data.choices?.[0]?.message?.content || '')
}
```

**BFF 服务端** — `apps/server/src/services/chain/model.ts` + `chatChain.ts`：

```typescript
// services/chain/model.ts — 模型封装
const API_URL = process.env.AI_API_URL
const API_KEY = process.env.AI_API_KEY

export const createChatModel = (config) => {
  const modelName = config.model || process.env.AI_MODEL

  return {
    async invoke(input) {
      const response = await fetch(`${API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: input,
          temperature: config.temperature ?? 0.7,
          stream: false,
        }),
      })

      if (!response.ok) throw new Error(`AI 请求失败 (${response.status})`)
      const data = await response.json()
      return data.choices[0]?.message?.content || ''
    },
  }
}

// services/chain/chatChain.ts — 链式封装
export const createChatChain = (config = {}) => {
  const model = createChatModel(config)
  return {
    async invoke(request) {
      const content = await model.invoke(request.messages)
      return { content }
    },
  }
}
```

**BFF 路由** — `routes/chat.ts`：

```typescript
router.post('/completions', async (req, res) => {
  try {
    const { messages, model, temperature } = req.body
    const chain = createChatChain({ model, temperature })
    const result = await chain.invoke({ messages })

    res.json({
      choices: [{
        message: { role: 'assistant', content: result.content },
        finish_reason: 'stop',
      }],
    })
  } catch (err) {
    const statusCode = err instanceof Error && 'statusCode' in err
      ? (err as { statusCode: number }).statusCode : 500
    res.status(statusCode).json({ error: err instanceof Error ? err.message : '请求失败' })
  }
})
```

#### 📱 C 端生产化改造

1. **多 Key 池轮换**：BFF 维护 Key 池，按请求量轮询分发，单 Key 限流 60 次/分钟
2. **用户级鉴权**：BFF 接入用户系统，每个用户绑定独立的 token 配额
3. **请求日志与追踪**：BFF 记录每次 AI 调用的时间、token 消耗、耗时，供运营分析
4. **降级策略**：主模型超时/失败时自动切换备用模型，对用户透明
5. **响应缓存**：相同 prompt 的请求命中缓存直接返回，减少 token 消耗和响应时间

#### 🤝 与 React 对照

| 能力 | Vue3 + Nuxt3 | React + Vite |
|------|-------------|-------------|
| 环境变量 | `useRuntimeConfig()` + `process.env` | `import.meta.env.VITE_` |
| SSR 安全 | Nuxt 内置 SSR，`useRuntimeConfig` 区分公私 | Next.js `getServerSideProps` / 环境变量 |
| BFF 集成 | Nuxt `server/api/` 目录约定 | Next.js API Routes / 独立 Express |
| 状态持久化 | 模块级单例 ref + `localStorage` | Context + `localStorage` |

#### 🧠 面试题 / 常见坑

**AI 产品场景题（80%+）：**

> **Q1**：某 AI 产品被恶意用户盗用 API Key 疯狂调用，导致账单暴增。请分析如何预防这种攻击？

**答**：(1) **BFF 层限流**——基于用户 ID/IP 的滑动窗口限流，如 60 次/分钟；(2) **Token 配额**——为每个用户/Key 设置日/月 token 上限，超出自动停用；(3) **异常检测**——监控单位时间内的请求模式，异常模式（如凌晨突然暴增）触发告警并自动封禁；(4) **Key 绑定**——Key 绑定用户或设备指纹，仅授权端可使用；(5) **费用预警**——当账单达到阈值（如 80% 配额）时发送预警通知。

> **Q2**：AI 组件生成器需要支持多个 LLM 提供商（智谱、阿里千问、百度文心），如何设计 BFF 层以灵活切换？

**答**：采用**策略模式 + 适配器模式**：(1) 定义统一的 `ChatProvider` 接口（`invoke`、`stream`、`bindTools`）；(2) 每个提供商实现各自的适配器（`ZhipuProvider`、`QwenProvider`）；(3) BFF 通过配置/请求参数选择具体的 Provider；(4) 前端只与统一的 `/api/chat` 接口交互，不关心底层用的哪个模型。新增模型只需实现 `ChatProvider` 接口即可。

> **Q3**：用户反馈 AI 生成的组件代码偶尔会出现"截断"现象（代码不完整），请分析原因和解决方案。

**答**：原因：(1) `max_tokens` 设置过小，模型输出被强制截断；(2) LLM 的上下文窗口限制导致超长输出被截断；(3) 流式传输网络中断。解决方案：(1) 根据业务场景合理设置 `max_tokens`（组件代码建议 2048-4096）；(2) 流式响应时检测是否正常结束（`finish_reason` 为 `stop` 而非 `length`）；(3) 截断时自动追问"请继续"让模型续写；(4) 记录截断日志，分析是否需要调整 prompt 让模型生成更精简的代码。

**通用技术题：**

> **Q4**：`useRuntimeConfig` 的 `public` 和私有配置有什么区别？如何正确使用？

**答**：`useRuntimeConfig()` 返回的配置分为两类：(1) `public` 中的配置会**同时暴露给服务端和客户端**，可在前端代码中通过 `config.public.xxx` 读取；(2) 非 `public` 的配置仅在**服务端可用**，客户端访问为 `undefined`。因此 API Key、数据库密码等敏感信息必须放在非 `public` 的配置中，仅 BFF 层使用。这是 Nuxt 应用的重要安全机制。

> **Q5**：如何设计一个支持"用户自带 API Key"的 AI 产品？BFF 如何安全地使用用户 Key？

**答**：(1) 用户 Key 存储在服务端的加密存储中（不写入前端）；(2) BFF 转发请求时用用户的 Key 注入 `Authorization` 头；(3) 每个用户的请求独立计费，不影响其他用户；(4) Key 验证——用户提交 Key 时，BFF 先做一次轻量调用验证有效性；(5) Key 加密存储——使用 AES 加密后存入数据库，使用时解密；(6) 透明模式——用户 Key 仅在 BFF 内存中短暂存在，不持久化明文。

---

### 知识点 3：useFetch 封装与错误处理

#### 💡 JS 基础补充

- **`async/await` 错误处理**：`try-catch` 捕获 Promise rejection，`throw` 抛出异常
- **类型守卫 `instanceof`**：区分 `Error` 类型和其他异常，安全访问 `.message`
- **`AbortController`**：浏览器原生 API，`abort()` 方法可中断 fetch 请求，配合 `signal` 参数使用

#### 💡 浏览器基础补充

- **`response.body`**：ReadableStream（模块 2 详解），流式响应的消费入口
- **网络状态检测**：`navigator.onLine` + `online/offline` 事件，提前预判网络问题

#### 🤖 AI 场景价值

AI 产品的请求链路比普通业务请求更复杂：响应慢（3-30s）、错误类型多（网络/HTTP/模型/限流）、需要超时控制和重试机制。一个健壮的 useFetch 封装是 AI 产品用户体验的生命线——用户不会因为 AI 慢而离开，但会因为反复的错误和无反馈而流失。

#### 📚 主线知识点原理解析

**错误分类与处理策略**：

| HTTP 状态码 | 含义 | AI 场景原因 | 处理策略 |
|------------|------|------------|---------|
| 400 | 请求格式错误 | messages 格式不正确、参数缺失 | 前端修正并重试 |
| 401 | 认证失败 | API Key 无效/过期 | 提示用户重新配置 |
| 429 | 速率限制 | Key 调用频率超限、配额耗尽 | 指数退避重试 + 友好提示 |
| 500 | 服务端错误 | 模型服务异常、内部错误 | 重试 + 降级到备用模型 |
| 503 | 服务不可用 | 模型服务过载 | 排队等待 + 异步通知 |
| 网络错误 | 连接失败 | 网络断开、DNS 解析失败 | 离线缓存 + 重连后自动恢复 |

**请求状态机**：

```
idle ──send()──► loading ──success──► success
  ▲                  │    ▲  │
  │                  │    │  └──retry──► loading
  │                  │    │
  │                  └──error──► error
  │                                   │
  └──────────── reset ────────────────┘
```

#### 💻 代码实现（Vue3 + Nuxt3）

**useChat composable 的错误处理实现**：

```typescript
const TIMEOUT_MS = 30000

const sendMessage = async (content: string) => {
  if (isLoading.value) return

  const userMsg: ChatMessage = {
    id: generateId(),
    role: 'user',
    content,
    timestamp: Date.now(),
  }
  addMessage(userMsg)

  const assistantMsg: ChatMessage = {
    id: generateId(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
  }
  addMessage(assistantMsg)

  isLoading.value = true

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const config = useRuntimeConfig()
    const response = await fetch(`${config.public.bffUrl}/api/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [...currentMessages.value.map(m => ({ role: m.role, content: m.content }))],
        stream: false,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`请求失败: ${response.status}`)
    }

    const data = await response.json()
    updateLastAssistant(data.choices?.[0]?.message?.content || '')
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      updateLastAssistant('⏱️ 请求超时，请检查网络或重试')
    } else if (err instanceof Error) {
      updateLastAssistant(`❌ 请求出错：${err.message}`)
    } else {
      updateLastAssistant('❌ 未知错误，请重试')
    }
  } finally {
    clearTimeout(timeoutId)
    isLoading.value = false
  }
}
```

**BFF 层错误处理** — `apps/server/src/routes/chat.ts`：

```typescript
router.post('/completions', async (req, res) => {
  try {
    const { messages, model, temperature } = req.body
    const chain = createChatChain({ model, temperature })
    const result = await chain.invoke({ messages })

    res.json({
      choices: [{ message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '请求失败'
    const statusCode = err instanceof Error && 'statusCode' in err
      ? (err as { statusCode: number }).statusCode : 500
    res.status(statusCode).json({ error: message })
  }
})
```

#### 📱 C 端生产化改造

1. **指数退避重试**：429 错误自动重试 3 次，间隔 1s → 2s → 4s
2. **离线消息队列**：网络断开时消息暂存 IndexedDB，重连后自动发送
3. **请求取消竞态**：新请求自动取消旧请求，避免过期数据覆盖新数据
4. **用户友好错误文案**：将技术错误码映射为用户可理解的提示
5. **错误上报与监控**：前端错误自动上报到 Sentry/自建监控，BFF 层记录日志

#### 🤝 与 React 对照

| 能力 | Vue3 实现 | React 实现 |
|------|----------|-----------|
| Loading 状态 | `ref(isLoading)` 直接赋值 | `useState(isLoading)` |
| 请求取消 | `AbortController`（同） | `AbortController` + `useRef` |
| 超时控制 | `setTimeout` + `abort()`（同） | `setTimeout` + `abort()`（同） |
| 错误边界 | 组件级 `errorCaptured` 钩子 | `ErrorBoundary` 类组件 |
| 重试逻辑 | Composable 内部封装 | Hook 内部封装 |

#### 🧠 面试题 / 常见坑

**AI 产品场景题（80%+）：**

> **Q1**：用户在 AI 对话中连续快速发送 3 条消息，每条都触发 API 调用。此时后端返回的顺序可能与发送顺序不一致，如何保证消息按正确顺序展示？

**答**：方案一——**请求排队串行执行**：在 composable 中维护请求队列，同一时刻只有一个请求在执行，后续请求排队等待。方案二——**序号标记 + 乱序重排**：每条消息携带递增序号，收到响应时按序号排序后再渲染。方案三——**取消旧请求**：发送新消息前先 `abort()` 上一个未完成的请求，保证只有最新请求生效（适用于对话场景，因为上下文是累积的）。方案三最适合 AI 对话场景，因为用户通常期望 AI 回应最新的消息。

> **Q2**：AI API 调用经常需要 5-15 秒，如何在这期间实现优雅的加载体验？

**答**：(1) **乐观更新**——用户发送后立即显示用户消息气泡和 AI 的"正在输入"占位气泡；(2) **打字机光标动画**——在 AI 消息末尾显示闪烁光标（CSS `animation: blink 1s infinite`）；(3) **骨架屏**——AI 消息区域显示 3 条灰色渐变条模拟文本行；(4) **思考中提示**——"AI 正在思考..." + 3 个跳动的圆点；(5) **进度指示**——流式模式下显示已接收的 token 数 / 预估总 token 数。

> **Q3**：AI 产品中如何处理网络断开重连的场景？需要考虑哪些边界情况？

**答**：(1) **请求中断检测**——`fetch` 抛出 `TypeError: Failed to fetch` 或 `AbortError`（超时），捕获后标记为网络错误；(2) **消息持久化**——用户发送的消息先保存到 IndexedDB，确保断网不丢失；(3) **重连自动恢复**——监听 `online` 事件，网络恢复后自动重连未完成的请求；(4) **请求幂等性**——每条消息携带唯一 ID，重连时服务端通过 ID 去重；(5) **状态回滚**——如果请求已发送但未收到响应，重连后应检查服务器状态再决定是否重试；(6) **用户感知**——断网时显示"已离线，消息将在网络恢复后发送"的提示条。

**通用技术题：**

> **Q4**：AbortController 的工作原理是什么？如果在 fetch 完成后调用 `abort()` 会发生什么？

**答**：AbortController 内部维护一个状态机（pending → aborted），通过 `signal` 属性传递给 fetch。当调用 `abort()` 时，fetch 内部检测到 signal 状态变化，立即中断底层的 TCP 连接。如果在 fetch 完成后（请求已收到完整响应）才调用 `abort()`，不会有任何效果，因为响应已经加载到内存中。但此时如果在读取 response.body 的流，流会被中断。

> **Q5**：如何用 fetch 实现请求超时？直接用 `setTimeout` 包裹 fetch 有什么问题？

**答**：正确实现是 `AbortController` + `setTimeout`：

```javascript
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), 3000)
const response = await fetch(url, { signal: controller.signal })
clearTimeout(timeoutId)
```

错误做法：`Promise.race([fetch(url), new Promise((_, r) => setTimeout(() => r('超时'), 3000))])`——问题是超时后 fetch 仍在后台继续执行，浪费资源且可能导致并发请求堆积。AbortController 会真正中断网络连接。

---

## 实践任务

### 任务 1：基础调用 + BFF 代理

在 `apps/web-vue-nuxt/composables/useChat.ts` 中完成：
- [ ] 使用 `useRuntimeConfig()` 获取 BFF URL
- [ ] 通过 BFF 代理调用 `/api/chat/completions` 接口
- [ ] 正确传递 messages 数组（包含 role + content）
- [ ] 展示 AI 返回的完整响应内容

### 任务 2：Loading + 超时控制

完善 `sendMessage` 方法：
- [ ] 添加 `isLoading` 状态，请求期间禁用发送按钮
- [ ] 使用 `AbortController` 实现 30 秒超时
- [ ] 超时后显示友好提示，允许用户重试
- [ ] 组件卸载时取消未完成的请求

### 任务 3：错误分类展示

实现错误处理：
- [ ] 区分网络错误、HTTP 错误、超时错误
- [ ] 401 → "请检查 API Key 配置"
- [ ] 429 → "请求过于频繁，请稍后重试"
- [ ] 500 → "服务暂时不可用，请稍后重试"
- [ ] 所有错误展示在 AI 消息气泡中，用户可直观看到

### 任务 4：BFF 层封装

在 `apps/server/src/services/chain/chatChain.ts` 中：
- [ ] 实现 `createChatChain` 返回 `invoke` 方法
- [ ] 使用 `process.env.AI_API_KEY` 作为 Authorization
- [ ] 支持从请求参数接收自定义 model 和 temperature
- [ ] 统一错误处理，将 HTTP 错误码透传给前端

---

## 检验标准

- [ ] 前端代码中无任何 API Key 明文（全部通过 BFF 代理）
- [ ] 能成功调用 AI API 并在页面展示完整响应
- [ ] Loading 状态正确，发送按钮在请求期间禁用
- [ ] 30 秒超时能正确触发中断并显示提示
- [ ] 401/429/500 错误分别展示对应的友好文案
- [ ] BFF 层能通过环境变量正确读取 API Key
- [ ] 理解 Token 计费方式并能估算对话成本
- [ ] 能解释 BFF 代理架构的 3 个核心优势