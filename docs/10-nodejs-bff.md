# Phase 7：Node.js BFF 服务端

## 学习目标

- 理解 BFF（Backend for Frontend）架构在 AI 产品中的定位：为什么前端不能直接调 AI API
- 掌握 Express 中间件管线的设计模式：日志 → CORS → Body Parser → 路由 → 错误处理
- 实现 AI API 转发层：非流式代理 + SSE 流式代理 + 会话内存管理
- 构建基于 LangChain / LangGraph 的 AI 编排层：StructuredTool / RAG 4 步流水线 / StateGraph Agent
- 理解安全底线：API Key 只在 BFF 读取，前端打包产物绝对不含密钥

---

## 知识点

### 7.1 BFF 架构设计与 Express 应用骨架

#### 💡 Node 基础补充 C.7：Express 中间件原理

Express 中间件是洋葱模型：请求从外到内逐层穿过每个中间件，响应从内到外逐层返回。每个中间件有 `req, res, next` 三个参数，调用 `next()` 才会进入下一层。

```typescript
// 中间件执行顺序：从上到下依次注册 → 从外到内依次执行
app.use(requestLogger)   // 第1层：日志（最外层）
app.use(corsMiddleware)  // 第2层：CORS
app.use(express.json()) // 第3层：Body Parser
app.use('/api', routes) // 第4层：路由（内层）
app.use(errorHandler)   // 第5层：错误处理（全局兜底）
```

**类比理解**：就像工厂流水线，原材料（请求）经过质检（日志）→ 安检（CORS）→ 拆包（Body Parser）→ 加工（路由）→ 包装（错误处理），成品（响应）按相反顺序出来。

#### 💡 Node 基础补充 C.1：Node 事件循环 6 阶段

AI BFF 中大量使用 SSE 流式响应，需要理解事件循环对长连接的影响：
- **Timers**：`setTimeout` 用于请求超时（如 30s 超时中断 LLM 调用）
- **Poll**：`socket.on('data')` 接收客户端 SSE 断开事件
- **Check**：`setImmediate` 在 I/O 回调后立即执行（用于清理资源）
- **Close**：进程退出时的 `SIGTERM/SIGINT` 处理

#### 🤖 AI 场景价值

BFF 层的核心价值是**将前端与 AI 服务解耦**：

1. **安全**：AI API Key 只在 BFF 的 `process.env` 中读取，前端打包产物搜索 `sk-` 结果为 0
2. **代理**：前端 CORS 无法直接调第三方 AI API，BFF 作为同源代理
3. **编排**：LangChain / LangGraph 等编排逻辑在 BFF 执行，前端只消费结果
4. **缓存**：相同问题的 AI 响应可在 BFF 缓存（Redis），减少 Token 消耗
5. **熔断**：AI 服务不可用时，BFF 返回降级提示而非 502 错误

#### 📚 主线知识点原理解析

**BFF 架构分层**：

```
┌─────────────────────────────────────────┐
│  Nitro Server (apps/web-vue-nuxt)      │
│  server/api/chat.post.ts                │ ← 透明转发层
│  只做: 参数校验 + 转发 + 返回            │
│  不做: AI 逻辑 / 工具执行 / RAG 检索     │
├─────────────────────────────────────────┤
│  Express BFF (apps/server) :3001        │
│  ┌───────────────────────────────────┐  │
│  │  middleware/                       │  │
│  │  ├── logger.ts (请求耗时统计)      │  │
│  │  ├── errorHandler.ts (全局兜底)    │  │
│  │  └── validate.ts (Zod 参数校验)    │  │
│  ├───────────────────────────────────┤  │
│  │  services/chain/                   │  │
│  │  └── chatChain.ts (AI 调用基座)    │  │
│  ├───────────────────────────────────┤  │
│  │  services/tools/                   │  │
│  │  └── registerTools.ts + engine.ts │  │ ← Function Calling
│  ├───────────────────────────────────┤  │
│  │  services/rag/                     │  │
│  │  └── loader/splitter/vectorStore   │  │ ← RAG 4 步流水线
│  ├───────────────────────────────────┤  │
│  │  services/agent/                   │  │
│  │  └── agent.ts (StateGraph)        │  │ ← Agent 状态机
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  db/index.ts (SQLite 6 表)         │  │
│  └───────────────────────────────────┘  │
├─────────────────────────────────────────┤
│  AI Provider (智谱 / OpenAI) :443       │
└─────────────────────────────────────────┘
```

#### 💻 代码实现

**1. Express 入口 — `apps/server/src/index.ts`**

```typescript
/**
 * 知识点 9.9：健康检查与启动入口
 * 
 * 学习要点：
 * - app.listen() 端口监听
 * - /healthz 健康检查接口
 * - 优雅关闭（SIGTERM/SIGINT）
 * 
 * 面试相关：
 * - Node.js 优雅关闭的正确做法
 * - 为什么健康检查对生产部署重要
 */

import express from 'express'
import cors from 'cors'
import { requestLogger } from './middleware/logger.js'
import { errorHandler } from './middleware/errorHandler.js'
import { initDatabase } from './db/index.js'
import { chatRouter } from './routes/chat.js'
import { ragRouter } from './routes/rag.js'
import { toolsRouter } from './routes/tools.js'
import { agentRouter } from './routes/agent.js'
import { generatorRouter } from './routes/generator.js'

const app = express()
const PORT = process.env.PORT || 3001

// ========== 中间件管线（洋葱模型） ==========
app.use(cors({
  origin: process.env.WEB_ORIGIN?.split(',') || ['http://localhost:5173'],
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))  // 支持大文件上传
app.use(requestLogger)                      // 请求日志（耗时统计）

// ========== 路由挂载 ==========
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})
app.use('/api/chat', chatRouter)
app.use('/api/rag', ragRouter)
app.use('/api/tools', toolsRouter)
app.use('/api/agent', agentRouter)
app.use('/api/generator', generatorRouter)

// ========== 全局错误兜底（必须在路由之后） ==========
app.use(errorHandler)

// ========== 启动 ==========
initDatabase()
app.listen(PORT, () => {
  console.log(`[BFF] Server running on http://localhost:${PORT}`)
})

// ========== 优雅关闭 ==========
const shutdown = (signal: string) => {
  console.log(`[BFF] Received ${signal}, shutting down...`)
  // 1. 停止接收新请求
  // 2. 等待现有请求完成（30s 超时）
  // 3. 关闭数据库连接
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
```

**2. 请求日志中间件 — `apps/server/src/middleware/logger.ts`**

```typescript
/**
 * 知识点 9.8：日志与错误监控
 * 
 * 学习要点：
 * - process.hrtime.bigint() 高精度计时
 * - res.on('finish') 监听响应完成
 * - 按状态码分级（info/warn/error）
 */

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint()

  res.on('finish', () => {
    const diffNs = Number(process.hrtime.bigint() - start)
    const ms = (diffNs / 1e6).toFixed(2)
    const level = res.statusCode >= 500 ? 'error' 
                : res.statusCode >= 400 ? 'warn' 
                : 'info'
    console.log(
      `[${level.toUpperCase()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`
    )
  })

  next()
}
```

**3. 全局错误处理 — `apps/server/src/middleware/errorHandler.ts`**

```typescript
/**
 * 知识点 9.8：全局错误处理
 * 
 * 学习要点：
 * - Express async 错误捕获（asyncHandler 装饰器）
 * - 统一错误响应格式
 * - 生产环境隐藏堆栈信息
 */

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR'
  ) {
    super(message)
  }
}

// 异步路由错误自动传递给错误中间件
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

// 全局错误处理（4 个参数 = Express 错误中间件）
export const errorHandler = (
  err: AppError, _req: Request, res: Response, _next: NextFunction
) => {
  const statusCode = err.statusCode || 500
  const isProd = process.env.NODE_ENV === 'production'

  res.status(statusCode).json({
    error: {
      message: err.message,
      code: err.code,
      // 📝 面试考点：生产环境不暴露堆栈
      ...(isProd ? {} : { stack: err.stack }),
    },
  })
}
```

**4. AI API 转发路由 — `apps/server/src/routes/chat.ts`**

```typescript
/**
 * 知识点 9.4 + 9.5：BFF API 代理层 + SSE 流式代理
 * 
 * 学习要点：
 * - 服务端 fetch（Node 18+ 原生）
 * - 请求透传 + 响应头处理
 * - SSE pipeline 转发（ReadableStream → res.write）
 */

import { Router } from 'express'
import { asyncHandler } from '../middleware/errorHandler.js'
import { createChatChain } from '../services/chain/chatChain.js'

const router = Router()

// 非流式：完整响应
router.post('/completions', asyncHandler(async (req, res) => {
  const { messages, stream } = req.body
  const chain = createChatChain()

  if (!stream) {
    const result = await chain.invoke({ messages })
    res.json({ choices: [{ message: { role: 'assistant', content: result } }] })
    return
  }

  // 流式：SSE 逐 token 推送
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  for await (const delta of chain.stream({ messages, stream: true })) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
  }
  res.end()
}))

export { router as chatRouter }
```

#### 📱 C 端生产化改造

| 维度 | 改造方案 |
|------|----------|
| **安全** | BFF 中间件校验前端传来的 API Key 必须与 env 中一致；前端产物正则搜 `sk-` = 0 |
| **CORS** | 白名单只允许生产域名；credentials: true 支持 Cookie |
| **限流** | express-rate-limit：每 IP 每分钟 60 次请求 |
| **超时** | 每个 LLM 请求 30s 超时 + 整体 60s 超时（AbortController） |
| **日志** | 结构化日志（pino）+ 请求 ID 追踪（X-Request-ID） |
| **健康检查** | `/api/health` 返回数据库连接状态 + AI API 连通性 |
| **优雅关闭** | 收到 SIGTERM 后 30s 内处理完现有请求，再关闭数据库 |

#### 🤝 与 React 对照

| Node.js BFF 概念 | React 对应概念 | 说明 |
|---|---|---|
| Express `app.use()` | React `Context.Provider` 包裹 | 都是分层注入能力 |
| 中间件 `asyncHandler` | React Error Boundary | 都是异常边界 |
| `res.on('finish')` | `useEffect` 清理函数 | 都是生命周期钩子 |
| `SSE res.write` | `useEffect` + `setInterval` | 都是推送模式 |
| `process.env` | `import.meta.env` | 都是环境变量 |
| `router.post('/chat')` | `fetch('/api/chat')` | 都是路由定义 |
| `SQLite WAL` | React 18 并发模式 | 都是并发优化 |

#### 🧠 AI + C 端专属面试题

**题 1（中级 · 原理）**：为什么 AI 产品必须使用 BFF 架构？前端直接调用 AI API 有什么问题？

> **答案要点**：
> 1. **安全**：API Key 暴露在前端 Bundle 中，任何人打开 DevTools 就能拿到，导致被盗用消费
> 2. **CORS**：大多数 AI 服务端默认不允许浏览器直接跨域请求
> 3. **编排**：Function Calling、RAG、Agent 等多步编排逻辑不应放在前端，增加攻击面且不可控
> 4. **版本控制**：BFF 可以无感切换 AI 服务商（如从智谱切到 DeepSeek），前端无需改动
> 5. **缓存与熔断**：BFF 可以缓存相同问题的响应、在 AI 服务不可用时降级
> 6. **数据聚合**：BFF 可以组合多个 AI API + 内部服务返回一个统一接口

**题 2（中级 · 设计）**：如何设计一个支持流式 SSE 的 BFF 转发层？需要注意哪些细节？

> **答案要点**：
> 1. `Content-Type: text/event-stream` + `Connection: keep-alive` + `Cache-Control: no-cache`
> 2. 逐 chunk 调用 `res.write()`，不要等全部完成再写
> 3. 客户端断开时检测 `req.on('close')` 停止转发（避免浪费 Token）
> 4. 用 `AbortController` 实现请求超时（如 30s）
> 5. 错误处理：上游 AI 服务断连时，向客户端发送 `data: [DONE]` 或错误事件
> 6. 背压处理：如果客户端消费慢，需要处理 `res.write` 返回的 false（需要 drain 事件）

**题 3（高级 · 设计）**：设计一个生产级 BFF，需要哪些基础设施？

> **答案要点**：
> 1. **日志**：结构化日志（pino/winston）+ 请求 ID 追踪 + 按级别过滤
> 2. **监控**：Prometheus 指标（QPS/延迟/错误率）+ Grafana 仪表盘
> 3. **告警**：AI API 错误率 > 5% 触发告警 + 数据库连接池耗尽告警
> 4. **限流**：IP 限流（express-rate-limit）+ 用户级配额（Redis）+ 滑动窗口
> 5. **缓存**：相同 prompt 的 AI 响应缓存 5 分钟（Redis），key = hash(messages)
> 6. **熔断**：AI 服务连续失败 N 次后暂停请求，等恢复后自动恢复
> 7. **优雅关闭**：SIGTERM → 停止接收 → 等待现有请求 → 关闭 DB → 退出
> 8. **版本化**：`/api/v1/chat/completions`，旧版本保留 3 个月

---

### 7.2 Function Calling：StructuredTool + AgentExecutor

#### 💡 JS 基础补充 A.10：TS 类型收窄与 Zod Schema

Function Calling 的核心是用 Zod Schema 定义工具参数，实现**开发期类型安全 + 运行时校验**双保险：

```typescript
import { z } from 'zod'

// Zod Schema 同时服务三个目的：
// 1. 开发期 TypeScript 类型推导
// 2. 运行时参数校验
// 3. 自动转换为 JSON Schema 给 AI 参考
const weatherArgs = z.object({
  city: z.string().describe('城市名称，如 北京、上海'),
  days: z.number().min(1).max(7).optional().describe('查询天数'),
})

// TS 类型自动推导
type WeatherArgs = z.infer<typeof weatherArgs>
// { city: string; days?: number }
```

#### 🤖 AI 场景价值

Function Calling 让 AI 从「只会聊天」变成「会干活」。在组件生成器场景中：
- **代码执行工具**：生成的 Vue/React 代码在沙箱中运行检测错误
- **模板查询工具**：从模板库检索匹配参考
- **组件 Props 查询**：确保生成代码的 API 正确
- **AST 解析工具**：自动生成组件文档和测试

#### 📚 主线知识点原理解析

**Function Calling 4 件套**：

```
┌──────────────────────────────────────────────┐
│  1. Zod Schema      → 参数类型 + AI 提示      │
│  2. registerTool()  → 注册中心 Map            │
│  3. engine.execute()→ 执行 + 结果回传         │
│  4. router POST     → SSE 中间态输出          │
└──────────────────────────────────────────────┘
```

#### 💻 代码实现

**1. 工具定义与注册 — `services/tools/registerTools.ts`**

```typescript
/**
 * 知识点 13.3-13.4：StructuredTool 4 件套 + 注册中心
 * 
 * 学习要点：
 * - Zod Schema 同时实现 TS 类型 + JSON Schema 给 AI
 * - Map<string, ToolDefinition> 注册中心
 * - 白名单过滤：前端只传 id，BFF 从注册中心取
 */

import { z } from 'zod'

export interface ToolDefinition {
  name: string
  description: string
  schema: z.ZodType
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

const toolRegistry = new Map<string, ToolDefinition>()

// 📝 面试考点：策略模式 + 注册中心
export const registerTool = (tool: ToolDefinition): void => {
  if (toolRegistry.has(tool.name)) {
    throw new Error(`工具 ${tool.name} 已注册`)
  }
  toolRegistry.set(tool.name, tool)
}

export const getTool = (name: string): ToolDefinition | undefined => {
  return toolRegistry.get(name)
}

// 白名单查询：前端只能拿到 id+name+icon，Schema 不暴露
export const getToolWhitelist = (): Array<{
  id: string; name: string; description: string
}> => {
  return Array.from(toolRegistry.values()).map(t => ({
    id: t.name,
    name: t.name,
    description: t.description,
  }))
}

// ========== 注册内置工具 ==========
registerTool({
  name: 'get_current_time',
  description: '获取当前时间',
  schema: z.object({
    timezone: z.string().optional().describe('时区，如 Asia/Shanghai'),
  }),
  async execute(args) {
    const tz = (args as { timezone?: string }).timezone || 'UTC'
    return { time: new Date().toISOString(), timezone: tz }
  },
})

registerTool({
  name: 'get_weather',
  description: '获取指定城市的天气信息',
  schema: z.object({
    city: z.string().describe('城市名称'),
  }),
  async execute(args) {
    const { city } = args as { city: string }
    // 真实项目中调第三方天气 API
    return { city, temperature: '22°C', condition: '晴' }
  },
})
```

**2. 执行引擎 — `services/tools/engine.ts`**

```typescript
/**
 * 知识点 13.5：Function Calling 执行引擎
 * 
 * 学习要点：
 * - 检测 LLM 响应中的 tool_calls
 * - 并行执行多个工具调用
 * - 多步循环：最多 5 轮防止死循环
 * - SSE 输出中间态
 */

interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

interface ToolResult {
  tool_call_id: string
  role: 'tool'
  content: string
}

export async function executeToolCall(
  toolCalls: ToolCall[]
): Promise<ToolResult[]> {
  // 并行执行：多个工具调用同时执行
  const results = await Promise.allSettled(
    toolCalls.map(async (tc) => {
      const tool = getTool(tc.name)
      if (!tool) {
        return {
          tool_call_id: tc.id,
          role: 'tool' as const,
          content: JSON.stringify({ error: `未知工具: ${tc.name}` }),
        }
      }

      // Zod 校验 + 执行
      const parsed = tool.schema.parse(tc.args)
      const result = await tool.execute(parsed)
      return {
        tool_call_id: tc.id,
        role: 'tool' as const,
        content: JSON.stringify(result),
      }
    })
  )

  // 容错：单个工具失败不影响其他
  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    return {
      tool_call_id: toolCalls[i].id,
      role: 'tool' as const,
      content: JSON.stringify({ error: '工具执行失败' }),
    }
  })
}
```

#### 📱 C 端生产化改造

| 维度 | 改造方案 |
|------|----------|
| **前端白名单** | `GET /api/tools/list` 只返回 `{id, name, description}`，无 Schema |
| **中间态展示** | SSE 事件分 3 种：`tool_call_start`（加载）→ `tool_call_args`（参数摘要）→ `tool_call_result`（结果） |
| **安全沙箱** | `execute_code` 工具用 `isolated-vm` 或 Web Worker 隔离 |
| **速率限制** | 每用户每分钟 10 次工具调用 |
| **死循环防护** | 最大 5 轮 + 重复参数检测（相同 args hash 连续 2 次中断） |
| **超时** | 单工具 30s + 整体 120s |

#### 🧠 AI + C 端专属面试题

**题 1（中级 · 原理）**：Function Calling 中，为什么工具的 `description` 字段是最关键的？

> **答案要点**：
> 1. AI 完全靠 `description` 判断"用户的问题是否需要这个工具"——这是 AI 选择工具的唯一依据
> 2. 好的 description：`"从组件模板库中检索符合条件的模板，返回模板 ID、名称和代码"`——明确告诉 AI 何时用、做什么
> 3. 差的 description：`"模板"`——AI 无法判断何时该用
> 4. 参数级 `.describe()` 同样重要，帮助 AI 生成正确的参数值
> 5. 实践：description 中加入「什么时候不该用」

**题 2（高级 · 设计）**：如何防止 Function Calling 被 Prompt Injection 攻击？

> **答案要点**：
> 1. **System Prompt 规则**：`"只能使用提供的工具，不能编造结果"`
> 2. **工具白名单**：BFF 检查 `tool_name ∈ allowed_tool_ids`，不在白名单的拒绝执行
> 3. **参数校验**：Zod Schema 严格校验，不通过直接拒绝
> 4. **速率限制**：每用户每分钟最多 N 次工具调用
> 5. **工具分层**：危险工具（如 `delete_user`）需要额外的用户确认（Human-in-the-loop）
> 6. **日志审计**：所有工具调用记录 args + result + 用户 ID，异常模式告警

---

### 7.3 RAG 4 步流水线 + VectorStore

#### 💡 Node 基础补充 C.8：Node Stream 与背压

RAG 文档上传涉及文件流处理：
- `fs.createReadStream(file)` 创建可读流
- `pipeline(readable, transform, writable)` 自动处理背压和错误
- 背压：当消费者（如 LLM API）处理慢时，生产者（文件读取）自动减速

#### 🤖 AI 场景价值

RAG（Retrieval-Augmented Generation）让 AI 基于你的**私有文档**回答，而不是只靠模型参数记忆：
- **组件库检索**：用户问"有没有商品卡片模板？"，RAG 从模板库检索匹配
- **知识库问答**：上传产品文档后，AI 能回答文档中的具体细节
- **引用溯源**：回答中标注 [1][2] 引用来源，用户可以点击查看原文

#### 📚 主线知识点原理解析

**RAG 4 步流水线**：

```
文档上传
    │
    ▼
┌─────────┐    ┌──────────┐    ┌───────────┐    ┌──────────────┐
│  Loader  │───▶│ Splitter │───▶│ Embeddings │───▶│  VectorStore │
│ PDF/MD/  │    │ 递归分块 │    │ 向量化     │    │  SQLite +    │
│ TXT      │    │ 带重叠   │    │ (AI API)   │    │ 余弦相似度   │
└─────────┘    └──────────┘    └───────────┘    └──────────────┘
                                                        │
                                                        ▼
                                                   用户问答
                                                        │
                                                        ▼
                                              ┌────────────┐
                                              │  Retrieval │
                                              │  Chain     │
                                              │            │
                                              │ 1. 检索 Top-K
                                              │ 2. 注入上下文
                                              │ 3. LLM 生成
                                              └────────────┘
```

**Loader → Splitter → Embeddings → VectorStore**

#### 💻 代码实现

**1. Loader 多格式解析 — `services/rag/loader.ts`**

```typescript
/**
 * 知识点 13.6：RAG Loader
 * 
 * 学习要点：
 * - 策略模式：按文件扩展名选择解析器
 * - 统一输出结构：{ id, name, content, metadata }
 */

import fs from 'fs'
import path from 'path'
import pdfParse from 'pdf-parse'

export interface LoadedDocument {
  id: string
  name: string
  content: string
  metadata: { size: number; type: string }
}

export async function loadFromFile(
  filePath: string, originalName?: string
): Promise<LoadedDocument> {
  const name = originalName || path.basename(filePath)
  const ext = path.extname(name).toLowerCase()
  const stats = fs.statSync(filePath)

  let content: string
  switch (ext) {
    case '.pdf':
      const data = fs.readFileSync(filePath)
      const parsed = await pdfParse(data)
      content = parsed.text
      break
    case '.md':
    case '.txt':
    case '.json':
    case '.js':
    case '.ts':
    case '.vue':
    case '.tsx':
      content = fs.readFileSync(filePath, 'utf-8')
      break
    default:
      throw new Error(`不支持的文件类型: ${ext}`)
  }

  return {
    id: crypto.randomUUID(),
    name,
    content,
    metadata: { size: stats.size, type: ext },
  }
}
```

**2. Splitter 中文友好分块 — `services/rag/splitter.ts`**

```typescript
/**
 * 知识点 13.7：RAG Splitter
 * 
 * 学习要点：
 * - RecursiveCharacterTextSplitter：按分隔符优先级递归切分
 * - chunkOverlap ≥ 32 字符：防止长句被切在两个 chunk 边界
 * - 中文分隔符：。！？；，
 */

const CHINESE_SEPARATORS = ['\n\n', '\n', '。', '！', '？', '；', '，', ' ', '']

export async function splitText(
  text: string,
  options: { chunkSize?: number; chunkOverlap?: number } = {}
): Promise<Array<{ content: string; chunkIndex: number }>> {
  const chunkSize = options.chunkSize || 500
  const chunkOverlap = options.chunkOverlap || 32

  const chunks: Array<{ content: string; chunkIndex: number }> = []
  let index = 0

  // 简单实现：按分隔符切分 + 重叠
  const paragraphs = text.split(/\n{2,}/)
  let currentChunk = ''

  for (const para of paragraphs) {
    if (currentChunk.length + para.length > chunkSize && currentChunk.length > 0) {
      chunks.push({ content: currentChunk.trim(), chunkIndex: index++ })
      // 重叠：保留最后 chunkOverlap 个字符
      currentChunk = currentChunk.slice(-chunkOverlap) + para
    } else {
      currentChunk += (currentChunk ? '\n' : '') + para
    }
  }
  if (currentChunk.trim()) {
    chunks.push({ content: currentChunk.trim(), chunkIndex: index })
  }

  return chunks
}
```

**3. SQLite 向量存储 — `services/rag/vectorStore.ts`**

```typescript
/**
 * 知识点 13.9：VectorStore
 * 
 * 学习要点：
 * - SQLite 存储 embedding（JSON 数组）
 * - 余弦相似度搜索
 * - 支持按文档 ID 过滤
 */

export interface ScoredChunk {
  id: string
  content: string
  docId: string
  score: number  // 0~1 余弦相似度
}

export function similaritySearch(
  queryEmbedding: number[],
  topK: number = 4,
  docId?: string
): ScoredChunk[] {
  const db = getDb()

  const rows = docId
    ? db.prepare('SELECT * FROM chunks WHERE doc_id = ? AND embedding IS NOT NULL').all(docId)
    : db.prepare('SELECT * FROM chunks WHERE embedding IS NOT NULL').all()

  const results = rows.map(row => {
    const embedding: number[] = JSON.parse(row.embedding)
    const score = cosineSimilarity(queryEmbedding, embedding)
    return { id: row.id, content: row.content, docId: row.doc_id, score }
  })

  return results.sort((a, b) => b.score - a.score).slice(0, topK)
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
```

#### 📱 C 端生产化改造

| 维度 | 改造方案 |
|------|----------|
| **文档上传** | 375px 用 ActionSheet（拍照/相册/文件），支持多文件并行上传（最大 5 个） |
| **上传进度** | 每个文件显示独立进度条；失败支持重试；后端返回切片进度（`已处理 12/52`） |
| **Citation 卡片** | 回答中 `[1][2]` 编号 → 点击展开原文 200 字上下文 + 跳转到文档详情 |
| **虚拟滚动** | 文档列表 ≥20 条时启用 IntersectionObserver 无限滚动 |
| **空状态** | 无文档时显示插图 + 引导文案「上传第一份文档」 |

#### 🧠 AI + C 端专属面试题

**题 1（中级 · 原理）**：RAG 的 chunkOverlap 为什么重要？太小或太大会有什么问题？

> **答案要点**：
> 1. **作用**：防止一个完整句子/段落被切在两个 chunk 的边界，导致检索时被切断的 chunk 因为上下文缺失而分数低
> 2. **太小（< 10）**：两个 chunk 之间没有重叠，边界处的信息会丢失
> 3. **太大（> 100）**：冗余信息过多，浪费 Token 和向量空间
> 4. **最佳值**：chunkOverlap ≈ chunkSize 的 5-10%。对于中文（一个字 ≈ 1-2 tokens），32 字符是比较合理的重叠量
> 5. **中文特殊处理**：中文句子以 `。！？` 结尾，chunkOverlap 应至少覆盖一个完整句子

**题 2（高级 · 设计）**：设计一个支持 10 万文档的 RAG 系统，需要考虑哪些优化？

> **答案要点**：
> 1. **索引优化**：倒排索引（BM25）+ 向量索引（HNSW/IVF）混合检索
> 2. **分片**：按文档 ID 或租户 ID 分片，并行检索
> 3. **缓存**：热门查询的 Top-K 结果缓存（Redis）
> 4. **增量更新**：文档变更时只重分块+重嵌入受影响的部分
> 5. **压缩**：Embedding 用 FP16 存储（空间减半，精度损失 < 1%）
> 6. **异步处理**：上传 → 分块 → 嵌入 → 入库 异步流水线
> 7. **监控**：检索延迟 P99、召回率、用户点击率（Citation 点击数）

---

### 7.4 Agent StateGraph：LangGraph 状态机

#### 💡 JS 基础补充 A.5：事件循环与 async-await

Agent 的 `streamEvents` 使用 `async generator` + `for await...of`：
```typescript
// async generator = 每 yield 一个值就暂停，等消费者 for-await 消费后再继续
async *streamEvents(state, input) {
  yield { node: 'think', ... }       // 产出第 1 个事件，暂停
  yield { node: 'call_tools', ... }  // 产出第 2 个事件，暂停
  yield { node: 'answer', ... }      // 产出第 3 个事件，暂停
}
```

#### 🤖 AI 场景价值

Agent 让 AI 从「单轮问答」变成「多步自主推理」：
- **组件生成器场景**：需求细化 → 检索模板 → 生成代码 → 沙箱预览 → 用户反馈 → 迭代
- **每一步都可暂停/恢复/回滚**：用户可以在 Agent 执行到第 3 步时修改需求，从第 3 步重新开始

#### 📚 主线知识点原理解析

**StateGraph 4 节点状态机**：

```
┌───────────────────────────────────────────────────┐
│                    StateGraph                        │
│  state: AgentState { messages, step, answer }      │
│                                                     │
│  ┌──────┐   tool_calls?   ┌────────────┐           │
│  │ think │───────────────▶│ call_tools │           │
│  └──────┘                 └─────┬───────┘          │
│     ▲                            │                  │
│     │ no tool_calls             ▼                  │
│     │                     ┌──────────┐              │
│     │                     │ observe  │              │
│     │                     └────┬─────┘              │
│     │                          │                   │
│     │                          ▼                   │
│     │                     ┌──────────┐              │
│     └─────────────────────│  answer  │              │
│          loop             └──────────┘              │
│                         completed ✓                 │
└───────────────────────────────────────────────────┘
```

#### 💻 代码实现

**Agent StateGraph — `services/agent/agent.ts`**

```typescript
/**
 * 知识点 13.11-13.14：Agent StateGraph
 * 
 * 学习要点：
 * - 4 节点：think → 条件边 → call_tools / answer
 * - 条件边：tool_calls 检测决定走哪条路径
 * - 状态持久化：每个节点完成后保存 state 到 SQLite
 * - 中断机制：call_tools 支持 interruptBefore（Human-in-the-loop）
 */

export interface AgentState {
  messages: Array<{ role: string; content: string; tool_call_id?: string }>
  step: number
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed'
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result?: unknown }>
  answer?: string
  error?: string
}

const MAX_ITERATIONS = 10

export async function* streamEvents(
  threadId: string,
  userInput: string,
  initialState?: Partial<AgentState>
): AsyncGenerator<AgentStreamEvent> {
  const state: AgentState = {
    messages: [{ role: 'user', content: userInput }],
    step: 0,
    status: 'running',
    toolCalls: [],
    ...initialState,
  }

  // 发送初始状态
  yield { type: 'state_snapshot', state: { ...state } }

  const chain = createChatChain()
  const fcEngine = createFunctionCallingEngine()

  while (state.status === 'running' && state.step < MAX_ITERATIONS) {
    state.step++

    // ===== 节点 1: think =====
    state.messages.push({ role: 'user', content: `[Step ${state.step}] 继续推理...` })
    
    let thinkContent = ''
    yield { type: 'node_start', node: 'think', step: state.step }

    for await (const delta of chain.stream({ messages: state.messages })) {
      thinkContent += delta
      yield { type: 'on_chain_stream', node: 'think', delta }
    }

    // 检测工具调用标记 [TOOL_CALL]...[/TOOL_CALL]
    const toolMatch = thinkContent.match(
      /\[TOOL_CALL\]\s*(.+?)\s*\[\/TOOL_CALL\]/s
    )

    if (toolMatch) {
      // ===== 节点 2: call_tools =====
      yield { type: 'node_start', node: 'call_tools', step: state.step }

      // 解析工具调用
      const toolCall = JSON.parse(toolMatch[1])
      yield { type: 'tool_call_start', name: toolCall.name, args: toolCall.args }

      // 执行工具
      const result = await fcEngine.executeToolCall([{
        id: toolCall.id || `call_${state.step}`,
        name: toolCall.name,
        args: toolCall.args,
      }])

      state.toolCalls.push({
        name: toolCall.name,
        args: toolCall.args,
        result: JSON.parse(result[0].content),
      })

      yield {
        type: 'tool_call_end',
        name: toolCall.name,
        result: result[0].content,
      }

      // ===== 节点 3: observe =====
      yield { type: 'node_start', node: 'observe', step: state.step }

      state.messages.push({
        role: 'tool',
        content: result[0].content,
        tool_call_id: toolCall.id,
      })

      // 持久化状态（支持 pause/resume）
      await persistState(threadId, state)
      yield { type: 'state_snapshot', state: { ...state } }
    } else {
      // ===== 节点 4: answer =====
      state.status = 'completed'
      state.answer = thinkContent

      yield { type: 'node_start', node: 'answer', step: state.step }
      yield { type: 'final_answer', content: thinkContent }

      await persistState(threadId, state)
      break
    }
  }

  if (state.status !== 'completed') {
    state.status = 'failed'
    state.error = '达到最大步数限制'
    yield { type: 'error', message: state.error }
  }

  yield { type: 'stream_end', threadId }
}

// ===== Human-in-the-loop =====
export async function pause(threadId: string): Promise<void> {
  const state = await loadState(threadId)
  if (state) {
    state.status = 'paused'
    await persistState(threadId, state)
  }
}

export async function resume(
  threadId: string, userInput: string
): AsyncGenerator<AgentStreamEvent> {
  const state = await loadState(threadId)
  if (!state) throw new Error('Agent state not found')
  state.status = 'running'
  return streamEvents(threadId, userInput, state)
}

export async function rollback(
  threadId: string, step: number
): Promise<void> {
  const state = await loadState(threadId)
  if (!state) return
  // 回滚：截断 messages 到指定步骤之前
  state.messages = state.messages.slice(0, step * 2 + 1)
  state.toolCalls = state.toolCalls.slice(0, step)
  state.status = 'paused'
  await persistState(threadId, state)
}
```

**Agent 路由 — `routes/agent.ts`**

```typescript
/**
 * 知识点 13.14：Agent API 路由
 * 
 * 学习要点：
 * - POST /api/agent/run → streamEvents SSE 输出
 * - 事件类型映射：think/call_tools/observe/answer
 * - POST /api/agent/:threadId/pause → 暂停
 * - POST /api/agent/:threadId/resume → 恢复
 * - POST /api/agent/:threadId/rollback → 回滚
 */

router.post('/run', asyncHandler(async (req, res) => {
  const { input, threadId } = req.body
  const id = threadId || crypto.randomUUID()

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  for await (const event of streamEvents(id, input)) {
    // 统一 SSE 事件格式
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  res.end()
}))

router.post('/:threadId/pause', asyncHandler(async (req, res) => {
  await pause(req.params.threadId)
  res.json({ status: 'paused' })
}))

router.post('/:threadId/resume', asyncHandler(async (req, res) => {
  const { input } = req.body
  // 恢复也是流式
  res.setHeader('Content-Type', 'text/event-stream')
  for await (const event of resume(req.params.threadId, input)) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  res.end()
}))
```

#### 📱 C 端生产化改造

| 维度 | 改造方案 |
|------|----------|
| **时间线可视化** | 5 色进度条：think(灰)/call_tools(蓝加载)/tool_output(绿)/observe(灰)/answer(紫) |
| **用户干预** | 底部浮层：暂停/继续/修改参数/停止/回滚到第 N 步 |
| **超时续跑** | 执行 >10 步仍未出结果，显示「已执行 10 步，是否继续 5 步？」 |
| **参数可视化** | 长按工具步骤卡片「复制参数」「展开 JSON 原文」，默认只显示友好摘要 |
| **草稿保存** | Agent 暂停时当前输入草稿自动保存，刷新不丢 |

#### 🧠 AI + C 端专属面试题

**题 1（中级 · 设计）**：如何实现 Agent 的「暂停 → 恢复 → 回滚」功能？状态应该怎么存？

> **答案要点**：
> 1. **状态存储**：SQLite `agent_states` 表，`state_json` 存完整状态序列，`step` 存当前步骤
> 2. **暂停**：将 `status` 改为 `paused`，`streamEvents` 循环检测 status 后 break
> 3. **恢复**：从 SQLite 加载状态，`status` 改回 `running`，从断点继续 `streamEvents`
> 4. **回滚**：`messages = messages.slice(0, step * 2 + 1)`，`toolCalls = toolCalls.slice(0, step)`
> 5. **关键**：每个节点完成后**立即持久化**，确保即使崩溃也能从上次节点恢复

**题 2（高级 · 设计）**：设计一个 Agent 时间线 UI，如何处理 20+ 步的步骤渲染性能？

> **答案要点**：
> 1. **shallowRef**：用 `shallowRef<AgentStep[]>` 替代 `ref`，避免深层响应式开销
> 2. **虚拟滚动**：>20 步时启用虚拟列表（DOM 只渲染可视区域的步骤）
> 3. **增量更新**：新步骤用 `steps.value.push(newStep)` 替代 `steps.value = [...steps, newStep]`，减少重新渲染
> 4. **骨架屏**：正在执行的步骤显示骨架动画，已完成的静态渲染
> 5. **懒展开**：每个步骤默认折叠，点击展开详情（参数/结果 JSON）

---

## 实践任务

### 任务 1：Express 基础设施搭建

- [ ] 创建 `apps/server/src/middleware/logger.ts`（请求耗时日志）
- [ ] 创建 `apps/server/src/middleware/errorHandler.ts`（AppError + asyncHandler + 全局兜底）
- [ ] 创建 `apps/server/src/middleware/validate.ts`（Zod 参数校验中间件）
- [ ] 创建 `apps/server/src/index.ts`（中间件管线 + 路由挂载 + 优雅关闭）
- [ ] 验证：`pnpm dev:server` 启动成功，`GET /api/health` 返回 OK

### 任务 2：AI API 代理层

- [ ] 创建 `apps/server/src/services/chain/model.ts`（自定义 ChatModel Runnable）
- [ ] 创建 `apps/server/src/services/chain/chatChain.ts`（统一 AI 调用链）
- [ ] 创建 `apps/server/src/routes/chat.ts`（非流式 + SSE 流式代理）
- [ ] 验证：`POST /api/chat/completions` 非流式和流式都正常

### 任务 3：Function Calling 实现

- [ ] 创建 `apps/server/src/services/tools/registerTools.ts`（StructuredTool 4 件套 + 注册中心）
- [ ] 创建 `apps/server/src/services/tools/engine.ts`（执行引擎 + 多步循环）
- [ ] 创建 `apps/server/src/routes/tools.ts`（白名单 + execute SSE 路由）
- [ ] 验证：`GET /api/tools/list` 返回白名单，`POST /api/tools/execute` 正常执行

### 任务 4：RAG 4 步流水线

- [ ] 创建 `apps/server/src/services/rag/loader.ts`（PDF/MD/TXT 多格式加载）
- [ ] 创建 `apps/server/src/services/rag/splitter.ts`（中文友好分块）
- [ ] 创建 `apps/server/src/services/rag/vectorStore.ts`（SQLite 向量存储 + 余弦相似度）
- [ ] 创建 `apps/server/src/services/rag/index.ts`（RAG 编排层）
- [ ] 创建 `apps/server/src/routes/rag.ts`（文档上传 + 检索问答路由）
- [ ] 验证：上传文档 → `POST /api/rag/query` 返回带 citations 的回答

### 任务 5：Agent StateGraph

- [ ] 创建 `apps/server/src/services/agent/agent.ts`（StateGraph 4 节点 + streamEvents）
- [ ] 创建 `apps/server/src/routes/agent.ts`（run/pause/resume/rollback 路由）
- [ ] 验证：`POST /api/agent/run` 返回 SSE 事件流

---

## 检验标准

- [ ] Express 中间件管线完整：CORS → Body Parser → Logger → Routes → ErrorHandler
- [ ] API Key 只在 `process.env` 中读取，前端产物搜索 `sk-` = 0
- [ ] SSE 流式代理正确：Content-Type/Connection/Cache-Control 三个头齐全
- [ ] Function Calling 安全：白名单机制 + Zod 校验 + 死循环防护（MAX_ITERATIONS ≤ 5）
- [ ] RAG 检索返回 citations（引用片段 + 相似度分数）
- [ ] Agent 支持暂停/恢复/回滚，状态持久化到 SQLite
- [ ] 生产级改造至少覆盖 3 项：限流/缓存/熔断/监控
