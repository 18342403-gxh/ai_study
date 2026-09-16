# AI Patterns — LLM, RAG, Embedding

Language-agnostic patterns for working with AI APIs. Code examples in TypeScript.

---

## 1. Embedding Fallback — Hash Vectors

When your Embedding API is down (429, network error, expired credits), don't crash. Generate deterministic pseudo-vectors locally.

**Principle**:
- Same text → identical vector (幂等, 可缓存)
- Different text → random directions (cosine ≈ 0, 检索精度下降但系统不崩)
- 纯本地, 零网络, <1ms

```typescript
// services/embedding.ts — hashVector
import crypto from 'node:crypto'

export function hashVector(text: string, dim = 1536): number[] {
  // ① SHA-256(text) → 32 bytes → 8 个 32-bit seeds
  const hash = crypto.createHash('sha256').update(text).digest('hex')
  const seeds: number[] = []
  for (let i = 0; i < hash.length; i += 8) seeds.push(parseInt(hash.slice(i, i + 8), 16))

  // ② Mulberry32 PRNG — deterministic pseudo-random
  let seedIdx = 0
  const rand = () => {
    let a = seeds[seedIdx++ % seeds.length] >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }()

  // ③ Box-Muller → 正态分布 → 比均匀分布更像真实 Embedding
  const vec: number[] = []
  for (let i = 0; i < dim; i += 2) {
    const u1 = rand() || 1e-10, u2 = rand()
    const r = Math.sqrt(-2 * Math.log(u1))
    const theta = 2 * Math.PI * u2
    vec.push(r * Math.cos(theta))
    if (i + 1 < dim) vec.push(r * Math.sin(theta))
  }

  // ④ L2 归一化 → 向量长度 = 1.0
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < vec.length; i++) vec[i] /= norm
  return vec
}
```

**用法**:
```typescript
export async function getEmbedding(text: string): Promise<number[]> {
  // 强制 mock 模式
  if (process.env.ENABLE_MOCK_EMBEDDING === '1') return hashVector(text)

  try {
    const res = await fetch(`${API_URL}/embeddings`, { /* ... */ })
    return res.data[0].embedding
  } catch (err) {
    if (process.env.DISABLE_EMBEDDING_FALLBACK === '1') throw err
    // 降级 — 记一笔 total_tokens=0 + metadata.mock=true
    costTracker.track({ feature: 'embedding', model, promptTokens: 0, completionTokens: 0, totalTokens: 0, metadata: { mock: true } })
    return hashVector(text)
  }
}
```

**Controlled by env vars**:
- `ENABLE_MOCK_EMBEDDING=1` — 强制 mock (开发调试)
- `DISABLE_EMBEDDING_FALLBACK=1` — API 失败直接 throw (生产严格模式)

---

## 2. Cosine Similarity

```typescript
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom ? dot / denom : 0
}
```

**PG 版本** (pgvector): `SELECT * FROM chunks ORDER BY embedding <=> $1::vector LIMIT 5`

---

## 3. SSE Streaming — Server-Sent Events

Non-streaming response has `usage` in the body. Streaming has `usage` in the **last chunk**. Don't miss it.

```typescript
async *stream(messages): AsyncGenerator<string> {
  const res = await fetch(`${API_URL}/chat/completions`, {
    method: 'POST', body: JSON.stringify({ model, messages, stream: true }),
  })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lastUsage: any = null

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      if (trimmed === 'data: [DONE]') break

      const json = JSON.parse(trimmed.slice(6))
      if (json.usage) lastUsage = json.usage          // ← capture usage from last chunk
      const delta = json.choices?.[0]?.delta?.content
      if (delta) yield delta
    }
  }

  // 流结束后 — 这里才是 stream 的 usage
  if (lastUsage) costTracker.track({ feature, model, promptTokens: lastUsage.prompt_tokens, ... })
}
```

---

## 4. Prompt Design Specification

**不要在 Skill 里硬编码具体 prompt 内容。** 每个项目的领域、风格、输出要求都不同。Skill 负责告诉 AI **prompt 应该怎么设计**，然后在 Phase 3 按规范为当前项目生成。

### 0. 上下文：默认技术栈 + Node.js 方向

本 Skill 默认技术栈是 **TypeScript + Node.js + Express + Vue + SQLite + Monorepo**。在为新项目生成 Prompt 时，遵循以下约束以获得更高质量的输出：

**System Prompt 里必须体现的技术约束**：
```
- 语言: TypeScript (strict mode)
- 后端框架: Express 5 (或 Fastify/Hono，视 techStack.backend)
- 数据库: SQLite (better-sqlite3)，需要时可切 PostgreSQL
- 状态管理: 统一 AsyncDb facade (prepare().run/get/all)
- 错误处理: express-async-errors + asyncHandler 包装
- 输入校验: Zod (body/query/params 各一个 schema)
- 日志: 结构化 logger，禁止 console.log
- AI 调用: Node.js SDK (LangChain.js / 原生 fetch OpenAI-compatible API)
- 流式输出: SSE (res.write + res.flush + done)
- Token 追踪: costTracker EventEmitter 注入
- Embedding: 优先 API 调用，API 不可用时 hashVector 降级
- 前端: Vue 3 Composition API + Pinia + Vite
- 代码风格: 2 空格缩进，单引号，无分号
```

**为什么要这样约束？**
- 没有技术约束的 prompt 会产出"空泛的正确答案" — 比如"创建一个 REST API"但不说用 Express 还是 FastAPI、用 Zod 还是 Joi
- 明确技术约束后，LLM 可以**调用它训练数据里的具体实现**，产出的代码直接可运行
- 所有这些约束都来自 references/ 里经过验证的模式，不是随便选的

**例外**：如果 state.json 里 `techStack.backend` 不是 Node.js（比如 `fastapi` 或 `gin`），把上面的 Node.js 约束替换成对应语言的等价约束。但**绝大多数项目不需要改**。

---

### 4a. 结构规则 — 三层式

所有 LLM 交互必须拆成三层,永远不要一个大 prompt:

```
┌─────────────────────────────────────┐
│ ① System Prompt — 稳定、不变、写一次  │  角色 + 领域约束 + 输出格式要求
├─────────────────────────────────────┤
│ ② Context — 动态变化层              │  RAG 检索结果 / Few-Shot 示例 / 当前会话历史
├─────────────────────────────────────┤
│ ③ User Query — 原样传递             │  用户输入,不做清洗或重写
└─────────────────────────────────────┘
```

**规则**:
- ① 和 ② 永远分开 — 把 RAG context 拼进 system prompt 会污染角色设定
- ② 每次构建时都要检查 token 预算,超出就截断或摘要
- ③ 原样传 — 不要在服务端改写用户 query(会丢失用户意图细节)

### 4b. System Prompt 必须包含什么

按优先级从上到下排列(LLM 对靠前的指令权重更高):

```
[角色设定]  → 你是谁,在什么领域,擅长什么
[硬约束]    → 必须遵守的规则(不要编造 / 必须分点 / 必须引用来源)
[输出格式]  → JSON schema / Markdown 结构 / 代码风格
[风格偏好]  → 简洁 / 详细 / 正式 / 口语(可选)
[边界条件]  → 什么情况下应该拒绝回答(可选)
```

**强制检查**: System prompt 里必须有至少一条硬约束禁止编造。

### 4c. Context 层怎么构建

| Context 来源 | 构建方式 | Token 预算 |
|-------------|---------|-----------|
| RAG 检索结果 | Top-K 拼接,加编号 `[1] [2]` 引用标记 | 不超过 prompt 总预算的 60% |
| Few-Shot 示例 | 2-3 个正反例,格式: `输入→期望输出` | 不超过 20% |
| 历史对话 | 最近 N 轮完整保留,更早的做摘要 | 不超过 20% |

**Token 预算公式**:
```
system_prompt(15%) + context(60%) + user_query(25%) = 100%
```
超出 → 优先截断更早的历史,然后减少 context K 值,最后摘要 system prompt 里的次要内容。

### 4d. 输出格式约束

**如果需要结构化输出**(JSON / Schema),必须有一层强制解析:

```
LLM 输出 → JSON.parse() → 用 Zod / JSON Schema 校验 → 校验失败? 重试 1 次 + "上次输出不是合法 JSON,请修正"
```

不要假设 LLM 永远输出合法 JSON。它会偶尔输出 `...```json\n{...}\n```...` 或 trailing commas。

### 4e. Prompt Anti-Patterns

| ❌ 反模式 | ✅ 替代 |
|---------|--------|
| 一个 2000 token 的大 prompt 塞所有东西 | 三层分离 + 动态拼接 + token 预算 |
| 没有角色设定直接让 LLM 做事 | 开头写清楚角色 + 领域 + 约束 |
| 不禁止编造 | "如果资料中没有答案,直接说'我不知道',不要编造" |
| context 超过 token 预算硬塞进去 | 截断 K 值 / 摘要 / 拒绝并提示用户缩小范围 |
| 不校验 JSON 输出 | JSON.parse + Zod schema 校验 + 失败重试 1 次 |
| 每次都写新 prompt 不做版本管理 | Prompt 也是代码,改了要能回溯。至少记录 "为什么改、改了什么、效果对比" |
| 把敏感信息硬编码进 prompt | API key、DB password 永远在 env var,prompt 里写占位符 |

### 4f. Prompt 生成 Checklist(Phase 3 每个模块完成前过一遍)

- [ ] System prompt 有明确角色设定
- [ ] 有至少一条硬约束禁止编造 / 幻觉
- [ ] Context 层 token 用量在预算内
- [ ] 输出有格式要求(JSON schema / Markdown 结构)
- [ ] 如果用 RAG: context 里的每条资料加了 `[编号]` 引用标记
- [ ] Token 超限策略明确(截断 / 摘要 / 拒绝)
- [ ] 错误路径:LLM 输出格式不对会发生什么(有重试吗?)
- [ ] Prompt 版本可追溯(commit message 或 changelog)

---

## 5. RAG Pipeline — 4 Steps

```
Raw Documents
    ↓ ① Splitter (chunk by paragraph / 800 chars overlap 100)
Chunks
    ↓ ② Embedding (API or hash fallback)
Vectors (stored in SQLite/PG/pinecone)
    ↓ ③ Query: user input → embedding → cosine top-K
Relevant chunks
    ↓ ④ Assemble prompt + LLM answer + cite source
Cited Answer
```

**Chunk size heuristic**:
- 200-500 chars: code snippets, short docs → precise but high noise
- 600-1000 chars: general docs, articles → balanced (default)
- 1500-2000 chars: long-form, chapters → fewer chunks but more context per hit
