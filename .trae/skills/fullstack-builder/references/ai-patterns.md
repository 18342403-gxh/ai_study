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

## 4. Prompt Template — 三段式

永远把 LLM 交互拆成三层,不要一个大 prompt:

```
┌─────────────────────────────────────┐
│  System Prompt — 稳定的角色设定       │  写一次,不改
├─────────────────────────────────────┤
│  Context — RAG 检索结果 / Few-Shot   │  每次动态拼接
├─────────────────────────────────────┤
│  User Query — 用户输入               │  原样传递
└─────────────────────────────────────┘
```

**Template**:
```typescript
const SYSTEM_PROMPT = `你是一名专业的 {{ domain }} 助手。
- 始终基于提供的参考资料回答,不要编造
- 回答要结构化,分点列出
- 如果资料中没有答案,直接说"我不知道"`

function buildRagPrompt(system: string, contextDocs: string[], userQuery: string): any[] {
  const contextBlock = contextDocs.map((doc, i) => `[${i+1}] ${doc}`).join('\n\n')
  return [
    { role: 'system', content: system },
    { role: 'user',   content: `
## 参考资料
${contextBlock}

## 用户问题
${userQuery}` },
  ]
}
```

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
