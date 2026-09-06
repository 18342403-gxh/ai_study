# Phase 14：服务端完整体系 — 从 Express 入门到生产级 BFF

## 学习目标

- 理解"一个完整的服务端 BFF 应该长什么样"：中间件管线到 9 组业务路由到 9 张数据库表
- 掌握 **PostgreSQL + pgvector / SQLite 双驱动切换、Drizzle ORM、零依赖日志门面、SSE + 熔断器** 这些核心考点
- 建立"生产级改造"的思维：限流/缓存/熔断/监控/可观测不是大公司才需要的，小项目也要有
- 能独立回答"你这个 BFF 的中间件管线为什么是这个顺序"、"SQLite 到 PG 怎么做到零业务代码改动"、"SSE 和熔断器怎么共存"

---

## 📐 全景图

```
apps/server/
├── src/
│   ├── index.ts                    ← 入口：中间件管线 + 路由注册 + 优雅关闭 + 自动开日志页
│   ├── db/index.ts                 ← DB 门面（SQLite 同步 / PG 异步 自动切换 + SQL 3 层转换 + 自动日志）
│   ├── middleware/                 ← 6 个中间件（顺序重要）
│   │   ├── rateLimit.ts            ← IP 滑动窗口限流（SSE 单独配额 + 运维接口白名单）
│   │   ├── metrics.ts              ← /api/metrics + P50/P95/P99
│   │   ├── cache.ts                ← LRU 内存缓存（GET 幂等 60s TTL）
│   │   ├── circuitBreaker.ts       ← AI 上游三态熔断器（SSE headersSent 守卫）
│   │   ├── logger.ts               ← requestLogger：requestId + 结构化日志 + AsyncLocalStorage 透传
│   │   └── errorHandler.ts         ← 全局错误 + 404 + asyncHandler
│   ├── routes/                     ← 9 组业务路由
│   │   ├── generator.ts            ← run/iterate — 产品主线
│   │   ├── agent.ts                ← run/pause/resume/rollback/get
│   │   ├── chat.ts                 ← POST /api/chat/completions
│   │   ├── sessions.ts             ← 会话 CRUD + messages
│   │   ├── documents.ts            ← 文档上传/列表/删除
│   │   ├── rag.ts                  ← RAG 查询 + 引用
│   │   ├── kb.ts                   ← 知识库问答
│   │   ├── tools.ts                ← 工具注册 + 执行
│   │   └── logs.ts                 ← GET 历史 + SSE 实时流
│   └── services/                   ← 业务逻辑层 + 统一日志门面
│       ├── logger.ts               ← 零依赖日志门面（所有模块 import 它）
│       ├── chain/model.ts          ← LLM 调用层（invoke + stream 自动打点）
│       ├── embedding.ts            ← 向量嵌入
│       ├── generator/              ← 代码生成 Agent + 迭代逻辑
│       ├── agent/                  ← StateGraph + 持久化
│       ├── rag/                    ← Loader → Splitter → Embeddings → VectorStore
│       └── tools/                  ← Function Calling Engine + 工具注册
├── drizzle/                        ← Drizzle schema + migrations（PG 迁移）
├── public/logs-view.html           ← 📋 单文件 HTML 日志查看器（EventSource SSE）
├── .env.example                    ← 配置模板（双驱动数据库 + 多厂商 AI）
└── package.json
```

---

## 一、中间件管线：顺序就是架构

```typescript
// index.ts 里注册顺序 — 每一层都在保护下一层
app.use(cors())               // ① 跨域
app.use(express.json())       // ② Body Parser（10mb limit）
app.use(rateLimit)            // ③ 限流（挡恶意流量，运维接口白名单跳过）
app.use(metricsMiddleware)    // ④ 开始收集指标
app.use(cacheMiddleware)      // ⑤ 命中缓存直接返回，后面都不走
app.use(circuitBreaker)       // ⑥ 保护 AI 上游不被放大故障
app.use(requestLogger)       // ⑦ 带 requestId 的日志（AsyncLocalStorage 贯穿整条调用链）

initDatabase()                // 初始化 DB（SQLite 立即返回 / PG 连接 + Drizzle migrate）

// 业务路由（9 组）
app.use('/api/generator', generatorRouter)
app.use('/api/agent', agentRouter)
app.use('/api/chat', chatRouter)
// ...
app.use('/api/logs', logsRouter)

// 运维
app.get('/api/health', ...)
app.get('/api/metrics', ...)
app.get('/api/logs-view', ...)  // 📋 浏览器实时日志查看器

// 错误处理（必须在路由之后！）
app.use(notFoundHandler)      // 404 兜底
app.use(errorHandler)         // 全局错误
```

**顺序为什么重要？**

| 顺序 | 放在后面会怎样 |
|------|--------------|
| rateLimit 在 metrics 前面 | 被限流的请求不会被算进 metrics（正确） |
| cache 在 circuitBreaker 前面 | 缓存命中的请求根本不触达 AI 熔断（省配额） |
| circuitBreaker 在 logger 前面 | 开路期直接返回 503，不走 logger（减少噪音） |
| logger 在路由前面 | 所有请求（包括错误）都能被记录 |
| errorHandler 必须最后 | Express 错误处理中间件必须是最后一个 |

---

## 二、统一日志体系（services/logger.ts）

### 为什么要零依赖门面？

项目早期遇到过三个排查地狱：

1. **DB SQL 执行报错**：外层只 catch 到"生成失败"，看不到是哪条 SQL 挂的
2. **LLM 调用超时**：generator.run 的 catch 跟 llm.invoke 的 catch 混在一起
3. **循环依赖**：db/index.ts 想 import generator，generator 又 import db → TypeScript 循环引用

**解决方案**：`services/logger.ts` 只依赖 Node 内置的 `AsyncLocalStorage`，**零第三方依赖、零内部依赖**。所有模块安全 import：

```typescript
// services/logger.ts — 约 100 行，核心就这几个
export const logger = {
  debug: (tag, msg, data) => push('DEBUG', tag, msg, data),
  info:  (tag, msg, data) => push('INFO',  tag, msg, data),
  warn:  (tag, msg, data) => push('WARN',  tag, msg, data),
  error: (tag, msg, data) => push('ERROR', tag, msg, data),
}

// 环形缓冲区（2000 条）+ SSE 订阅者
const ring: LogRecord[] = []
const subscribers = new Set<(rec: LogRecord) => void>()

function push(rec: LogRecord) {
  ring.push(rec)
  if (ring.length > 2000) ring.shift()
  queueMicrotask(() => {   // 异步广播，不阻塞写日志的请求
    for (const fn of subscribers) try { fn(rec) } catch {}
  })
}
```

### 9 个已接入的 tag

| Tag | 层级 | 说明 | 谁在调用 |
|-----|------|------|---------|
| `http` | 请求 | 每个请求 status + duration | requestLogger middleware |
| `llm.invoke` | AI | 非流式调用（clarify 用） | services/chain/model.ts |
| `llm.stream` | AI | 流式调用（generate 用） | services/chain/model.ts |
| `generator.stream` | 业务 | 整个生成流程 | services/generator/agent.ts |
| `generator.clarify` | 业务 | 需求细化节点 | services/generator/agent.ts |
| `generator.retrieve` | 业务 | RAG 检索 | services/generator/agent.ts |
| `generator.generate` | 业务 | 代码生成 | services/generator/agent.ts |
| `db` | 数据 | 每次 SQL 执行（DEBUG OK / ERROR FAILED） | db/index.ts DB 门面 |

### AsyncLocalStorage 传 requestId

```typescript
const als = new AsyncLocalStorage<string>()

export function withRequestId(requestId: string, fn: () => void) {
  als.run(requestId, fn)
}

export function currentRequestId(): string | undefined {
  return als.getStore()
}
```

- requestLogger 生成 requestId → `withRequestId(id, () => next())`
- 之后整条 async 调用链（generator → llm → db）自动继承 context
- 同一个 requestId 的日志聚集在一起，完整展示 DB → LLM → Generator 调用链

### 浏览器实时查看

打开 `http://localhost:3001/api/logs-view` — 单文件 HTML + EventSource SSE 实时流，支持 tag 过滤、level 过滤、搜索、点击数据列展开完整结构化字段。BFF 启动后**自动在浏览器打开**（可通过 `NO_AUTO_OPEN=1` 禁用）。

---

## 三、中间件逐个讲（重点讲有坑的）

### 3.1 circuitBreaker — SSE 爱恨情仇

熔断器拦截 `res.end()` 来判断"这次请求成功还是失败"。但 SSE 流在 `res.write()` 第一条 event 时 **headers 就已经发出去了**，之后 circuitBreaker 还试图 `res.setHeader('X-Circuit-State', ...)` → 💥 `ERR_HTTP_HEADERS_SENT`。

```typescript
// circuitBreaker.ts 修复前
const checkResult = () => {
  if (responded) return
  responded = true
  // 💥 SSE headers 早发了，这里 setHeader 直接炸
  if (res.statusCode >= 500 || res.statusCode === 429) ...
  res.setHeader('X-Circuit-State', state)
}

// 修复后
const checkResult = () => {
  if (responded) return
  responded = true
  if (res.headersSent) return  // ✅ SSE / 任何已发 headers 的响应，跳过 setHeader
  if (res.statusCode >= 500 || res.statusCode === 429) ...
  res.setHeader('X-Circuit-State', state)
}
```

**铁律**：任何通过拦截 `res.end` / `res.json` 来做后处理的中间件，**必须先检查 `res.headersSent`**。

### 3.2 rateLimit — 运维接口白名单

日志 API `/api/logs*` 和 metrics `/api/metrics` 这些本地调试接口不该被限流封死。白名单跳过：

```typescript
const WHITELIST_PATHS = [
  /^\/api\/health$/, /^\/api\/metrics$/,
  /^\/api\/logs(\/.*)?$/,       // 所有日志相关
  /^\/api\/logs-view$/,
  /^\/api\/cache(\/.*)?$/,
  /^\/api\/circuits$/,
]
if (WHITELIST_PATHS.some(r => r.test(req.path))) return next()
```

### 3.3 cache — LRU 内存缓存

GET 幂等接口 60s TTL，Map 维护访问顺序：

```typescript
const CACHEABLE = [/^\/api\/sessions$/, /^\/api\/documents$/, /^\/api\/tools\/list$/, /^\/api\/health$/]

// 拦截 res.json() 把结果存进缓存
const originalJson = res.json.bind(res)
res.json = ((body: any) => {
  cache.set(key, { body, createdAt: now })
  return originalJson(body)
}) as typeof res.json
```

### 3.4 metrics — P50/P95/P99

延迟数组排序取百分位：

```typescript
const durations = [...routeLatencies].sort((a, b) => a - b)
const p = (percentile: number) => durations[Math.floor(percentile / 100 * durations.length)]
```

### 3.5 errorHandler — 全局错误

```typescript
export const errorHandler = (err, _req, res, _next) => {
  const statusCode = err.statusCode || 500
  logger.error('http.error', err.message, { statusCode, stack: err.stack?.slice(0, 500) })
  res.status(statusCode).json({
    error: { message: err.message, code: err.code || 'INTERNAL_ERROR' },
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  })
}
```

---

## 四、数据库：PostgreSQL + pgvector / SQLite 双驱动

### 双驱动零代码切换

通过 `DATABASE_DRIVER` 环境变量切换，**业务代码一行不改**：

```env
# SQLite（默认，零依赖）
DATABASE_DRIVER=sqlite
DB_PATH=./data/knowledge.db

# PostgreSQL + pgvector（生产）
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://ai_study:123456@localhost:5432/ai_study
```

### DB 门面 3 层自动转换

`db/index.ts` 把 SQLite 同步 API（`run` / `get` / `all` 都直接返回值）包装成 Promise 统一接口。同时处理 PG 特有的 3 个差异：

| SQLite | PostgreSQL | 自动转换层 |
|--------|-----------|-----------|
| `INSERT INTO sessions ...`（裸表名） | `INSERT INTO app.sessions ...`（schema 限定） | `qualifySchema()` 正则 + SQL 关键字白名单 |
| `?` 占位符 | `$1, $2, $3...` | `sqliteToPgParams()` 正则替换 |
| `created_at = 1730000000000`（毫秒整数） | `created_at = '2024-10-26T...'`（ISO 字符串） | `coerceParams()` 启发式：数字 > 1e12 当时间戳转 ISO |

**qualifySchema 为什么需要 SQL 关键字白名单？**

```sql
-- 原 SQL
INSERT INTO generator_states ... ON CONFLICT(id) DO UPDATE SET state_json = ...

-- 正则 UPDATE\s+(\w+) 匹配到了 SET
-- 变成（错误！）
ON CONFLICT(id) DO UPDATE app.SET state_json = ...
                               ^^^^^^^^
```

所以白名单保护 `SET`/`ON`/`WHERE`/`VALUES`/`DO`/`CONFLICT`/`EXCLUDED` 等 SQL 关键字不被当作表名。

### 9 张表（app schema）

| 表 | 用途 | SQLite 类型 | PG 类型 |
|----|------|-----------|--------|
| `documents` | RAG 文档元数据 | TEXT / INTEGER | TEXT / BIGINT |
| `chunks` | 文档分块 + embedding | embedding TEXT（JSON 字符串） | **embedding vector(1536)** + HNSW 索引 |
| `sessions` | 会话 | — | — |
| `messages` | 消息 | — | — |
| `agent_states` | Agent 多步状态持久化 | — | — |
| `tool_calls` | 工具调用审计 | — | — |
| `generator_sessions` | 生成器会话 | — | — |
| `generator_files` | 生成器产出文件（多版本） | — | — |
| `generator_states` | 兼容旧代码的状态表 | — | — |

### pgvector HNSW 向量索引

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX idx_chunks_embedding ON app.chunks
  USING hnsw (embedding vector_cosine_ops);
```

HNSW（Hierarchical Navigable Small World）近似最近邻索引，比暴力扫描快 100-1000x，毫秒级向量检索。

### 每次 SQL 执行自动打点

DB 门面在 `prepare()` 返回的 `run/get/all` 里包了一层：

```typescript
async run(...params) {
  const t0 = Date.now()
  try {
    const rows = await client.unsafe(pgSql, coerceParams(params))
    logger.debug('db', `SQL ${op} ${table} OK`, { op, table, costMs: Date.now() - t0 })
    return { lastInsertRowid: rows?.[0]?.id, changes: rows?.length }
  } catch (err) {
    logger.error('db', `SQL ${op} ${table} FAILED`, { op, table, error: err.message, sql: pgSql })
    throw err
  }
}
```

SQLite 层也一样——`wrapSqliteAsAsync()` 里同样包了日志。所以不管用什么驱动，**每次 SQL 执行都会自动出现在浏览器日志里**。

---

## 五、LLM 调用层：完整打点 + 错误分类

`services/chain/model.ts` 的 `invoke()` 和 `stream()` 都是完整打点：

```typescript
async invoke(input) {
  logger.info('llm.invoke', '调用开始', { model, messageCount: messages.length })
  const t0 = Date.now()
  try {
    const response = await fetch(...)
    if (!response.ok) {
      logger.error('llm.invoke', '调用失败', { model, status: response.status, error: errText, costMs: Date.now() - t0 })
      throw new Error(`AI 请求失败 (${response.status}): ${errText}`)
    }
    const data = await response.json()
    logger.info('llm.invoke', '调用完成', { model, costMs: Date.now() - t0, usage: data.usage })
    return data.choices[0].message.content
  } catch (err) {
    logger.error('llm.invoke', '网络异常', { model, error: err.message, costMs: Date.now() - t0 })
    throw err
  }
}
```

**错误分类**：HTTP 错误（厂商返回 4xx/5xx）→ 打 `调用失败`；网络错误（超时/DNS）→ 打 `网络异常`。两种错误在日志里一目了然，排查时直接看 ERROR 行的 message 字段。

---

## 六、SSE 事件协议

Generator 和 Agent 统一协议：

```jsonc
// Generator run/iterate
{ "type": "thread_id", "threadId": "xxx" }
{ "event": "on_chain_start", "node": "clarify", "data": {} }
{ "event": "on_chain_end",   "node": "clarify", "data": { "content": "...", "resultLen": 1389, "costMs": 17881 } }
{ "event": "on_iteration_complete", "data": { "stateId": "...", "result": { "files": [...] } } }
{ "type": "done", "threadId": "xxx" }
{ "type": "error", "message": "..." }
```

**SSE 三个必须头**：
```typescript
res.setHeader('Content-Type', 'text/event-stream')
res.setHeader('Cache-Control', 'no-cache')
res.setHeader('Connection', 'keep-alive')
```

**客户端断开**：`for await ... of reader.read()` 循环里检查 `res.writableEnded`，断开就 break。但——熔断器已经在 `checkResult()` 里守卫了 `headersSent`，不会再炸。

---

## 七、9 组业务路由

| 文件 | 主要路径 | 说明 |
|------|---------|------|
| generator.ts | `POST /run`, `POST /iterate`, `GET /:id` | 产品主线，双模式组件/Skill 生成 |
| agent.ts | `POST /run`, `POST /:id/pause`, `POST /:id/resume`, `POST /:id/rollback` | LangGraph Agent |
| chat.ts | `POST /completions` | 简单对话（流式可选） |
| sessions.ts | CRUD + messages | 会话管理 |
| documents.ts | `POST /upload`, `GET /`, `DELETE /:id` | RAG 文档 |
| rag.ts | `POST /query`, `GET /:id` | 向量检索 |
| kb.ts | `POST /query` | 知识库问答 |
| tools.ts | `GET /list`, `POST /execute`, `POST /run` | Function Calling |
| logs.ts | `GET /`, `GET /stream`（SSE）, `GET /tags` | 日志查询 + 实时流 |

---

## 八、安全约束

| 约束 | 实现 |
|------|------|
| API Key 只在 `process.env` | `.env` 加 `.gitignore`，前端产物搜索 `AI_API_KEY` = 0 |
| 参数校验 | 关键路由有 Zod validate() |
| 请求限流 | rateLimit 中间件，SSE 单独 10 req/min，运维接口白名单跳过 |
| AI 熔断 | circuitBreaker 三态状态机 |
| CORS | 开发期全开，生产加 origin 限制 |
| 10MB Body | `express.json({ limit: '10mb' })` |
| DB 错误不泄露 | DB 门面 catch 后只 log，不把原始 error.message 透传到 errorHandler |

---

## 九、启动与调试

```bash
# 启动 BFF（自动打开日志查看器）
cd apps/server && pnpm dev

# 禁用自动打开
NO_AUTO_OPEN=1 pnpm dev

# 健康检查
curl http://localhost:3001/api/health

# 监控指标
curl http://localhost:3001/api/metrics | python -m json.tool

# 📋 浏览器实时日志（也可直接访问）
open http://localhost:3001/api/logs-view   # macOS
start http://localhost:3001/api/logs-view  # Windows

# 测试 Generator（流式）
curl -N -X POST http://localhost:3001/api/generator/run \
  -H "Content-Type: application/json" \
  -d '{"requirement":"数据表格","artifactType":"component","framework":"vue"}'

# 测试 PG 连接（如果用 postgres）
$env:PGPASSWORD="123456"; & "D:\PostgreSQL\bin\psql.exe" -U ai_study -d ai_study -c "SELECT tablename FROM pg_tables WHERE schemaname='app';"
```

---

## 十、检验标准

- [x] Express 中间件管线完整：CORS → Parser → RateLimit → Metrics → Cache → CircuitBreaker → Logger → Routes → 404 → ErrorHandler
- [x] PostgreSQL + pgvector / SQLite 双驱动零代码切换（`DATABASE_DRIVER`）
- [x] DB 门面 3 层自动转换：`?→$1` / `裸表名→app.表名` / `毫秒→ISO`
- [x] **9 个 DB 表**，chunks.embedding 为 `vector(1536)` + HNSW 索引
- [x] 统一日志门面（services/logger.ts 零依赖）+ 环形缓冲区 2000 条 + SSE 广播
- [x] AsyncLocalStorage 贯穿 requestId（DB → LLM → Generator → HTTP 全链路）
- [x] DB 层每次 SQL 执行自动 DEBUG，失败 ERROR（含完整 SQL + error）
- [x] LLM 层 invoke/stream 完整打点（模型名 / chunk 数 / costMs / 错误分类）
- [x] circuitBreaker 不炸 SSE：`checkResult()` 守卫 `res.headersSent`
- [x] rateLimit 不封运维接口：`/api/logs*` / `/api/metrics` 白名单
- [x] API Key 只在 `process.env` 中读取
- [x] **BFF 启动后自动打开日志查看器**（`NO_AUTO_OPEN=1` 可禁用）

---

## 🧠 面试速查

| 问题 | 一句话回答 |
|------|----------|
| 中间件管线顺序？ | CORS+Parser 最先；限流挡恶意流量；metrics 在缓存前避免污染统计；缓存命中短路后面；熔断在日志前减少噪音；日志在路由前确保全覆盖 |
| SQLite 到 PG 怎么零代码切换？ | DB 门面双驱动，SQLite 同步包装成 Promise，PG 异步 3 层自动转换（`?→$1` / 裸表名→schema / 毫秒→ISO） |
| qualifySchema 为什么需要 SQL 关键字白名单？ | 正则 `UPDATE\s+(\w+)` 会把 `ON CONFLICT ... DO UPDATE SET` 的 `SET` 也当表名，白名单保护关键字不被加前缀 |
| circuitBreaker 和 SSE 怎么共存？ | `checkResult()` 开头加 `if (res.headersSent) return`，SSE 流在第一条 `res.write()` 时 headers 已发，不能再 `setHeader` |
| 日志门面为什么要零依赖？ | DB 层想 import generator 会形成循环依赖，logger 只依赖 AsyncLocalStorage，所有模块安全 import |
| requestId 怎么贯穿全链路？ | requestLogger 生成 → AsyncLocalStorage.run() → 整条 async/Promise 链自动继承 → logger.push() 自动附加 |
| pgvector 是什么？ | PostgreSQL 扩展，增加 `vector` 数据类型，支持 HNSW 近似最近邻索引，比暴力扫描快 100-1000x |
