# 后端规范合规性审计报告

> 审计时间：2026-09-07
> 对照规范：`.trae/backend-rules.md`（12 章 630 行）
> 扫描范围：`apps/server/src/**/*.ts`（9 路由 + 6 middleware + services 全模块 + db 门面）

---

## 总览

| 严重级别 | 数量 | 说明 |
|----------|------|------|
| 🔴 HIGH | 4 | 必须尽快修，影响生产稳定性或规范铁律 |
| 🟡 MED | 9 | 应在近期迭代中修，代码质量/可观测性 |
| 🟢 LOW | 6 | 规范建议，不紧急 |
| ✅ 合规亮点 | 5 | 做得好的地方也要肯定 |

---

## 🔴 HIGH（4 项）

### H1. `POST /api/generator/iterate` 没有错误 catch

**规范**：七、错误处理 — SSE 流里 catch 错误要发 `event: error` 再 end，不能 throw

**位置**：`routes/generator.ts:47-63`

**问题**：
```typescript
// run 有 try-catch ✅
try {
  for await (...) { res.write(...) }
  res.write(`data: done\n\n`)
} catch (err) {
  if (!res.headersSent) throw err
  res.write(`data: error\n\n`)
}
res.end()

// iterate 没有 try-catch ❌
for await (const event of generator.iterate(stateId, feedback)) {
  res.write(`data: ${JSON.stringify({ type: 'event', ...event })}\n\n`)
}
res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
res.end()
```

`generator.iterate()` 内部任何异常都会直接传到 asyncHandler → errorHandler → 返回 500 JSON → **但 SSE headers 已发** → 客户端收到半截流 + 一个 JSON error，解析崩溃。

### H2. `POST /api/rag/documents` 数据库写入没有 await

**规范**：五、DB 门面 — 所有 SQL 走 `db.prepare().run()` 且必须 await

**位置**：`routes/rag.ts:56-59, 65-67`

```typescript
// ❌ rag.ts 里有两处 db.prepare(...).run() 没有 await
db.prepare(
  `INSERT INTO documents ...`
).run(documentId, file.originalname, ...)  // 没有 await！

// 后面 UPDATE 也一样
db.prepare(
  `UPDATE documents SET status = 'ready' ...`
).run(...)  // 没有 await！
```

虽然 SQLite 是同步的当前能跑，但 PG 下 `run()` 返回 Promise，**不 await = 异步返回 = UPDATE 可能在 SELECT 之后才完成**（时序不可控）。而且违反规范铁律：所有 DB 操作必须 await。

### H3. `POST /api/rag/documents` 整个路由没有日志

**规范**：六、日志规则 — 新增的 service 函数入口有 INFO，出口有 INFO/ERROR

**位置**：`routes/rag.ts:43-74`

整个 upload 流程（DB 写 documents → ragService.ingestFromFileWithId → DB UPDATE status）**一条业务层日志都没有**。只有 DB 门面自动的 `db DEBUG SQL xxx OK`，没有入口 `logger.info('rag.documents', '开始上传', ...)` 和出口 `logger.info('rag.documents', '上传完成', ...)`。如果 upload 失败在 ingest 环节，日志里只能看到前面的 DB OK，看不到是哪一步挂的。

### H4. `services/agent/harness/evalRunner.ts` 有 `console.log`

**规范**：二、技术栈约束 + 六、日志规则 — 唯一日志入口是 `services/logger.ts`

**位置**：`services/agent/harness/evalRunner.ts:115`

```typescript
console.log(`${icon} [${tc.id}] ${tc.input.slice(0, 30)}... — ${result.details}`)
```

虽然是 evalRunner（测试/评估专用），但如果这个文件会被生产代码 import，console.log 会漏到生产输出。应该改成 `logger.debug('harness.eval', ...)`。

---

## 🟡 MED（9 项）

### M1. `GET /api/generator/state/:id` 没有 params Zod 校验

**规范**：二、技术栈约束 — 所有带 `:id` 的路径参数有 Zod 校验

**位置**：`routes/generator.ts:67`

```typescript
router.get<{ id: string }>(
  '/state/:id',
  asyncHandler(async (req, res) => {  // 没有 validate({ params: z.object({ id: z.string().min(1) }) })
```

### M2. `DELETE /api/rag/documents/:id` 没有 params Zod 校验

**规范**：同上

**位置**：`routes/rag.ts:156`

```typescript
router.delete<{ id: string }>(
  '/documents/:id',
  asyncHandler(async (req, res) => {  // 没有 validate
```

### M3. `POST /api/rag/documents` 和 `GET/DELETE /api/rag/documents` 是重复路由

**规范**：RESTful — 路径不含重复资源名

**位置**：`routes/rag.ts:44, 78, 156`

`/api/rag/documents` 就是 documents.ts 里的 `/api/documents`。rag 下嵌套 documents 是多余的——documents 是独立资源，不属于 rag 资源。应该统一到 `documents.ts`，rag.ts 保留 `/api/rag/query` 和 SSE 的 `/api/rag/query`。

### M4. 所有 routes/*.ts **没有业务层日志**

**规范**：六、日志规则 — 每条链路需要入口 INFO + 出口 INFO/ERROR

**影响文件**（全部）：
- `routes/sessions.ts` — 7 个 CRUD 接口，0 条业务日志
- `routes/documents.ts` — 3 个接口，0 条业务日志
- `routes/agent.ts` — 4 个接口，0 条路由层日志（service 层 agent.ts 有）
- `routes/generator.ts` — 3 个接口，路由层只有 SSE write，没有入口 logger.info
- `routes/chat.ts` — 1 个接口，0 条
- `routes/kb.ts` — 1 个接口，0 条
- `routes/tools.ts` — 3 个接口，0 条

**注意**：service 层（generator/agent、chain/model、db 门面）都已经有完整日志，**只有路由层缺入口/出口日志**。路由层加了之后完整链路就是：http logger → 路由入口 → service（自动 db + llm） → 路由出口/错误。

### M5. `services/rag/index.ts` 的 ragService.search / ingestFromFileWithId 没有日志

**规范**：六、日志规则 — 新增 service 函数入口 INFO + 出口 INFO/ERROR

rag 层的核心 search / ingest 方法是 RAG 主链路，但没有 logger。查 RAG 问题时只能看到 db DEBUG，看不到"检索返回 3 条"还是"检索返回 0 条"。

### M6. `services/embedding.ts` 没有日志

**规范**：同上

embedding 调用是 AI 相关、可能慢、可能失败。应该有 `logger.info('embedding', '开始调用', ...)` 和 `logger.info('embedding', '完成', { costMs })` / `logger.error('embedding', '失败', ...)`。

### M7. `DELETE /api/sessions/:id` 返回 200 + body 不是 204

**规范**：三、RESTful — DELETE 成功应返回 204 No Content

**位置**：`routes/sessions.ts:146`

```typescript
res.json({ success: true })  // 应该是 res.status(204).end()
```

### M8. `DELETE /api/sessions/:id/messages` 返回 200 + body 不是 204

**位置**：`routes/sessions.ts:193`

```typescript
res.json({ success: true, deleted: result.changes })  // 应该是 res.status(204).end()
```

### M9. `DELETE /api/rag/documents/:id` 返回 200 + body 不是 204

**位置**：`routes/rag.ts:168`

```typescript
res.json({ success: true })  // 应该是 res.status(204).end()
```

---

## 🟢 LOW（6 项）

### L1. `GET /api/tools/list` 含多余动词 list

**规范**：三、RESTful — 路径不含动词

当前 `/api/tools/list` → 应该是 `/api/tools`（GET 就表示列表）。

### L2. `POST /api/chat/completions` 含多余动词 completions

**规范**：同上

当前 `/api/chat/completions` → 应该是 `/api/chat`。但这是 OpenAI 兼容路径，改了可能影响前端调用和习惯用法。**可作为例外保留**，或改后加 redirect。

### L3. `GET /api/generator/state/:id` 含多余 state

**规范**：同上

当前 `/api/generator/state/:id` → 应该是 `/api/generator/:id`。state 就是 generator 的状态。

### L4. 有些文件用 `import db from '../db/index.js'` 有些用 `getDb()`

**规范**：代码一致性

routes 里有的 `import { db }` 有的 `import { getDb }`。应该统一一种。

### L5. `GET /api/sessions`（列表）没有分页

**规范**：RESTful — 大集合应支持分页

当前返回全部 sessions，数据量大会有问题。但产品还在早期，可以后补。

### L6. `.env.example` 里 `DB_PATH` 注释掉了但 SQLite 模式下实际在用

**规范**：配置文档一致性

当前 `.env.example` 里 DB_PATH 是注释状态，但 SQLite 模式启动时如果没设就找不到 DB。应该要么注释说明"SQLite 默认 data/knowledge.db"，要么不注释。

---

## ✅ 合规亮点（做得好的地方）

| 方面 | 证据 |
|------|------|
| **DB 门面统一使用** | 全项目唯一 `import Database` 和 `import pg` 都在 `db/index.ts` 和 `db/postgres.ts` 里，业务层全部用 `db.prepare().run/get/all()` |
| **DB 占位符统一 `?`** | 扫完全部业务代码，SQL 都是 `?` 占位符，没有业务层写 `$1, $2` |
| **DB 表名都是裸名** | 业务层 SQL 都是 `FROM sessions`，没有写 `FROM app.sessions`（只有 db/postgres.ts 内部因为直接操作 PG 手动加了 app.） |
| **时间戳统一毫秒** | 全部 `Date.now()` 直接传给 DB，没有自己转 ISO |
| **Zod 覆盖全面** | 除了 H1/M2 两个例外，所有 POST/PATCH/带 :id 的 DELETE 都有 Zod validate |
| **SSE 错误处理** | generator/run、rag/query、agent/run 的 SSE 都有 `try { for await } catch { headersSent 保护 → write error event }` |
| **circuitBreaker headersSent 守卫** | middleware/circuitBreaker.ts 有 `if (res.headersSent) return` |
| **rateLimit 运维白名单** | 包含了 `/api/logs-view`、`/api/metrics`、`/api/health` 等 |
| **Logger 零循环依赖** | services/logger.ts 只依赖 AsyncLocalStorage，db → logger、generator → logger、chain → logger 都安全 |
| **Generator 完整打点** | generator/agent.ts 有 stream/开始、clarify/完成+耗时、retrieve/完成、generate/完成+chunk 数、stream/完成/失败 |
| **LLM 层错误分类** | model.ts 区分 HTTP 错误（调用失败）vs 网络错误（网络异常），分别打不同 ERROR 日志 |
| **typecheck 通过** | `npx tsc --noEmit` 零错误 |

---

## 修复优先级建议

### 第一批（紧急，影响稳定性）

1. **H1** — generator/iterate 加 try-catch
2. **H2** — rag.ts 两处 db.run 加 await
3. **H3** — rag/documents 加业务层日志（入口 + 出口）
4. **H4** — evalRunner console.log 改 logger

### 第二批（代码质量）

5. **M1/M2** — 两个缺 Zod 校验的加 validate
6. **M3** — rag/documents 合并到 documents.ts（或标记为 deprecated）
7. **M4/M5/M6** — 补全路由层和 service 层业务日志（**这是工作量最大的**）
8. **M7/M8/M9** — DELETE 改 204

### 第三批（RESTful 规范对齐）

9. **L1/L2/L3** — 多余动词清理
10. **L4/L5/L6** — 一致性 + 补全功能点
