# 20 · 日志体系 & 可观测性 — 从 console.log 到浏览器实时看板

> 模块：services/logger（门面）+ middleware/logger（接入）+ public/logs-view.html（前端）
> 前置知识：Express 中间件、Node AsyncLocalStorage、SSE 流式通信、PG/MySQL schema 概念
> 难度：⭐⭐ 中级（涉及 async local context 传递、regex 边界坑、SSE 与中间件的爱恨情仇）

---

## 一、整体架构

日志体系是这个项目的**可观测底座**——之前我们遇到过三个完全不同类型的 bug：

| Bug | 表象 | 没有日志体系时 | 有日志体系后 |
|-----|------|---------------|-------------|
| circuitBreaker 改了 SSE headers | 前端卡死"AI 正在思考" | 只能猜是前端问题 | 看到 `ERR_HTTP_HEADERS_SENT` + generator 外层 catch 到 error |
| qualifySchema 把 `SET` 当表名 | 生成完持久化崩了但 SSE 正常 200 | 以为 generator 没问题 | 直接看到 `[ERROR][db] SQL INSERT generator_states FAILED ... syntax error at or near "app"` |
| generator 外层 catch 只打印"生成失败" | 看不到是哪一层挂的 | 要加断点一步步调 | 日志链路：`llm.stream → db → generator.stream` 逐层排查 |

### 分层架构图

```
                    ┌─────────────────────────────────────┐
                    │        services/logger.ts           │
                    │  ┌─────────────────────────────┐   │
  所有模块 ─────────▶│  │  logger.info(tag, msg, data)│   │
  generator          │  │  logger.error(tag, msg, data)│  │
  chain/model        │  └──────────────┬──────────────┘  │
  db/index           │                 │                  │
  middleware/*        │    ┌───────────┼───────────┐     │
  routes/*           │    ▼           ▼           ▼     │
                    │  stdout     环形缓冲区    SSE 广播  │
                    │  (终端彩色)  (2000条)    (订阅推)  │
                    └─────────────────────────────────────┘
                                      │
                   ┌──────────────────┼──────────────────┐
                   ▼                  ▼                  ▼
          GET /api/logs         GET /api/logs/stream   GET /api/logs/tags
          (历史+过滤)           (实时推送)              (模块列表)
                   │                  │
                   ▼                  ▼
          ┌─────────────────────────────────────┐
          │  public/logs-view.html（单文件 HTML）  │
          │  tag 过滤 · level 过滤 · 搜索         │
          │  点击 data 列展开完整结构化数据        │
          └─────────────────────────────────────┘
```

### 链路追踪（requestId）

每个 HTTP 请求进来，requestLogger 生成一个 `X-Request-Id`，通过 **AsyncLocalStorage** 透传到所有 async 调用里：

```
generator.stream（requestId: abc-123）
  └─ llm.invoke（同 requestId）
  └─ db SQL INSERT（同 requestId）
  └─ generator.stream 完成（同 requestId）
  └─ http middleware res.finish（同 requestId）
```

在浏览器日志里，同一个 requestId 的日志会聚集在一起，方便定位一整条请求链。

---

## 二、核心技术点

### 技术点 1：services/logger 门面（单一入口，零循环依赖）

**是什么**：一个模块级单例，所有业务模块都只 `import { logger } from '../services/logger.js'`，调 `logger.info(tag, msg, data)`。

**为什么**：不能让 DB 层 import generator，generator 又 import DB——这会形成循环依赖。而 `services/logger.ts` 只 import Node 内置的 `AsyncLocalStorage`，**零第三方依赖、零内部依赖**，所有模块都可以安全 import 它。

**怎么做**：

```typescript
// services/logger.ts
export const logger = {
  debug: (tag, msg, data) => push('DEBUG', tag, msg, data),
  info:  (tag, msg, data) => push('INFO',  tag, msg, data),
  warn:  (tag, msg, data) => push('WARN',  tag, msg, data),
  error: (tag, msg, data) => push('ERROR', tag, msg, data),
}
```

调用方只传 3 个参数（tag 模块名、msg 人可读、data 结构化），logger 内部统一加时间戳、requestId、进缓冲区、stdout 格式化。

**替代方案**：用 winston/pino 等成熟框架。但对于这个项目的规模，自己写 ~100 行反而更可控——你想加 SSE 订阅时，直接在 `push()` 里加 `queueMicrotask(() => subscribers.forEach(fn => fn(rec)))` 就行，不用绕过框架的 transport 抽象。

---

### 技术点 2：SQL 关键字白名单（qualifySchema 的 4 层边界）

**是什么**：`qualifySchema` 把裸表名 `sessions` 变成 `app.sessions`（PG schema），但用正则 `UPDATE\s+(\w+)` 时不小心把 `SET` 也当表名加了前缀。

**为什么是个坑**：

```sql
-- 原 SQL（正确）
INSERT INTO generator_states ... ON CONFLICT(id) DO UPDATE SET state_json = ...

-- 正则 UPDATE\s+(\w+) 匹配到了 SET
-- 变成（错误！）
INSERT INTO app.generator_states ... ON CONFLICT(id) DO UPDATE app.SET state_json = ...
                                                                    ^^^^^^^^^^^^^^^^
                                                                    PG 不认识这个！
```

**怎么做**：加关键字白名单

```typescript
const reserved = new Set([
  'SET', 'ON', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'VALUES',
  'AND', 'OR', 'AS', 'IS', 'IN', 'NOT', 'NULL', 'LIKE',
  'BY', 'ASC', 'DESC', 'HAVING', 'UNION', 'ALL', 'DISTINCT',
  'CONFLICT', 'DO', 'EXCLUDED', 'DEFAULT', 'CHECK', 'RETURNING',
  // ...更多
])

const qualifySchema = (sql: string): string => {
  return sql.replace(
    /\b(FROM|JOIN|INTO|UPDATE)\s+(?!app\.|...)(\w+)/gi,
    (m, kw, table) => reserved.has(table.toUpperCase()) ? m : `${kw} app.${table}`
  )
}
```

**这 4 层防御缺一不可**：
1. 开头的 `\b` 单词边界——防止匹配 `UPDATEfoo` 里的 `UPDATE`
2. 前面的 `(?!app\.|public\.|pg_|...)` negative lookahead——跳过已经有 schema 前缀的
3. 后面的白名单 Set——防止 SQL 关键字被误判为表名
4. 白名单大小写不敏感（`table.toUpperCase()`）——因为 regex 有 `gi` 标志，但 PG 关键字标准写法是大写

**替代方案**：完全不用正则，用 SQL parser（如 `node-sql-parser`）。但 parser 很重，而且要处理 SQLite 和 PG 两种方言。对于这个项目的 SQL 子集，正则 + 白名单足够。

---

### 技术点 3：circuitBreaker 和 SSE 的爱恨情仇

**是什么**：Express 中间件管线里，如果中间件在 `res.finish` 之后还试图 `res.setHeader()`，就会触发 `ERR_HTTP_HEADERS_SENT`，整个请求崩溃。

**为什么是个坑**：

```javascript
// circuitBreaker 中间件拦截了 res.end()
res.end = (...args) => {
  checkResult()                    // ← 这里试图 setHeader('X-Circuit-State', ...)
  return originalEnd(...args)
}

// 但 generator route 是 SSE，headers 早就在 res.write() 第一条 event 时就发出去了
// generator route:
res.setHeader('Content-Type', 'text/event-stream')  // headers 还没发
res.write(`data: ...\n\n`)                          // ← headers 在这里发出去了！
res.end()                                           // circuitBreaker 拦截这里
  → checkResult() → res.setHeader(...)             // 💥 炸了！
```

**怎么做**：

```typescript
const checkResult = () => {
  if (responded) return
  responded = true
  if (res.headersSent) return  // ← SSE 流的关键守卫：headers 已经发了，跳过！
  // ...熔断统计 + setHeader
}
```

**这条铁律**：任何通过拦截 `res.end` / `res.json` 来做后处理的中间件，**必须先检查 `res.headersSent`**。

---

### 技术点 4：rate limit 白名单（开发期运维接口不该限流）

**是什么**：`/api/logs*`、`/api/logs-view` 这些本地看日志的接口，不应该被 rate limit 封住。

**为什么是个坑**：我们用浏览器打开日志查看器后，页面里 `refreshTags()` 每条 SSE 消息都 fetch 一次 `/api/logs/tags`，很快达到 60 req/min 限额，返回 429。然后整个日志 API 全被封，连 generator 正常跑完后想查日志都不行。

**怎么做**：

```typescript
const WHITELIST_PATHS = [
  /^\/api\/health$/,
  /^\/api\/metrics$/,
  /^\/api\/logs(\/.*)?$/,    // ← 所有日志相关
  /^\/api\/logs-view$/,
  /^\/api\/cache(\/.*)?$/,   // ← 运维接口一起加
  /^\/api\/circuits$/,
]
```

**原则**：不消耗 AI 配额、不消耗昂贵资源的**本地调试/运维接口**，全部放白名单。Rate limit 的目标是**保护 AI 厂商配额**，不是让开发时自己给自己添堵。

---

### 技术点 5：环形缓冲区 + SSE 订阅（两种消费模式共存）

**是什么**：日志同时支持两种消费方式：
1. **拉模式**：`GET /api/logs?tag=db&limit=50` 查历史
2. **推模式**：`GET /api/logs/stream` SSE 实时推送新日志

**怎么做**：

```typescript
const ring: LogRecord[] = []           // 环形缓冲区
const subscribers = new Set<Function>() // SSE 订阅者

function push(rec: LogRecord) {
  ring.push(rec)
  if (ring.length > 2000) ring.shift()       // 环形淘汰
  queueMicrotask(() => {                      // 异步广播，不阻塞写日志的请求
    for (const fn of subscribers) {
      try { fn(rec) } catch { /* 订阅者异常不影响其他 */ }
    }
  })
}
```

**关键设计**：
- `queueMicrotask` 而不是直接 `for...forEach`：写日志的 HTTP 请求不需要等所有 SSE 连接都写完。如果某个浏览器 SSE 连接慢，不应该阻塞 DB/LLM 的正常返回。
- 环形淘汰 2000 条：内存占用可控（每个 LogRecord 约 200 字节，2000 条 ≈ 400KB）。
- 订阅者异常 try-catch：某个浏览器 SSE 连接断开抛异常，不应该影响其他订阅者。

---

### 技术点 6：AsyncLocalStorage 传 requestId（不破坏现有代码）

**是什么**：HTTP 请求进来时，把 requestId 存到 AsyncLocalStorage 里，之后整条 async 调用链（generator → llm → db）都能自动读到。

**为什么**：不想改 generator/llm/db 每个函数签名加 `requestId` 参数——太侵入了。AsyncLocalStorage 提供了一种"隐形传参"能力。

**怎么做**：

```typescript
const als = new AsyncLocalStorage<string>()

export function withRequestId<T>(requestId: string, fn: () => T): T {
  return als.run(requestId, fn)
}

function currentRequestId(): string | undefined {
  return als.getStore()
}
```

在 requestLogger 里包裹整个请求处理：

```typescript
// middleware/logger.ts
res.on('finish', () => {
  withRequestId(requestId, () => {
    logger.info('http', msg, data)  // currentRequestId() 自动拿到
  })
})
next()
```

**为什么 `next()` 不包在 `withRequestId` 里**：因为 `next()` 之后的路由处理函数和中间件也是 async 的，它们的 Promise 链路会自动继承 AsyncLocalStorage 的 context——AsyncLocalStorage 在 Node.js 的 Promise/async/await 链上是自动传播的，不需要手动包裹。

**替代方案**：可以把 requestId 挂到 `res.locals.requestId` 上，然后在每个需要打日志的函数里从 `res.locals` 取。但那样每个函数都得传 `req` 参数下来，更侵入。

---

## 三、Tag 规范 & 分级清单

### 已有 tag

| Tag | 层级 | 说明 | 级别 |
|-----|------|------|------|
| `http` | 请求 | Express middleware 级别 | INFO (200/3xx), WARN (4xx), ERROR (5xx) |
| `http.error` | 请求 | errorHandler 捕获的异常 | ERROR |
| `llm.invoke` | AI | 非流式 LLM 调用（clarify 用） | INFO 开始/完成, ERROR 失败 |
| `llm.stream` | AI | 流式 LLM 调用（generate 用） | INFO 开始/完成, ERROR 失败 |
| `generator.stream` | 业务 | 整个生成流程 | INFO 开始/完成, ERROR 失败 |
| `generator.clarify` | 业务 | 需求细化节点 | INFO 完成, DEBUG 调用中 |
| `generator.retrieve` | 业务 | RAG 检索节点 | INFO 完成 |
| `generator.generate` | 业务 | 代码生成节点 | INFO 开始/完成 |
| `db` | 数据 | 每次 SQL 执行 | DEBUG OK, ERROR FAILED |

### 分级策略

```
DEBUG  — 调试级：每次 SQL OK、LLM 调用开始、chunkCount 等高频细节
INFO   — 正常级：请求完成、业务节点完成、LLM 调用完成
WARN   — 警告级：4xx 请求、RAG 检索为空、rate limit 接近上限
ERROR  — 错误级：5xx 请求、SQL 失败、LLM 失败、网络异常
```

生产部署时可以 `setLogLevel('INFO')` 关掉 DEBUG，本地开发保持 DEBUG 看全链路。

---

## 四、浏览器查看器使用指南

### 访问

```
http://localhost:3001/api/logs-view
```

### 界面功能

```
┌──────────────────────────────────────────────────────────────────────┐
│ 📋 BFF 日志  ●实时  [全部][DEBUG][INFO][WARN][ERROR]  [所有模块▼] 🔍  📜🗑️ 156条 │
├──────────────────────────────────────────────────────────────────────┤
│ 时间       │级别  │模块          │消息                                │数据           │requestId       │
│ 15:59:28.456│ INFO │llm.stream   │调用完成                             │{model, costMs}│2d9f9a28-3363-47│
│ 15:59:28.111│ DEBUG│db           │SQL INSERT generator_states OK      │{op, costMs}   │2d9f9a28-3363-47│
│ 15:59:09.012│ INFO │generator.stream│开始生成                            │{artifactType} │2d9f9a28-3363-47│
└──────────────────────────────────────────────────────────────────────┘
```

| 功能 | 操作 |
|------|------|
| 实时连接状态 | 左上角小圆点：🟢 live / 🔴 断开 |
| 按级别过滤 | 工具栏 `[全部][DEBUG][INFO][WARN][ERROR]` 分段按钮 |
| 按模块过滤 | 工具栏下拉（所有模块 → db / llm.stream / generator.stream 等） |
| 全文搜索 | 🔍 输入框，同时搜 message / tag / requestId / data |
| 展开结构化数据 | 点击数据列，展开完整 JSON（可直接看到 SQL 原文、error message、model 名） |
| 自动滚动 | 📜 按钮，新日志自动滚到顶部 |
| 清空 | 🗑️ 按钮，只清浏览器当前 view（不清服务端缓冲区） |

---

## 五、踩坑记录

| 坑 | 现象 | 根因 | 解决 |
|----|------|------|------|
| circuitBreaker 拦截 SSE headers | 前端 generator 卡死"AI 正在思考" | `res.on('finish')` 在 SSE 模式下，headers 早被 `res.write()` 发出去了，circuitBreaker 还试图 `setHeader` | `checkResult()` 开头加 `if (res.headersSent) return` |
| qualifySchema 把 SET 当表名 | 生成完 generator_states 持久化崩了 | 正则 `UPDATE\s+(\w+)` 匹配到 `ON CONFLICT ... DO UPDATE SET` 里的 `SET` | 加 SQL 关键字白名单（SET/ON/WHERE/VALUES/DO/CONFLICT/EXCLUDED...） |
| 日志页面 tags 刷新刷爆 rate limit | `/api/logs/tags` 返回 429，整个日志 API 被封 | SSE 每条消息都触发 `refreshTags()` → 高频 fetch | 改成 15 秒 `setInterval` 定时刷新 |
| 日志 API 本身被 rate limit 封 | 调试时连 `/api/logs` 都查不了 | 所有接口都在同一个 60 req/min 桶里 | `/api/logs*` 全路径 + `/api/logs-view` 加入 WHITELIST_PATHS |
| db/index.ts 循环依赖 | TypeScript 报循环引用错误 | db/index 想 import logger，logger 又间接 import db | logger.ts 只依赖 Node 内置 `AsyncLocalStorage`，**零内部依赖**，彻底破循环 |

---

## 六、扩展阅读

- [AsyncLocalStorage 官方文档](https://nodejs.org/api/async_context.html#class-asynclocalstorage) — Node.js 隐形上下文传递
- [Express headersSent](https://expressjs.com/en/api.html#res.headersSent) — 判断 headers 是否已发送的守卫
- [SSE EventSource 规范](https://html.spec.whatwg.org/multipage/server-sent-events.html) — 浏览器端 EventSource API
- [SQL qualifySchema 的正则陷阱](https://github.com/pgjdbc/pgjdbc/issues/2224) — JDBC 也踩过类似坑

---

## 七、练习

1. **给 RAG 检索加日志**：`services/rag/index.ts` 的 `search()` 方法，加 `logger.info('rag.search', '向量检索完成', { query, resultCount, costMs })`

2. **给 embedding 加日志**：`services/embedding.ts` 的 embed 方法，加 `logger.debug('embedding', '向量化完成', { textLen, dim, costMs })`

3. **加一个"只看 ERROR"的持久化过滤按钮**：在 logs-view.html 里，点"错误"过滤后刷新页面仍然保留这个状态（用 URL query 或 localStorage 存）

4. **把 DEBUG 级别改成生产环境自动降级**：在 logger.ts 里读 `process.env.NODE_ENV`，生产环境强制 `minLevel = 'INFO'`

5. **练习识别 qualifySchema 的边界**：写一个 SQL 包含 `INTO users SELECT * FROM sessions WHERE id = ? LIMIT 10`，看看白名单能不能正确保护 `INTO` 后面的 `users`（表名）和 `SELECT` 后面的 `sessions`（表名），同时保护 `WHERE` 和 `LIMIT` 不被加前缀
