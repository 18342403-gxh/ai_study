# RAG 检索链路重构 — 任务队列

> 对应 spec.md 的验收标准 AC-1 至 AC-6。  
> 每个任务标注涉及文件、具体改动点和测试要求。

## Task 1: 向量与 BM25 并行召回

**AC**: AC-1 | **优先级**: high | **Status**: pending

### 涉及文件

- `apps/server/src/services/rag/index.ts`（L199-201）

### 实现

1. 将 `search` 方法中的串行 await 改为 `Promise.all`：

```ts
// L199-201 当前代码
const vectorTopK = mode === 'bm25' ? [] : await vectorStore.similaritySearch(query, k * 3, docId)
const bm25TopK = mode === 'vector' ? [] : await bm25Search(query, k * 3, docId)

// 改为
const [vectorTopK, bm25TopK] = await Promise.all([
  mode === 'bm25' ? Promise.resolve([]) : vectorStore.similaritySearch(query, k * 3, docId),
  mode === 'vector' ? Promise.resolve([]) : bm25Search(query, k * 3, docId),
])
```

2. 后续 RRF 融合与回填逻辑不变。

### 测试要求

- **rule TR**: 单元测试验证 `search` 调用时两路并发（mock `similaritySearch` 与 `bm25Search`，断言两者被同时调用而非顺序）。
- **rule TR**: 现有 `rag/index.test.ts` 的 hybrid/vector/bm25 模式测试仍通过。

---

## Task 2: rrfFuse 增加分支权重参数

**AC**: AC-1 | **优先级**: high | **Status**: pending

### 涉及文件

- `apps/server/src/services/rag/index.ts`（L69-88 的 `rrfFuse`，L190-262 的 `search`）

### 实现

1. 修改 `rrfFuse` 签名：

```ts
export function rrfFuse(
  vectorRanked: VectorSearchResult[],
  bm25Ranked: BM25Result[],
  k = 60,
  vectorWeight = 1,
  bm25Weight = 1,
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>()
  vectorRanked.forEach((r, rank) => {
    const id = r.doc.id!
    scores.set(id, (scores.get(id) || 0) + vectorWeight / (k + rank + 1))
  })
  bm25Ranked.forEach((r, rank) => {
    scores.set(r.id, (scores.get(r.id) || 0) + bm25Weight / (k + rank + 1))
  })
  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}
```

2. `search` 方法增加 `queryType?: 'keyword' | 'conceptual'` 参数：

```ts
async search(
  query: string,
  k = 5,
  docId?: string,
  mode: 'hybrid' | 'vector' | 'bm25' = 'hybrid',
  queryType?: 'keyword' | 'conceptual',
): Promise<HybridSearchResult[]> {
  // ...
  let vectorWeight = 1
  let bm25Weight = 1
  if (queryType === 'keyword') { vectorWeight = 0.3; bm25Weight = 0.7 }
  else if (queryType === 'conceptual') { vectorWeight = 0.7; bm25Weight = 0.3 }

  fused = rrfFuse(vectorTopK, bm25TopK, 60, vectorWeight, bm25Weight)
}
```

### 测试要求

- **rule TR**: `rrfFuse` 接受非等权参数，同输入不同权重输出排序不同。
- **rule TR**: `search` 传 `keyword` 时 BM25 排名靠前的结果在融合后优先级提升。

---

## Task 3: QueryUnderstanding 增加 queryType

**AC**: AC-1 | **优先级**: high | **Status**: pending

### 涉及文件

- `apps/server/src/services/search/queryUnderstanding.ts`（`QueryUnderstanding` 接口、`ruleBasedUnderstanding`、`buildMessages`、`normalizeLlmUnderstanding`）

### 实现

1. `QueryUnderstanding` 接口增加 `queryType: 'keyword' | 'conceptual'`。

2. `ruleBasedUnderstanding` 中判定：

```ts
const KEYWORD_CUE =
  /\d|[一二三四五六七八九十百千万]|今天|明天|后天|这周|本周|上周|下周|这个月|本月|上个月|上月|大后天|昨日|昨天/
const PROPER_NOUN_CUE = /[""'《》「」『』]/ // 引号/书名号包裹的精确短语
const hasProperNoun = (q: string) => {
  // 粗判：2-4 字连续中文且不含高频虚词
  const segments = q.match(/[\u4e00-\u9fff]{2,4}/g) || []
  return segments.some((s) => !/^[的了是在我有和与及]$/.test(s))
}
const queryType =
  KEYWORD_CUE.test(query) || PROPER_NOUN_CUE.test(query) || hasProperNoun(query)
    ? 'keyword'
    : 'conceptual'
```

3. `buildMessages` 的 system prompt 增加要求输出 `queryType`；`normalizeLlmUnderstanding` 解析该字段，失败回退 `conceptual`。

### 测试要求

- **rule TR**: `ruleBasedUnderstanding('我下周三的日程')` 返回 `queryType='keyword'`。
- **rule TR**: `ruleBasedUnderstanding('什么是闭包')` 返回 `queryType='conceptual'`。
- **rule TR**: `ruleBasedUnderstanding('龚熙皓是谁')` 返回 `queryType='keyword'`（人名线索）。

---

## Task 4: searchAll 传递 queryType 到文档通道

**AC**: AC-1 | **优先级**: high | **Status**: pending

### 依赖

Task 2、Task 3 完成

### 涉及文件

- `apps/server/src/services/search/docChannel.ts`（`searchDocumentsSemantic` 签名）
- `apps/server/src/services/search/searchAll.ts`（L103 调用处）

### 实现

1. `searchDocumentsSemantic` 增加 `queryType` 参数：

```ts
export const searchDocumentsSemantic = async (
  query: string,
  k = 15,
  queryType?: 'keyword' | 'conceptual',
): Promise<DocChannelHit[]> => {
  const results = await createRAGService().search(query, k, undefined, 'hybrid', queryType)
  // ...
}
```

2. `searchAll` 中调用改为：

```ts
searchDocumentsSemantic(options.query, 15, understanding.queryType)
```

### 测试要求

- **rule TR**: `searchAll` 对关键词型查询触发 BM25 偏向权重，对概念型触发向量偏向权重。

---

## Task 5: 主路由走统一向量存储层

**AC**: AC-2 | **优先级**: high | **Status**: pending

### 涉及文件

- `apps/server/src/routes/documents.ts`（`processDocument` L130-214，删除路由，重解析路由）
- `apps/server/src/services/rag/vectorStore.ts`（`addDocuments` 扩展）

### 实现

1. `vectorStore.addDocuments` 扩展接收血缘信息：

```ts
export interface VectorDoc {
  id?: string
  content: string
  metadata?: Record<string, unknown>
  embedding?: number[]
  embeddingType?: 'real' | 'hash'
  embeddingModel?: string
}

async addDocuments(docs: VectorDoc[], docId?: string): Promise<string[]> {
  // 写入 chunks 时包含 embeddingType / embeddingModel
  values.push({
    id, docId, content, chunkIndex: i,
    embedding: JSON.stringify(embedding),
    tokenCount: doc.metadata?.tokenCount as number | undefined,
    embeddingType: doc.embeddingType ?? 'real',
    embeddingModel: doc.embeddingModel ?? 'embedding-3',
    createdAt: now,
  })
}
```

2. `processDocument` 替换写入逻辑：

```ts
// 删除 L145-155 的直接 db.delete + db.insert
const vectorStore = createSqliteVectorStore()
await vectorStore.deleteByDocId(docId) // 同步清理 chunks + chunks_vec

const embeddingMetas = await getEmbeddingsWithMeta(chunks.map((c) => c.content))
await vectorStore.addDocuments(
  chunks.map((chunk, i) => ({
    id: chunk.id ?? randomUUID(),
    content: chunk.content,
    metadata: { docId, chunkIndex: chunk.index, tokenCount: chunk.tokenCount },
    embedding: embeddingMetas[i].vector,
    embeddingType: embeddingMetas[i].type,
    embeddingModel: EMBEDDING_MODEL,
  })),
  docId,
)
```

3. 删除路由 `DELETE /api/documents/:id`：调用 `createSqliteVectorStore().deleteByDocId(id)`。

4. 重解析路由：`processDocument` 内部已先 `deleteByDocId`，自动覆盖。

### 测试要求

- **rule TR**: 启用 `USE_SQLITE_VEC=1` 时，主路由上传后 `chunks_vec` 行数 = `chunks` 行数。
- **rule TR**: 删除文档后 `chunks_vec` 无残留行。
- **rule TR**: 重解析后旧 `chunks_vec` 行被替换。
- **rule TR**: 现有 documents 路由测试仍通过。

---

## Task 6: 新增血缘列与迁移

**AC**: AC-3 | **优先级**: high | **Status**: pending

### 涉及文件

- `apps/server/drizzle/schema.sqlite.ts`（`chunks`、`entryEmbeddings` 表）
- `apps/server/drizzle/schema.ts`（PG 对应表）
- `apps/server/src/db/index.ts`（`alignSqliteSchema` 的 `ensureColumn`）

### 实现

1. `schema.sqlite.ts`：

```ts
// chunks 表新增
embeddingType: text('embedding_type').notNull().default('real'),
embeddingModel: text('embedding_model').notNull().default('embedding-3'),

// entryEmbeddings 表新增
embeddingType: text('embedding_type').notNull().default('real'),
```

2. `schema.ts`（PG）同步新增对应列。

3. `alignSqliteSchema` 中：

```ts
ensureColumn('chunks', 'embedding_type', `embedding_type TEXT NOT NULL DEFAULT 'real'`)
ensureColumn('chunks', 'embedding_model', `embedding_model TEXT NOT NULL DEFAULT 'embedding-3'`)
ensureColumn('entry_embeddings', 'embedding_type', `embedding_type TEXT NOT NULL DEFAULT 'real'`)
```

4. `initSqlite` 中 `CREATE TABLE IF NOT EXISTS chunks` 的 DDL 也需包含新列（新库直接建全量列）。

### 测试要求

- **rule TR**: 新数据库启动后 `chunks` 与 `entry_embeddings` 包含 `embedding_type` 列。
- **rule TR**: 已有数据库（无该列）启动后自动 ALTER，不报错。
- **rule TR**: 已有行 `embedding_type` 默认为 `'real'`。

---

## Task 7: getEmbedding 返回血缘信息

**AC**: AC-3 | **优先级**: high | **Status**: pending

### 涉及文件

- `apps/server/src/services/rag/embeddingGateway.ts`（`getEmbedding`、`getEmbeddings`）
- `apps/server/src/services/rag/embeddings.ts`（re-export）

### 实现

1. 新增类型与函数：

```ts
export interface EmbeddingWithMeta {
  vector: number[]
  type: 'real' | 'hash'
}

export const getEmbeddingWithMeta = async (text: string): Promise<EmbeddingWithMeta> => {
  const { forceMock, disableFallback, ... } = getEnv()
  if (forceMock) return { vector: hashVector(text), type: 'hash' }
  // TTL mock 路径
  if (mockUntil > 0 && Date.now() < mockUntil) return { vector: hashVector(text), type: 'hash' }
  try {
    // ... API 调用 ...
    return { vector: data.data[0].embedding, type: 'real' }
  } catch (err) {
    if (disableFallback) throw err
    mockUntil = Date.now() + MOCK_TTL_MS
    return { vector: hashVector(text), type: 'hash' }
  }
}
```

2. `getEmbedding` 委托：`return (await getEmbeddingWithMeta(text)).vector`。

3. `getEmbeddingsWithMeta`：worker pool 中调用 `getEmbeddingWithMeta`，返回 `EmbeddingWithMeta[]`，顺序与输入一致。

4. `embeddings.ts` re-export 新函数。

### 测试要求

- **rule TR**: `getEmbeddingWithMeta` 真实 API 返回 `type='real'`，mock 返回 `type='hash'`。
- **rule TR**: `getEmbeddingsWithMeta` 结果顺序与输入一致。
- **rule TR**: 现有 `getEmbedding`/`getEmbeddings` 调用方不受影响。

---

## Task 8: 写入血缘到 chunks 与 entry_embeddings

**AC**: AC-3 | **优先级**: high | **Status**: pending

### 依赖

Task 5、Task 6、Task 7

### 涉及文件

- `apps/server/src/services/rag/vectorStore.ts`（`addDocuments` 写入 `embeddingType`/`embeddingModel`）
- `apps/server/src/services/search/entryIndex.ts`（`syncEntryEmbedding` 写入 `embeddingType`）

### 实现

1. `vectorStore.addDocuments`：写入 `embeddingType` 与 `embeddingModel`（Task 5 已扩展 `VectorDoc`，此处落库）。

2. `entryIndex.syncEntryEmbedding`：

```ts
const meta = await getEmbeddingWithMeta(entryEmbeddingText(title, content))
await db.insert(tables.entryEmbeddings).values({
  entryId,
  embedding: JSON.stringify(meta.vector),
  model: EMBEDDING_MODEL,
  embeddingType: meta.type,
  updatedAt: new Date(),
})
```

### 测试要求

- **rule TR**: mock 模式写入的 chunks `embedding_type='hash'`，真实模式为 `'real'`。
- **rule TR**: 条目向量同理。

---

## Task 9: API 恢复后的增量重嵌

**AC**: AC-3 | **优先级**: medium | **Status**: pending

### 依赖

Task 7、Task 8

### 涉及文件

- `apps/server/src/services/rag/embeddingGateway.ts`（`probeRealEmbedding` 成功后触发）
- 新增 `apps/server/src/services/rag/reembed.ts`（重嵌任务）

### 实现

1. 新增 `reembed.ts`：

```ts
let reembeddingInProgress = false

export const reembedHashVectors = async () => {
  if (reembeddingInProgress) return
  reembeddingInProgress = true
  try {
    const db = getDb()
    const vectorStore = createSqliteVectorStore()

    // chunks
    const hashChunks = await db
      .select()
      .from(tables.chunks)
      .where(eq(tables.chunks.embeddingType, 'hash'))
    const byDoc = new Map<string, typeof hashChunks>()
    for (const c of hashChunks) {
      const list = byDoc.get(c.docId) ?? []
      list.push(c)
      byDoc.set(c.docId, list)
    }
    for (const [docId, chunks] of byDoc) {
      try {
        const metas = await getEmbeddingsWithMeta(chunks.map((c) => c.content))
        for (let i = 0; i < chunks.length; i++) {
          await db
            .update(tables.chunks)
            .set({
              embedding: JSON.stringify(metas[i].vector),
              embeddingType: metas[i].type,
              embeddingModel: EMBEDDING_MODEL,
            })
            .where(eq(tables.chunks.id, chunks[i].id))
        }
        // 同步更新 chunks_vec
        if (isVecExtensionLoaded()) {
          /* 重新写入 chunks_vec */
        }
      } catch {
        /* 单文档失败不阻塞 */
      }
    }

    // entry_embeddings 同理
  } finally {
    reembeddingInProgress = false
  }
}
```

2. `probeRealEmbedding` 成功时调用：`void reembedHashVectors()`。

3. 新增 `GET /api/embedding/reembed-status` 接口返回 `{ pending: number, inProgress: boolean }`，供前端轮询。

### 测试要求

- **rule TR**: `probeRealEmbedding` 成功后 hash 行被更新为 real。
- **rule TR**: 并发多次恢复事件只触发一次重嵌。
- **rule TR**: 单文档重嵌失败不影响其他文档。

---

## Task 10: 前端降级提示条

**AC**: AC-4 | **优先级**: high | **Status**: pending

### 涉及文件

- `apps/generator/pages/chat.vue`（`askAI` 响应处理、模板）

### 实现

1. 增加响应式状态：

```ts
const embeddingMock = ref(false)
const reembeddingInProgress = ref(false)
```

2. `askAI` 响应中：

```ts
embeddingMock.value = result.embeddingMock ?? false
// 写入消息 metadata
```

3. 模板中消息列表上方添加提示条：

```vue
<div v-if="embeddingMock" class="degradation-banner">
  ⚠️ 语义检索降级中：当前上传的资料可能只被关键词检索到，语义搜索暂不可用。Embedding 服务恢复后将自动重建索引。
</div>
<div v-else-if="reembeddingInProgress" class="reembed-banner">
  🔄 部分资料正在重新建立语义索引…
</div>
```

4. 轮询重嵌状态：`embeddingMock` 从 true → false 时，开始每 5 秒调用 `GET /api/embedding/reembed-status`，`pending=0` 时停止并隐藏提示。

### 测试要求

- **rule TR**: `embeddingMock=true` 时对话页出现降级提示条。
- **rule TR**: `embeddingMock=false` 时提示条隐藏。
- **rubric TR**: 提示文案包含"语义搜索暂不可用"。

---

## Task 11: 中文 BM25 字段权重

**AC**: AC-5 | **优先级**: medium | **Status**: pending

### 涉及文件

- `apps/server/src/services/rag/bm25.ts`（`bm25Rank`、`BM25TextDoc`）
- `apps/server/src/services/search/entrySearch.ts`（条目 BM25 调用）

### 实现

1. `bm25.ts` 扩展：

```ts
export interface BM25TextField {
  text: string
  boost: number
}
export interface BM25TextDoc {
  id: string
  text: string
  fields?: BM25TextField[]
}

export function bm25Rank(query, docs, k = 5) {
  // 当 fields 存在时，对每个字段独立计算 tf/idf，按 boost 加权求和
  // 当 fields 不存在时，用 text 单字段（现有逻辑）
}
```

2. `entrySearch.ts`：

```ts
bm25Rank(
  options.query,
  rows.map((r) => ({
    id: r.id,
    text: '',
    fields: [
      { text: r.title, boost: 3.0 },
      { text: r.content, boost: 1.0 },
    ],
  })),
  k * 3,
)
```

3. `docChannel.ts` 动态阈值：

```ts
const queryTokenCount = tokenize(query).length
const minBm25 = 0.5 * Math.sqrt(Math.max(1, queryTokenCount))
if (bm25 < minBm25 && (mock || cosine < MIN_COSINE)) return []
```

### 测试要求

- **rule TR**: `bm25Rank` 支持 `fields`，标题 boost=3.0 时标题命中排序高于正文命中。
- **rule TR**: 长查询（>10 tokens）的 BM25 阈值随长度缩放，不再全部丢弃。
- **rule TR**: 现有单字段 `bm25Rank` 调用不受影响。

---

## Task 12: 可观测性与日志

**AC**: AC-3, AC-4 | **优先级**: low | **Status**: pending

### 涉及文件

- `apps/server/src/services/rag/index.ts`（`search` 日志）
- `apps/server/src/services/search/searchAll.ts`（检索日志）

### 实现

1. `search` 日志增加 `queryType`、`vectorWeight`、`bm25Weight`。
2. `searchAll` 日志增加 `understanding.queryType`。
3. 重嵌任务日志记录进度（已重嵌/总数）。

### 测试要求

- **rule TR**: 检索日志包含 `queryType` 字段。

---

## 依赖关系

```
Task 1 (并行召回)
Task 2 (rrfFuse 权重) ─┐
Task 3 (queryType) ────┼─→ Task 4 (传递 queryType)
                       │
Task 5 (统一存储层) ─→ Task 6 (血缘列) ─→ Task 7 (血缘返回) ─→ Task 8 (写入血缘) ─→ Task 9 (增量重嵌)
Task 11 (BM25 权重)
Task 10 (前端提示) ──── 依赖 Task 9 的重嵌状态接口
Task 12 (日志)
```

## 实施顺序

1. **第一波（正确性阻断）**：Task 5 → Task 6 → Task 7 → Task 8 → Task 9  
   修双写一致性和血缘，否则 sqlite-vec 持续漏召回。
2. **第二波（检索质量）**：Task 1 → Task 2 → Task 3 → Task 4 → Task 11  
   并行召回 + 自适应权重 + BM25 字段权重。
3. **第三波（用户感知）**：Task 10 → Task 12  
   降级可见性与可观测性。

## 验证清单

- [ ] 后端 `pnpm typecheck` 通过
- [ ] 后端 `pnpm test` 全量通过
- [ ] 前端 `pnpm typecheck` 通过
- [ ] 启用 `USE_SQLITE_VEC=1` 后主路由文档可被 chunks_vec 召回
- [ ] mock 降级期间上传的块 `embedding_type='hash'`
- [ ] API 恢复后 hash 块被重嵌为 `real`
- [ ] 前端 `embeddingMock=true` 时显示降级提示
- [ ] 关键词型查询 BM25 权重 0.7，概念型 0.3
