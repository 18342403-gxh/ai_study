# Phase 14：服务端完整体系 — 从 Express 入门到生产级 BFF

## 学习目标

- 理解"一个完整的服务端 BFF 应该长什么样"：从中间件管线到 8 组业务路由到 7 个数据库表
- 掌握 **SSE 流式、Zod 校验、SQLite 事务、熔断器状态机** 这四个面试高频考点
- 建立"生产级改造"的思维：限流/缓存/熔断/监控/链路追踪不是大公司才需要的，小项目也要有
- 能独立回答"你这个 BFF 的中间件管线为什么是这个顺序"、"熔断器怎么实现的"、"SSE 怎么处理客户端断开"

---

## 📐 全景图

```
apps/server/
├── src/
│   ├── index.ts                    ← 入口：中间件管线 + 路由注册 + 优雅关闭
│   ├── db/index.ts                 ← SQLite 初始化 + 7 张表
│   ├── middleware/                 ← 7 个中间件
│   │   ├── logger.ts               ← requestId + 结构化日志
│   │   ├── validate.ts             ← Zod body/query/params 校验
│   │   ├── errorHandler.ts         ← 全局错误 + 404 + asyncHandler
│   │   ├── rateLimit.ts            ← IP 滑动窗口限流（SSE 单独配额）
│   │   ├── cache.ts                ← LRU 内存缓存（GET 幂等 60s TTL）
│   │   ├── circuitBreaker.ts       ← AI 上游三态熔断器
│   │   └── metrics.ts              ← /api/metrics + P50/P95/P99
│   ├── routes/                     ← 8 组业务路由（全部带 Zod 校验）
│   │   ├── chat.ts                 ← POST /api/chat/completions
│   │   ├── sessions.ts             ← 会话 CRUD + messages
│   │   ├── documents.ts            ← 文档上传/列表/删除
│   │   ├── rag.ts                  ← RAG 查询 + 引用
│   │   ├── kb.ts                   ← 知识库问答（RAG 雏形）
│   │   ├── tools.ts                ← 工具列表 + 执行 + run
│   │   ├── agent.ts                ← run/pause/resume/rollback/get
│   │   └── generator.ts            ← run/iterate/get
│   └── services/                   ← 业务逻辑层
│       ├── chain/                  ← LangChain ChatChain 封装
│       ├── tools/                  ← Function Calling Engine + 工具注册
│       ├── rag/                    ← Loader → Splitter → Embeddings → VectorStore
│       ├── agent/                  ← StateGraph 4 节点 + Harness 三层护栏
│       └── generator/              ← 代码生成 Agent + 迭代逻辑
├── .env.example                    ← 配置模板（不带真实 Key）
└── package.json
```

---

## 一、中间件管线：顺序就是架构

```typescript
// index.ts 里注册顺序 — 每一层都在保护下一层
app.use(cors())               // ① 跨域
app.use(express.json())       // ② Body Parser
app.use(rateLimit)            // ③ 限流（挡恶意流量）
app.use(metricsMiddleware)    // ④ 开始收集指标
app.use(cacheMiddleware)      // ⑤ 如果命中缓存直接返回，后面都不走
app.use(circuitBreaker)       // ⑥ 保护 AI 上游不被放大故障
app.use(requestLogger)       // ⑦ 带 requestId 的日志

// 业务路由
app.use('/api/chat', chatRouter)
// ...

// 错误处理（必须在路由之后！）
app.use(notFoundHandler)      // ⑧ 404 兜底
app.use(errorHandler)         // ⑨ 全局错误
```

**顺序为什么重要？**

| 顺序 | 放在后面会怎样 |
|------|--------------|
| rateLimit 在 metrics 前面 | 被限流的请求不会被算进 metrics 统计（正确） |
| cache 在 circuitBreaker 前面 | 缓存命中的请求根本不会触达 AI 熔断（正确，省 AI 配额） |
| logger 在路由前面 | 所有请求（包括错误）都能被记录 |
| errorHandler 必须最后 | Express 的错误处理中间件必须是最后一个 `app.use()` |

---

## 二、7 个中间件逐个讲

### 2.1 requestLogger（带 requestId 的结构化日志）

每个请求生成唯一 requestId，通过 `X-Request-Id` 头输出，**贯穿日志 → 响应 → 错误**。

```typescript
// logger.ts 核心
const incoming = req.header('X-Request-Id')
const requestId = incoming ? incoming : randomUUID()
req.requestId = requestId
res.setHeader('X-Request-Id', requestId)

res.on('finish', () => {
  const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN ' : 'INFO '
  process.stdout.write(`[${level}] ${requestId} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms\n`)
})
```

**为什么要 requestId？**
- 前端报"我调 `/api/chat` 返回 500 了"，你可以让他把响应头里的 `X-Request-Id` 给你，然后 `grep` 日志精准定位
- 如果以后接了 APM（Prometheus/Grafana），requestId 是链路追踪的主键

---

### 2.2 validate（Zod 参数校验）

**用法**：

```typescript
// 定义 schema（在路由文件顶部）
const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string().min(1).max(20_000),
  })).min(1).max(50),
  stream: z.boolean().default(false),
})

// 作为中间件插入路由
router.post('/completions', validate({ body: chatSchema }), asyncHandler(async (req, res) => {
  // 到这里 body 已经校验过了，可以安全使用
  const { messages, stream } = req.body
}))
```

**validate 的三种覆盖粒度**：

```typescript
validate({ body: xxx })    // 校验请求体
validate({ query: xxx })   // 校验 URL 查询参数
validate({ params: xxx })  // 校验路径参数
validate({ body: a, params: b })  // 组合使用
```

**asyncHandler 是什么？** Express 的 async 路由里如果 `throw new Error()`，默认会导致 500 不走到 errorHandler。`asyncHandler` 把 async 函数包一层，catch 后调用 `next(err)`，让 errorHandler 能接住。

---

### 2.3 rateLimit（IP 维度滑动窗口限流）

**核心逻辑**：

```typescript
// 每个 IP 维护一个"最近 60 秒请求时间戳数组"
const buckets = new Map<string, { timestamps: number[] }>()

// 普通接口 60 req/min，SSE 流式接口 10 req/min
const isSse = /\/api\/chat\/completions|\/api\/agent\/run|\/api\/generator\/run/.test(req.path)
const max = isSse ? 10 : 60

// 清理超时时间戳，数剩下多少，够就放行，不够就 429
bucket.timestamps = bucket.timestamps.filter(t => now - t < 60_000)
if (bucket.timestamps.length >= max) {
  res.setHeader('Retry-After', ...)
  res.status(429).json({ error: { code: 'RATE_LIMITED' } })
}
```

**为什么 SSE 单独配额？** AI 流式调用成本高（每个 token 都是一次 AI API 消耗），普通接口可以给更高配额。

**为什么用滑动窗口而不是令牌桶？** 滑动窗口更简单准确——过去 60 秒内实际请求次数，而令牌桶有补充速率的概念在内存实现里容易溢出。

---

### 2.4 cache（LRU 内存缓存）

**核心逻辑**：

```typescript
// 只缓存 GET 幂等接口（白名单）
const CACHEABLE = [/^\/api\/sessions$/, /^\/api\/documents$/, /^\/api\/tools\/list$/, /^\/api\/health$/]
if (!isCacheable(req) || req.method !== 'GET') return next()

const key = `${req.method}:${req.path}`
const entry = cache.get(key)
if (entry && now - entry.createdAt < 60_000) {
  // 命中 → 直接返回，不执行后续路由
  res.setHeader('X-Cache', 'HIT')
  res.json(entry.body)
  return
}

// 未命中 → 拦截 res.json() 把结果存进缓存
res.json = ((body) => {
  cache.set(key, { body, createdAt: now })
  return originalJson(body)
})

next()
```

**LRU 淘汰**：`Map` 的插入顺序就是访问顺序，超出容量时（默认 100 条）淘汰 `lastAccessed` 最小的。

**绕过方式**：`GET /api/sessions?_nocache=1`，调试用。

---

### 2.5 circuitBreaker（AI 上游三态熔断器）

**这是面试高频题，必须能画状态图**：

```
                    连续失败 ≥ 3 次
    ┌──────────┐ ──────────────────▶ ┌──────────┐
    │  CLOSED  │                      │   OPEN    │
    │  正常     │ ◀────────────────── │  开路(30s)│
    └──────────┘   探测成功            └────┬─────┘
         ▲                                 │ 30s 后
         │                                  ▼ 放行 1 个
         │                          ┌──────────────┐
         └───────────────────────── │  HALF_OPEN    │
                                    │ 半开（探测）  │
                                    └──────────────┘
                                         │
                                    探测失败 → 回到 OPEN
                                    探测成功 → 回到 CLOSED
```

**开路期间的行为**：直接返回 503 + `Retry-After`，请求根本不会触达路由层。这样即使 AI 厂商全挂了，你的 BFF 也会秒回 503 而不是傻等超时。

**哪些路由受保护？** `/api/chat/completions`、`/api/agent/run`、`/api/generator/run`、`/api/rag/query`、`/api/kb/query` — 所有要调 AI 的。

**怎么判断"失败"？** HTTP 5xx 或 429 都算。

---

### 2.6 metrics（/api/metrics 监控指标）

收集的指标：

```json
{
  "server": { "uptimeSec": 3600, "activeConnections": 3 },
  "requests": {
    "total": 1234,
    "errors": 5,
    "errorRate": 0.004,
    "avgLatencyMs": 45.2,
    "p50LatencyMs": 23.1,
    "p95LatencyMs": 120.4,
    "p99LatencyMs": 350.8
  },
  "perRoute": [...],        // 每个路由的计数 + P95
  "circuits": [...],        // 熔断器状态
  "cache": { "size": 45, "hitRate": 0.72 }  // 缓存命中率
}
```

**P50/P95/P99 怎么算？** 把延迟数组排序，取对应百分位的那个值。`sort((a, b) => a - b)` 然后 `durations[Math.floor(p / 100 * n)]`。

---

### 2.7 errorHandler（全局错误处理）

```typescript
export const errorHandler = (err: AppError, _req, res, _next) => {
  const statusCode = err.statusCode || 500
  res.status(statusCode).json({
    error: {
      message: err.message,
      code: err.code || 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
  })
}
```

**关键点**：生产环境不返回 `stack`，只有开发环境才带。

---

## 三、8 组业务路由总览

### 3.1 路由清单

| 路由文件 | HTTP 方法 | 路径 | 有 Zod 校验 |
|---------|----------|------|------------|
| chat.ts | POST | `/api/chat/completions` | ✅ body |
| sessions.ts | GET | `/api/sessions` | — |
| sessions.ts | POST | `/api/sessions` | ✅ body |
| sessions.ts | GET | `/api/sessions/:id` | ✅ params |
| sessions.ts | PATCH | `/api/sessions/:id` | ✅ params + body |
| sessions.ts | DELETE | `/api/sessions/:id` | ✅ params |
| sessions.ts | POST | `/api/sessions/:id/messages` | ✅ params + body |
| sessions.ts | DELETE | `/api/sessions/:id/messages` | ✅ params |
| documents.ts | POST | `/api/documents/upload` | ✅ body + multer |
| documents.ts | GET | `/api/documents` | — |
| documents.ts | DELETE | `/api/documents/:id` | ✅ params |
| rag.ts | POST | `/api/rag/query` | ✅ body |
| rag.ts | GET | `/api/rag/:id` | ✅ params |
| kb.ts | POST | `/api/kb/query` | ✅ body |
| tools.ts | GET | `/api/tools/list` | — |
| tools.ts | POST | `/api/tools/execute` | ✅ body |
| tools.ts | POST | `/api/tools/run` | ✅ body |
| agent.ts | POST | `/api/agent` | ✅ body |
| agent.ts | POST | `/api/agent/:threadId/pause` | ✅ params + body |
| agent.ts | POST | `/api/agent/:threadId/resume` | ✅ params + body |
| agent.ts | POST | `/api/agent/:threadId/rollback` | ✅ params + body |
| agent.ts | GET | `/api/agent/:threadId` | ✅ params |
| generator.ts | POST | `/api/generator` | ✅ body |
| generator.ts | POST | `/api/generator/:id/iterate` | ✅ params + body |
| generator.ts | GET | `/api/generator/:id` | ✅ params |

**结论：全部 8 个路由文件，所有 POST/PATCH/DELETE 路径参数或 body 都有 Zod 校验。**

---

### 3.2 SSE 流式模式（chat.ts）

**三个必须设置的响应头**：

```typescript
res.setHeader('Content-Type', 'text/event-stream')
res.setHeader('Cache-Control', 'no-cache')
res.setHeader('Connection', 'keep-alive')
```

**SSE 协议格式**：

```
data: {"choices":[{"delta":{"content":"你"}}]}\n\n
data: {"choices":[{"delta":{"content":"好"}}]}\n\n
data: [DONE]\n\n
```

**客户端断开怎么办？** Express 的 `res` 对象继承自 Node.js 的 `http.ServerResponse`，它有一个 `res.writableEnded` 属性。在循环里检查这个值，如果客户端断开就 break：

```typescript
for await (const delta of chain.stream(...)) {
  if (res.writableEnded) break   // 客户端断开了，停止推送
  res.write(`data: ${JSON.stringify(...)}n\n`)
}
```

---

### 3.3 RAG 文档上传（documents.ts）

**异步处理模式**：上传接口接收文件后，**立即返回 `status: 'processing'`**，然后在一个"后台" async 函数里做 解析 → 分块 → 向量化 → 入库。前端可以轮询文档状态，等变成 `ready` 再去查询。

**事务写入**：多个 chunk 同时入库用 `db.transaction()` 包一层，要么全成要么全败：

```typescript
const insertMany = db.transaction(() => {
  for (const chunk of chunks) {
    insertChunk.run(uuid, docId, chunk.content, chunk.index, JSON.stringify(embedding))
  }
})
insertMany()  // 一次性提交
```

---

## 四、数据库：7 张表 + 3 个索引

```sql
-- 文档表：RAG 知识库的文档元数据
CREATE TABLE documents (
  id TEXT PRIMARY KEY,           -- UUID
  name TEXT NOT NULL,
  size INTEGER,
  type TEXT,                      -- .txt / .md / .json / .pdf
  status TEXT DEFAULT 'processing',  -- processing / ready / failed
  chunk_count INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
)

-- 分块表：文档被切分后的每一段 + embedding 向量
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT REFERENCES documents(id) ON DELETE CASCADE,  -- 外键级联
  content TEXT,
  chunk_index INTEGER,
  embedding TEXT                  -- JSON 数组格式的向量
)

-- 会话表 + 消息表（多轮对话）
CREATE TABLE sessions (id, title, model, system_prompt, created_at, updated_at)
CREATE TABLE messages (id, session_id REFERENCES sessions(id), role, content, metadata, created_at)

-- Agent 状态表 + 工具调用表（Agent 多步推理的持久化）
CREATE TABLE agent_states (thread_id TEXT PRIMARY KEY, state_json TEXT, status TEXT, current_node TEXT, ...)
CREATE TABLE tool_calls (id, session_id, tool_name, args_json, result_json, status, ...)

-- 生成器状态表（代码生成迭代的持久化）
CREATE TABLE generator_states (id TEXT PRIMARY KEY, state_json TEXT, status TEXT, ...)
```

---

## 五、SSE 事件协议（统一格式）

Agent 和 Generator 都用这个协议推事件：

```jsonc
// 基础事件
{ "type": "thread_id", "threadId": "xxx" }
{ "type": "event", "event": "on_chain_start", "name": "think", "data": { "iteration": 1 } }
{ "type": "event", "event": "on_chain_stream", "name": "think", "data": "你" }
{ "type": "event", "event": "on_chain_end", "name": "think", "data": { "content": "你好" } }
{ "type": "event", "event": "on_tool_start", "name": "get_weather", "data": { "city": "北京" } }
{ "type": "event", "event": "on_tool_end", "name": "get_weather", "data": { "temp": 25 } }

// Harness 新增事件（安全护栏）
{ "type": "event", "event": "on_harness_check", "data": {
    "name": "input_safety",
    "result": "pass",           // pass | warn | block
    "rule": "all_checks_passed",
    "reason": "输入安全检查通过"
}}

// 结束 / 错误
{ "type": "done", "threadId": "xxx" }
{ "type": "error", "message": "..." }
```

---

## 六、安全约束（面试高频）

| 约束 | 实现 |
|------|------|
| API Key 只在 `process.env` | `.env` 加 `.gitignore`，前端搜 `sk-` = 0 |
| 参数校验 | Zod validate() 覆盖所有 POST/PATCH/DELETE |
| 请求限流 | rateLimit 中间件，429 + Retry-After |
| AI 熔断 | circuitBreaker，避免上游故障放大 |
| Prompt Injection 防护 | harness guardrails 在 think 节点前检查 |
| 工具越权防护 | harness toolPolicy，BLOCK/WARN/PASS 三级 |
| CORS 白名单 | `cors()` 中间件（开发期全开，生产加 origin 限制） |
| 10MB Body 限制 | `express.json({ limit: '10mb' })` + multer fileSize |

---

## 七、启动与调试

```bash
# 启动 BFF
cd apps/server && pnpm dev

# 健康检查
curl http://localhost:3001/api/health

# 监控指标
curl http://localhost:3001/api/metrics | python -m json.tool

# 测试 Chat（流式）
curl -N -X POST http://localhost:3001/api/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"你好"}],"stream":true}'

# 测试限流（快速刷 70 次）
for i in $(seq 1 70); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/documents; done | sort | uniq -c
# 前 60 次应该是 200，后面应该是 429

# 测试熔断器（连续 5 次让 AI 返回错误，然后观察第 6 次是否 503）
```

---

## 八、检验标准（全部勾选 ✅）

- [x] Express 中间件管线完整：CORS → Body Parser → RateLimit → Metrics → Cache → CircuitBreaker → Logger → Routes → NotFound → ErrorHandler
- [x] API Key 只在 `process.env` 中读取，前端产物搜索 `sk-` = 0
- [x] SSE 流式代理正确：Content-Type/Connection/Cache-Control 三个头齐全
- [x] Function Calling 安全：白名单机制 + Zod 校验 + 死循环防护（MAX_ITERATIONS ≤ 5）
- [x] RAG 检索返回 citations（引用片段 + 相似度分数）
- [x] Agent 支持暂停/恢复/回滚，状态持久化到 SQLite
- [x] **生产级改造覆盖 5 项**：限流 / 缓存 / 熔断 / 监控 / 链路追踪

---

## 🧠 面试速查

| 问题 | 一句话回答 |
|------|----------|
| 你这个 BFF 的中间件管线顺序为什么是这样？ | CORS+Parser 最先；限流挡恶意流量；metrics 在缓存前避免污染统计；缓存命中就短路后面；熔断在日志前避免噪音；日志在路由前确保所有请求被记录 |
| 熔断器怎么实现的？ | 三态状态机 CLOSED→OPEN(30s)→HALF_OPEN(1 探测)→CLOSED，HTTP 5xx/429 算失败，连续 3 次失败开路，开路期快速返回 503 |
| SSE 怎么处理客户端断开？ | 循环里检查 `res.writableEnded`，断开就 break；响应头必须三个齐：text/event-stream + no-cache + keep-alive |
| Zod 校验怎么接的？ | validate() 工厂函数返回中间件，body/query/params 可以组合校验，失败返回 400 + 字段级错误详情 |
| 为什么 Chat 和 Agent 用不同的限流配额？ | AI 流式成本高（每个 token 一次 API 消耗），普通接口 60/min，SSE 只给 10/min |
| LRU 缓存怎么淘汰的？ | Map 维护访问顺序，超容量淘汰 lastAccessed 最小的，TTL 60s 自动过期 |
