# Backend Patterns — Battle-Tested Templates

Copy-paste starting points for common backend patterns. Language: TypeScript + Express. Adapt to Fastify/Hono/FastAPI/Gin — the shapes are the same.

---

## 1. Route + Zod Validation Handler

Every route handler follows this shape. Never mix validation and business logic.

```typescript
// routes/chat.ts
import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { asyncHandler } from '../middleware/asyncHandler.js'

const router = Router()

// ① Zod schema — define the contract once
const chatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1).max(100000),
  })),
  model: z.string().optional(),
  stream: z.boolean().default(false),
})

// ② Route with validate() middleware → typed req.body
router.post(
  '/completions',
  validate({ body: chatRequestSchema }),
  asyncHandler(async (req, res) => {
    const { messages, model, stream } = req.body as z.infer<typeof chatRequestSchema>
    // ③ Business logic here — input is guaranteed valid
    const result = await someService(messages, model)
    res.json({ ok: true, data: result })
  }),
)

export default router
```

**Rules**:
- Schema lives above the route, not inside the handler
- `asyncHandler` wraps every async route so errors bubble to the error middleware
- Return `{ ok: true, data: ... }` for success, `{ ok: false, error: "..." }` for failure

---

## 2. DB Facade — Single Async API Over Multiple Drivers

If you support SQLite + Postgres, expose one interface. Callers never know which driver is active.

```typescript
// db/index.ts
interface AsyncPrepared {
  run(...params: unknown[]): Promise<{ changes: number; lastInsertRowid: bigint | number | null }>
  get<T = unknown>(...params: unknown[]): Promise<T | undefined>
  all<T = unknown>(...params: unknown[]): Promise<T[]>
}
interface AsyncDb { prepare(sql: string): AsyncPrepared; exec(sql: string): Promise<unknown> }

// getDb() returns AsyncDb — callers don't know SQLite from Postgres
export const getDb = (): AsyncDb => { /* wraps either SQLite or PG client */ }
```

**Caller code** (same regardless of driver):
```typescript
const db = getDb()
await db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(userId, name)
const user = await db.prepare('SELECT * FROM users WHERE id = ?').get<{ id: string; name: string }>(userId)
const rows = await db.prepare('SELECT * FROM users').all<{ id: string; name: string }>()
```

**Driver adaptation happens in the wrapper** (not in caller):
- SQLite: `?` placeholders, INTEGER timestamps, no schema prefix
- Postgres: `?` → `$1, $2`, INTEGER → TIMESTAMPTZ conversion, `app.` schema prefix injection

---

## 3. Cost Tracker — EventEmitter + Non-Blocking Write

Every LLM/Embedding call logs usage. Write is fire-and-forget — never await in the hot path.

```typescript
// services/costTracker.ts
import { EventEmitter } from 'node:events'

interface UsageInfo {
  feature: 'chat' | 'rag' | 'generator' | 'embedding'
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costMs?: number
  metadata?: Record<string, unknown>
}

class CostTracker extends EventEmitter {
  track(info: UsageInfo) { this.emit('usage', info) }
}
export const costTracker = new CostTracker()

// Listen once, write async
costTracker.on('usage', async (info: UsageInfo) => {
  try {
    const db = getDb()
    await db.prepare(`
      INSERT INTO ai_usage_logs (feature, model, prompt_tokens, completion_tokens, total_tokens, cost_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(info.feature, info.model, info.promptTokens, info.completionTokens,
           info.totalTokens, info.costMs ?? 0, Date.now())
  } catch {
    // Log write failure — don't crash the main flow
    logger.warn('cost-tracker', 'usage write failed', { error: (err as Error).message })
  }
})
```

**Inject into LLM call**:
```typescript
// After model.invoke() returns with usage data:
costTracker.track({
  feature: 'generator',   // or 'chat', 'rag', 'embedding'
  model: modelName,
  promptTokens: usage.prompt_tokens,
  completionTokens: usage.completion_tokens,
  totalTokens: usage.total_tokens,
  costMs: Date.now() - t0,
})
```

---

## 4. Structured Logger

Never `console.log`. Use a leveled logger with request IDs.

```typescript
// services/logger.ts
type LogRecord = {
  level: 'debug' | 'info' | 'warn' | 'error'
  tag: string           // which service emitted this
  requestId?: string     // trace a single user's path through the system
  message: string
  data?: Record<string, unknown>
  timestamp: number
}

export const logger = {
  debug: (tag: string, message: string, data?) => emit({ level: 'debug', tag, message, data }),
  info:  (tag: string, message: string, data?) => emit({ level: 'info',  tag, message, data }),
  warn:  (tag: string, message: string, data?) => emit({ level: 'warn',  tag, message, data }),
  error: (tag: string, message: string, data?) => emit({ level: 'error', tag, message, data }),
}
```

**Usage in route handlers**:
```typescript
logger.info('chat.route', 'POST /completions — entry', { stream, msgCount: messages.length })
logger.info('chat.route', 'POST /completions — exit',   { costMs: Date.now() - t0, totalTokens: usage.total_tokens })
logger.error('chat.route', 'POST /completions — fail',  { error: err.message, costMs: Date.now() - t0 })
```

---

## 5. Middleware Pipeline

Express middleware in order — this exact sequence works for 95% of apps:

```
cors → body parser (limit 10mb) → rate-limit → request logger (with requestId) →
  → routes → not found handler → error handler
```

**Error handler must come last** and have the signature `(err, req, res, next)`.

---

## 6. Health Check

Single endpoint, always available, reports real dependency status:

```
GET /health → {
  status: "ok",
  uptime: 3600.5,
  db: "ok",          // probe your DB connection
  llm: "ok",         // optional — hit a cheap LLM endpoint
  embedding: "ok"    // optional — same
}
```

This is also how your desktop wrapper (Electron/Tauri) waits for the BFF to be ready before creating the window.
