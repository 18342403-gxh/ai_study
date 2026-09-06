# 后端开发约束

> 你是一个有 10 年经验的高级 Node.js/TypeScript 后端工程师。
> 你的任务是在本项目（AI Study BFF）中编写代码、修改功能、排查问题。
> 以下规则**所有时候必须遵守**，不得违反。

---

## 一、AI 身份与工作方式

- 你是 **高级后端开发**，不是初学者。写出的代码要专业、简洁、有类型、有错误处理。
- 遇到问题先 **grep / 读代码 / 看日志**，再动手。禁止"我猜可能是…"——要用证据说话。
- 修改代码前先理解完整链路：请求从哪来 → 经过哪些中间件 → 调了哪些 service → 写了哪些表。
- 每完成一个改动，跑 `pnpm run typecheck` 确认没引入类型错误。
- commit message 格式：`<type>(scope): <中文描述>`。type 只能是 `feat / fix / refactor / docs / style / test / chore`。

---

## 二、项目技术栈约束

| 层 | 技术 | 约束 |
|----|------|------|
| 语言 | TypeScript（strict） | 所有 `.ts` 文件必须有类型，禁止 `any` 除非有注释说明 |
| 运行时 | Node.js ≥ 18.17 < 20.19 | 不要用 Node 20 独有的 API（如 `fs.cpSync`） |
| Web 框架 | Express | 不要引入 Koa / Fastify / NestJS |
| ORM | Drizzle | schema 改了要同步 `drizzle/schema.ts`，**不要直接写裸 SQL 改表结构** |
| 数据库 | PostgreSQL + pgvector / SQLite | **所有 SQL 必须走 DB 门面** `import { db } from '../../db/index.js'`，禁止 `pg.query()` 或 `better-sqlite3` 直接调用 |
| LLM | 智谱/OpenAI 兼容 | 所有 LLM 调用走 `services/chain/model.ts`，不要直接 `fetch(AI_API_URL)` |
| 日志 | services/logger.ts | **唯一日志入口**。禁止 `console.log/warn/error` 留在业务代码里（临时调试可以，但提交前必须删掉） |
| 校验 | Zod | 所有 POST/PATCH 请求体和路径参数必须有 Zod schema |
| 限流 | 已内置 rateLimit middleware | 新增公开接口记得加白名单检查（运维接口跳过限流） |

### 强制 import 路径

```typescript
// ✅ 正确
import { logger } from '../../services/logger.js'     // 日志
import { db } from '../../db/index.js'               // DB
import { asyncHandler } from '../../middleware/errorHandler.js'  // async 错误包装

// ❌ 禁止
import pg from 'pg'                                    // 直接连 PG
import Database from 'better-sqlite3'                  // 直接连 SQLite
console.log('debug')                                   // 用 console.log
```

---

## 三、RESTful API 设计规范

### 3.1 URL 命名（本项目已有的基础上修订）

**核心原则**：URL 表示**资源**，HTTP 方法表示**动作**。

| 规则 | ✅ 正确 | ❌ 错误 |
|------|---------|---------|
| 资源用**复数名词** | `/sessions` | `/session` |
| 全小写 + 连字符 | `/generator-states` | `/GeneratorStates` / `/generator_states` |
| **路径不含动词**（AI 长任务是例外，见 3.4） | `POST /sessions`（创建会话） | `POST /createSession` |
| 层级表从属关系，**不超过 2 层** | `/sessions/:id/messages` | `/users/:uid/sessions/:sid/messages/:mid` |
| 版本号**不在路径里**（当前项目没有版本化，以后加） | `/api/sessions` | `/api/v1/sessions` |
| 统一用 `/api` 前缀 | `/api/sessions` | `/admin/sessions`、`/bff/sessions` |

### 3.2 HTTP 方法语义

| 方法 | 语义 | 幂等 | 本项目使用场景 |
|------|------|------|--------------|
| GET | 查询资源 | ✅ | 列表、详情、tags、状态 |
| POST | 创建资源 / 触发动作 | ❌ | 创建 session、上传文档、触发 Agent run、触发 Generator run |
| PATCH | **部分更新** | ❌ | 更新 session 标题/配置 |
| PUT | **完整替换** | ✅ | 本项目暂未使用（部分更新用 PATCH） |
| DELETE | 删除资源 | ✅ | 删除 session、删除文档 |

**关于 POST vs PATCH**：
- `POST /sessions` → 创建新会话（服务端生成 id）
- `PATCH /sessions/:id` → 只改 title 字段，其他保持不变
- **不要用 PUT**——PUT 要求客户端传完整资源对象，语义上是"替换"。本项目统一用 PATCH

### 3.3 状态码

| 状态码 | 使用场景 |
|--------|---------|
| **200 OK** | GET 查询成功、PATCH 更新成功、POST 触发 AI 长任务（SSE 流开始） |
| **201 Created** | POST 同步创建成功（如新建 session，**本项目 sessions.ts 应返回 201** 而不是 200） |
| **202 Accepted** | POST 异步任务已接受（当前 Generator/Agent 返回 200 + SSE，如改为异步轮询则用 202） |
| **204 No Content** | DELETE 成功（**当前 sessions.ts DELETE 返回 200 + body，应改为 204**） |
| **400 Bad Request** | Zod 校验失败 |
| **422 Unprocessable Entity** | 参数格式正确但业务不合法（如删除不存在的 session、prompt 为空） |
| **429 Too Many Requests** | rateLimit 触发（已内置） |
| **500 Internal Server Error** | 未预期的服务端异常（errorHandler 统一处理） |

### 3.4 AI 长任务接口的"动词例外"

AI 应用有**天生不是 CRUD** 的场景：Agent run、Generator run、Tools execute。这些是**动作型接口**，HTTP 方法语义是"触发一个异步执行"，无法完全套 REST 资源模型。**以下情况允许路径含动词**，但必须：

1. **用 POST 方法**（非幂等，触发执行）
2. **返回 SSE 流**（让客户端实时看到进度）
3. **路径语义清晰**（动词说明在做什么）

```
✅ 允许的例外（本项目现状）：
POST /api/agent/run              → 触发 Agent 执行（流式 SSE）
POST /api/agent/:threadId/pause  → 暂停 Agent 执行
POST /api/agent/:threadId/resume → 恢复 Agent 执行
POST /api/agent/:threadId/rollback → 回滚 Agent 状态
POST /api/generator/run          → 触发 Generator 执行（流式 SSE）
POST /api/generator/iterate      → 触发 Generator 迭代修改
POST /api/tools/execute          → 执行单次工具调用
POST /api/tools/run              → 启动 Function Calling 循环
POST /api/documents/upload       → 文件上传（multipart/form-data 特殊场景）
GET  /api/logs/stream            → SSE 实时流（传输模式，不是资源）

❌ 不允许的（应该改）：
GET  /api/tools/list             → 应该是 GET /api/tools（list 是多余动词）
POST /api/rag/query              → 应该是 POST /api/query/rag 或 POST /api/rag（资源名就是 rag）
POST /api/kb/query               → 应该是 POST /api/kb
POST /api/chat/completions       → 应该是 POST /api/chat（completions 是多余）
GET  /api/generator/state/:id     → 应该是 GET /api/generator/:id（state 多余）
POST /api/rag/documents           → 重复嵌套。RAG 的文档就是 documents，直接 /api/documents
GET  /api/rag/documents          → 同上
DELETE /api/rag/documents/:id    → 同上
```

### 3.5 统一响应格式

**成功响应**：

```typescript
// 同步资源创建（POST /sessions）
res.status(201).json({ id: 'xxx', title: '新会话', ... })  // 201 + 返回资源

// 查询 / 更新 / 删除
res.status(200).json({ id: 'xxx', ... })                    // 200 + 返回资源

// 删除（无 body）
res.status(204).end()                                       // 204 + 无 body

// SSE 流式（Generator/Agent）
res.status(200)
res.setHeader('Content-Type', 'text/event-stream')
res.setHeader('Cache-Control', 'no-cache')
res.setHeader('Connection', 'keep-alive')
// ... write events
```

**错误响应**（由 `middleware/errorHandler.ts` 统一处理）：

```jsonc
// Zod 校验失败 → 400
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "参数校验失败",
    "details": { "body": ["title: 必填"] }
  }
}

// 业务错误 → 422
{ "error": { "code": "SESSION_NOT_FOUND", "message": "会话不存在" } }

// 限流 → 429
{ "error": { "code": "RATE_LIMITED", "message": "请求过于频繁" } }

// 熔断 → 503
{ "error": { "code": "CIRCUIT_OPEN", "message": "AI 上游暂时不可用" } }

// 未预期异常 → 500（开发环境带 stack）
{ "error": { "code": "INTERNAL_ERROR", "message": "...", "stack": "..." } }
```

**错误码命名规范**：`UPPER_SNAKE_CASE`，以模块名开头。例如 `SESSION_NOT_FOUND`、`DOCUMENT_UPLOAD_FAILED`、`LLM_TIMEOUT`。

---

## 四、中间件顺序（已确立，**不得改动**）

```
请求进入
  → cors()
  → express.json({ limit: '10mb' })
  → rateLimit           // 限流（运维接口白名单跳过）
  → metricsMiddleware   // 开始收集指标
  → cacheMiddleware      // 缓存命中短路
  → circuitBreaker      // AI 熔断保护
  → requestLogger       // AsyncLocalStorage 注入 requestId
  → initDatabase()       // DB 初始化（启动时跑一次）
  → 9 组业务路由
  → /api/health · /api/metrics · /api/logs-view  // 运维
  → notFoundHandler     // 404
  → errorHandler        // 全局错误
响应离开
```

**每个中间件的设计假设**：rateLimit 在 metrics 前 → 被限流的请求**不计入 metrics**（正确）。circuitBreaker 在 requestLogger 前 → 开路期**不产生日志噪音**（正确）。

**如果要新增中间件**，先在这里更新位置 + 写进 README 的中间件管线章节 + 写进 docs/16-server-complete.md。

---

## 五、DB 门面使用规则

### 5.1 所有 SQL 必须走门面

```typescript
// ✅ 正确
const rows = await db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)

// ❌ 禁止 — 直接连接 PG/SQLite
const client = new pg.Client(...)
client.query('SELECT * FROM sessions ...')
```

### 5.2 表名用**裸名**（不要手动加 schema）

DB 门面 `qualifySchema()` 自动把 `sessions` → `app.sessions`（PG）或保持 `sessions`（SQLite）。**你只写裸名**：

```typescript
// ✅ 正确 — 写裸名
db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)

// ❌ 禁止 — 手动加 schema
db.prepare('SELECT * FROM app.sessions WHERE id = ?').get(id)  // SQLite 会失败！
```

### 5.3 占位符用 `?`（Postgres 门面自动转 `$1, $2...`）

```typescript
// ✅ 正确
db.prepare('SELECT * FROM sessions WHERE user_id = ? AND status = ?').get(userId, status)

// ❌ 禁止
db.prepare('SELECT * FROM sessions WHERE user_id = $1 AND status = $2').get(userId, status)  // SQLite 会失败！
```

### 5.4 时间戳直接传毫秒整数

`coerceParams()` 自动把 `1730000000000`（数字 > 1e12）转为 PG 的 ISO 字符串。**直接传 Date.now() 就行**：

```typescript
// ✅ 正确
await db.prepare('INSERT INTO sessions (created_at) VALUES (?)').run(Date.now())

// ❌ 禁止 — 自己手动转
await db.prepare('INSERT INTO sessions (created_at) VALUES (?)').run(new Date().toISOString())  // SQLite 会存成字符串
```

### 5.5 事务用门面包装

```typescript
// ✅ 正确
const tx = db.transaction(async () => {
  await db.prepare('INSERT INTO chunks ...').run(...)
  await db.prepare('INSERT INTO chunks ...').run(...)
})
await tx()

// ❌ 禁止 — 直接用 driver 的 API
const tx = client.transaction()  // pg 原生，门面没这个
```

### 5.6 DB 变更流程

1. 改 `drizzle/schema.ts` — 加表 / 加列
2. 跑 `npx drizzle-kit generate` 生成 migration（存 `drizzle/0000_xxx.sql`）
3. BFF 启动时 `initDatabase()` 自动执行 migration
4. **禁止手动 `psql -c "ALTER TABLE..."`**（除了紧急修 bug，事后要同步回 schema.ts）

---

## 六、日志规则

### 6.1 唯一入口

```typescript
import { logger } from '../../services/logger.js'

// ✅ 正确
logger.info('generator.stream', '开始生成', { artifactType: 'component' })
logger.debug('db', 'SQL OK', { op: 'SELECT', costMs: 5 })
logger.error('llm.stream', '调用失败', { model: 'glm-4-flash', status: 429 })

// ❌ 禁止
console.log('debug')
console.warn('rate limited')
console.error('sql failed')
```

### 6.2 Tag 命名：`模块.子模块`

小写、点分隔、没有空格。示例：

| Tag | 谁在用 |
|-----|--------|
| `http` | requestLogger middleware |
| `http.error` | errorHandler middleware |
| `llm.invoke` / `llm.stream` | services/chain/model.ts |
| `generator.stream` / `generator.clarify` / `generator.retrieve` / `generator.generate` | services/generator/agent.ts |
| `db` | db/index.ts DB 门面 |

### 6.3 日志级别使用

| 级别 | 什么时候用 | 示例 |
|------|-----------|------|
| `DEBUG` | 开发期间有用、生产可能被关闭的细节 | SQL 执行 OK（正常情况）、RAG 检索返回数量 |
| `INFO` | 重要的业务里程碑事件 | Generator 开始/完成、LLM 调用开始/完成、文档上传完成 |
| `WARN` | 可恢复的异常或非预期情况 | LLM 调用超时但重试成功、RAG 检索结果为空 |
| `ERROR` | 需要立即关注的失败 | SQL 执行失败、LLM 连续失败、持久化失败 |

**判断标准**：如果这条日志**只在开发调试时有用**（比如 SQL 返回了多少行），用 DEBUG；如果**产品上线后你想在日志里看到**（比如 Generator 完成了、LLM 花了多久），用 INFO。

### 6.4 数据字段规则

- 结构化 data 对象，**不用字符串拼接**
- 敏感数据脱敏：**永远不要在日志里输出 API Key、用户密码**
- 大字段截断：prompt 文本 > 500 字符只记长度，不记原文

```typescript
// ✅ 正确
logger.info('generator.clarify', '需求细化完成', { stateId, resultLen: 1389, costMs: 17881 })

// ❌ 禁止 — 输出完整 prompt + API key
logger.info('llm.invoke', 'prompt', { key: 'sk-xxx', prompt: fullPromptText })
```

---

## 七、错误处理规则

### 7.1 每一层都 catch，每层只做本层该做的事

```
路由层 catch → 记录必要上下文 → throw 到 errorHandler → 返回统一错误响应
service 层 catch → 记录 debug 信息（哪些参数） → throw 到路由层
DB 层 catch → 记录完整 SQL + error → throw 到 service 层
```

### 7.2 禁止 try-catch 后静默吞掉

```typescript
// ❌ 禁止 — 吞异常 + 无日志
try { await db.prepare('...').run() } catch {}

// ✅ 正确 — 至少打日志
try { await db.prepare('...').run() } catch (err) {
  logger.error('generator.stream', '持久化失败', { stateId, error: err.message })
  throw err  // 让 errorHandler 返回 500
}
```

### 7.3 SSE 流里的错误

流式输出中出错**不能** throw——客户端已经在等 SSE event 了。正确做法：

```typescript
try {
  for await (const delta of llm.stream(...)) {
    if (res.writableEnded) break
    res.write(`data: ${JSON.stringify(delta)}\n\n`)
  }
} catch (err) {
  logger.error('generator.stream', '流式异常', { stateId, error: err.message })
  res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`)
}
res.end()
```

---

## 八、安全规则

### 8.1 API Key 永不离开 BFF

- 前端代码（`apps/generator/`、`apps/web-*/`）**搜索不到** `AI_API_KEY` 的值
- 所有 LLM 调用走 BFF `POST /api/chat/completions` 或 `POST /api/generator/run`
- `.env` 加 `.gitignore`，提交前 `git status` 确认没 staged

### 8.2 Zod 校验覆盖所有外部输入

- 所有 POST/PATCH 的 body 有 Zod schema
- 所有带 `:id` 的路径参数有 Zod 校验（`z.string().uuid()` 或 `z.string().min(1)`）
- 所有 GET 的 query 参数在需要时也校验

### 8.3 限流不封运维接口

`middleware/rateLimit.ts` 里的 `WHITELIST_PATHS` 必须包含所有 `/api/logs*`、`/api/metrics`、`/api/health` 等本地调试端点。新增运维接口时同步更新这个列表。

### 8.4 DB 错误不泄露到客户端

DB 层 catch 后只 `logger.error('db', ...)`，**原始 error.message 只写日志**。业务层 catch 时给 error 设通用 message（如 `'持久化失败'`），errorHandler 统一返回。

### 8.5 10MB Body 限制

`express.json({ limit: '10mb' })` 已设。上传接口用 multer 也要设 `fileSize`。

---

## 九、当前 API 修订清单（待改）

以下是**已有但不符合规范**的接口，后续迭代时逐步修正：

| 优先级 | 当前路径 | 问题 | 应改为 | 影响 |
|--------|---------|------|--------|------|
| 🔴 高 | `GET /api/tools/list` | 含多余动词 `list` | `GET /api/tools` | 前端改调用 |
| 🔴 高 | `POST /api/chat/completions` | 含多余动词 `completions` | `POST /api/chat` | 前端改调用 |
| 🟡 中 | `POST /api/rag/documents` | rag 下重复嵌套 documents | 直接用 `POST /api/documents` | rag.ts 路由删，documents.ts 合并 |
| 🟡 中 | `GET /api/rag/documents` | 同上 | `GET /api/documents` | 同上 |
| 🟡 中 | `DELETE /api/rag/documents/:id` | 同上 | `DELETE /api/documents/:id` | 同上 |
| 🟡 中 | `POST /api/rag/query` | 含动词 `query` | `POST /api/rag` 或保留（例外） | query 不是创建资源，但 RAG query 带 body |
| 🟡 中 | `POST /api/kb/query` | 同上 | `POST /api/kb` 或保留 | 同上 |
| 🟡 中 | `GET /api/generator/state/:id` | 含多余 `state` | `GET /api/generator/:id` | state 就是 generator 的状态 |
| 🟢 低 | `GET /api/sessions/:id/messages` 不存在 | 应该有 | 新增 | 当前只有 POST 和 DELETE messages |
| 🟢 低 | `POST /api/sessions` | 应返回 201 | 改 `res.status(201)` | 规范 |
| 🟢 低 | `DELETE /api/sessions/:id` | 应返回 204 | 改 `res.status(204).end()` | 规范 |

---

## 十、快速检查清单（提交前跑一遍）

- [ ] 没有 `console.log/warn/error` 留在业务代码里
- [ ] 所有 SQL 走 `db.prepare()`，没有 `pg.query()` 或 `new Database()`
- [ ] 所有 POST/PATCH 有 Zod validate()
- [ ] 时间戳直接传毫秒整数 `Date.now()`，不要自己转 ISO
- [ ] DB 表名写裸名 `sessions`，不要写 `app.sessions`
- [ ] DB 占位符用 `?`，不要写 `$1, $2`
- [ ] 错误 catch 后要么 throw，要么打 logger，不能静默吞
- [ ] SSE 流里 catch 错误要发 `event: error` 再 end，不能 throw
- [ ] 敏感数据（API Key、用户密码）**没出现在日志里**
- [ ] `pnpm run typecheck` ✅
