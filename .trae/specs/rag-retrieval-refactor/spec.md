# RAG 检索链路重构规格

> 日期：2026-11-16  
> 范围：后端（apps/server）+ 前端（apps/generator）  
> 依据：代码现状通读 + 用户对检索链路结构性缺陷的分析

## 1. 问题定义

当前知识库的"AI 能力弱"感知，根源不在生成模型，而在检索链路的四个结构性缺陷：

1. **文档通道内向量与 BM25 串行 await，且 RRF 无权重**：`createRAGService().search` 先 `await vectorStore.similaritySearch` 再 `await bm25Search`（`apps/server/src/services/rag/index.ts` L200-201），延迟相加而非取最大值；两路等权进入 `rrfFuse`（L69-88），关键词型与概念型查询共用同一融合策略。
2. **主上传路由直接写 `chunks`，未同步 `chunks_vec`**：`processDocument`（`apps/server/src/routes/documents.ts` L145-155）直接 `db.delete` + `db.insert(tables.chunks)`，绕过 `vectorStore.addDocuments`。启用 sqlite-vec 后主路由文档静默漏召回；删除路由（L360 附近）和重解析也不清理 `chunks_vec`，产生幽灵向量。
3. **hash 降级向量静默毒化语义索引，且无向量血缘**：`chunks.embedding` 不区分真实/hash；API 恢复后旧 hash 向量不会重算；`embeddingMock` 在 `POST /api/chat` 响应中返回（`chat.ts` L169）但 `chat.vue` 完全未消费。
4. **中文 BM25 2-gram 等权，无字段权重**：`bm25Rank`（`bm25.ts` L106-163）只对单字段文本打分；条目检索（`entrySearch.ts`）把 `title + "\n" + content` 拼成单字符串，标题与正文同权；`docChannel` 用绝对 `MIN_COSINE=0.35` 与 `bm25<=0` 过滤，长查询时阈值形同虚设。

## 2. 目标

1. 文档通道内向量与 BM25 并行召回（`Promise.all`），RRF 按查询类型自适应分支权重。
2. 主路由、重解析、删除全部走统一向量存储层，保证 `chunks` 与 `chunks_vec` 强一致。
3. 每个块/条目记录向量血缘（`embedding_type: real | hash`、`embedding_model`），hash 向量可被识别并在 API 恢复后增量重嵌。
4. `embeddingMock` 状态对用户可见，降级期间给出明确提示，恢复后触发重嵌并提示进度。
5. 中文 BM25 支持字段级 boost（标题 3.0 / 正文 1.0），`min_score` 按查询 token 数缩放。

## 3. 非目标

- **不更换 Embedding 模型**：`embedding-3`（1536 维）保持不变。
- 不引入新的第三方检索依赖（jieba、rank-bm25 等）；BM25 仍用现有纯 TS 实现。
- 不重构分片器 `splitStructured`。
- 不改动时间通道逻辑。

## 4. 功能需求

### FR-1 文档通道并行召回与自适应 RRF

**4.1.1 并行召回**

`createRAGService().search` 中将两段串行 `await` 改为 `Promise.all`：

```ts
// before
const vectorTopK = mode === 'bm25' ? [] : await vectorStore.similaritySearch(query, k * 3, docId)
const bm25TopK = mode === 'vector' ? [] : await bm25Search(query, k * 3, docId)

// after
const [vectorTopK, bm25TopK] = await Promise.all([
  mode === 'bm25' ? Promise.resolve([]) : vectorStore.similaritySearch(query, k * 3, docId),
  mode === 'vector' ? Promise.resolve([]) : bm25Search(query, k * 3, docId),
])
```

**4.1.2 RRF 分支权重**

`rrfFuse` 签名扩展为：

```ts
export function rrfFuse(
  vectorRanked: VectorSearchResult[],
  bm25Ranked: BM25Result[],
  k = 60,
  vectorWeight = 1,
  bm25Weight = 1,
): Array<{ id: string; score: number }>
```

融合公式：`score += weight / (k + rank + 1)`。rank-constant `k=60` 不变。

**4.1.3 查询类型判别**

`QueryUnderstanding` 增加 `queryType: 'keyword' | 'conceptual'`：

- `keyword` 判定规则（满足任一）：
  - 含阿拉伯数字或中文数字（一、二、...、十、百）；
  - 含时间词（今天、明天、下周、上个月等）；
  - 含明确人名/地名/产品名等专有名词线索（可通过正则粗判，如 2-4 字连续中文且非虚词）；
  - 含引号或书名号包裹的精确短语。
- `conceptual`：其余情况。
- `ruleBasedUnderstanding` 直接输出该字段；LLM 路径在 prompt 中要求输出 `queryType`，解析失败时回退 `conceptual`。

**4.1.4 权重映射**

`search` 方法接收 `queryType` 参数：

- `keyword` → `vectorWeight=0.3, bm25Weight=0.7`
- `conceptual` → `vectorWeight=0.7, bm25Weight=0.3`
- 未传 → 等权（1.0/1.0），保持向后兼容。

`searchDocumentsSemantic(query, k, queryType?)` 将 `queryType` 透传给 `search`；`searchAll` 从 `understanding.queryType` 取值传入。

### FR-2 主路由与 chunks_vec 双写一致性

**4.2.1 processDocument 走统一存储层**

`processDocument` 中替换直接 Drizzle 写入：

```ts
// before
await db.delete(tables.chunks).where(eq(tables.chunks.docId, docId))
await db.insert(tables.chunks).values(chunks.map(...))

// after
const vectorStore = createSqliteVectorStore()
await vectorStore.deleteByDocId(docId)  // 同步清理 chunks_vec
await vectorStore.addDocuments(
  chunks.map((chunk, i) => ({
    id: chunk.id ?? randomUUID(),
    content: chunk.content,
    metadata: { docId, chunkIndex: chunk.index, tokenCount: chunk.tokenCount },
    embedding: embeddings[i],
    embeddingType: embeddingTypes[i],  // 'real' | 'hash'
    embeddingModel: EMBEDDING_MODEL,
  })),
  docId,
)
```

`vectorStore.addDocuments` 需扩展以接收 `embeddingType`/`embeddingModel` 并写入对应列。

**4.2.2 删除与重解析同步清理**

- `DELETE /api/documents/:id`：调用 `vectorStore.deleteByDocId(id)`，不再直接 `db.delete`。
- `POST /:id/reprocess`：`processDocument` 内部已先 `deleteByDocId`，自动覆盖。

**4.2.3 补写 tokenCount**

主路由写入时设置 `tokenCount: chunk.tokenCount`（`splitStructured` 已在内存中生成该字段，当前未落库）。

### FR-3 向量血缘与增量重嵌

**4.3.1 新增列**

`chunks` 表：

- `embedding_type TEXT NOT NULL DEFAULT 'real'`
- `embedding_model TEXT NOT NULL DEFAULT 'embedding-3'`

`entry_embeddings` 表：

- `embedding_type TEXT NOT NULL DEFAULT 'real'`

双方言 schema（`schema.sqlite.ts`、`schema.ts`）同步新增。SQLite 通过 `alignSqliteSchema` 的 `ensureColumn` 幂等添加。

**4.3.2 getEmbedding 返回血缘**

`embeddingGateway.ts` 新增：

```ts
export interface EmbeddingWithMeta {
  vector: number[]
  type: 'real' | 'hash'
}

export const getEmbeddingWithMeta = async (text: string): Promise<EmbeddingWithMeta> => {
  // 在 forceMock / TTL mock / API 失败路径返回 { vector: hashVector(text), type: 'hash' }
  // 在 API 成功路径返回 { vector: data.data[0].embedding, type: 'real' }
}
```

`getEmbedding` 保持原签名，内部委托 `getEmbeddingWithMeta(text).then(r => r.vector)`。`getEmbeddings` 同理新增 `getEmbeddingsWithMeta`，返回 `EmbeddingWithMeta[]`，保证顺序一致。

**4.3.3 写入血缘**

- `vectorStore.addDocuments`：写入 `embeddingType`（从传入 metadata 或 `getEmbeddingsWithMeta` 的结果）与 `embeddingModel`。
- `entryIndex.syncEntryEmbedding`：写入 `embeddingType`。
- `processDocument`：使用 `getEmbeddingsWithMeta` 获取每块的 `type`，传入 `addDocuments`。

**4.3.4 增量重嵌**

在 `probeRealEmbedding` 成功（`mockUntil` 清零）时触发后台任务：

```ts
async function reembedHashVectors() {
  if (reembeddingInProgress) return
  reembeddingInProgress = true
  try {
    // 1. 扫描 chunks WHERE embedding_type='hash'
    // 2. 按 docId 分组，每批 ≤ EMBEDDING_CONCURRENCY 个块
    // 3. 调用 getEmbeddingsWithMeta 重嵌
    // 4. 更新 chunks SET embedding=?, embedding_type='real', embedding_model=?
    // 5. 同步更新 chunks_vec（若启用）
    // 6. 对 entry_embeddings 重复同样流程
  } finally {
    reembeddingInProgress = false
  }
}
```

- 单文档重嵌失败保持 `hash`，不阻塞其他文档；
- `reembeddingInProgress` 全局标志防并发；
- 重嵌进度记录日志，前端可通过新增接口或 `GET /api/cost/settings` 扩展查询。

### FR-4 降级状态前端可感知

**4.4.1 对话页降级提示条**

`chat.vue` 在 `askAI` 响应中读取 `embeddingMock`：

```ts
const embeddingMock = ref(false)
// 在响应处理中
embeddingMock.value = result.embeddingMock ?? false
```

对话页顶部（消息列表上方）展示提示条：

- `embeddingMock === true`：
  > ⚠️ 语义检索降级中：当前上传的资料可能只被关键词检索到，语义搜索暂不可用。Embedding 服务恢复后将自动重建索引。
- `embeddingMock === false`：隐藏。

**4.4.2 重嵌进度提示**

当 `embeddingMock` 从 `true` → `false` 时，若后端返回存在 hash 向量待重嵌，展示：

> 🔄 部分资料正在重新建立语义索引…

通过轮询（每 5 秒）后端接口获取重嵌进度，完成后隐藏。

**4.4.3 历史消息恢复**

`embeddingMock` 写入 assistant 消息的 `metadata`，历史会话加载时可恢复降级状态展示。

### FR-5 中文 BM25 字段权重与动态阈值

**4.5.1 多字段 BM25**

`bm25Rank` 扩展支持字段级 boost：

```ts
export interface BM25TextField {
  text: string
  boost: number // 默认 1.0
}

export interface BM25TextDoc {
  id: string
  text: string // 向后兼容：单字段
  fields?: BM25TextField[] // 新：多字段
}
```

当 `fields` 存在时，对每个字段独立计算 BM25 子分，按 boost 加权求和：

```
score(doc) = Σ_fields[ boost_f * Σ_qt IDF(qt) * tf_norm(qt, f) ]
```

当 `fields` 不存在时，保持现有单字段行为。

**4.5.2 条目检索字段权重**

`entrySearch.ts` 中条目 BM25 改为：

```ts
bm25Rank(
  query,
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

**4.5.3 动态相关性阈值**

`docChannel.ts` 中：

```ts
const queryTokens = tokenize(query).length
const minBm25 = 0.5 * Math.sqrt(Math.max(1, queryTokens))
// 过滤条件
if (bm25 < minBm25 && (mock || cosine < MIN_COSINE)) return []
```

`MIN_COSINE=0.35` 保持不变（向量阈值与查询长度关系较弱）。

## 5. 非功能需求

- **延迟**：文档通道检索延迟从 `向量 + BM25` 降为 `max(向量, BM25)`。
- **一致性**：启用 sqlite-vec 时，`chunks` 与 `chunks_vec` 行数差恒为 0（除写入瞬时窗口）。
- **可观测**：检索日志增加 `queryType` 与 `embeddingTypeDistribution` 字段。
- **向后兼容**：现有 `chunks` 行 `embedding_type` 默认为 `'real'`，不回填。
- **零新依赖**：不引入 jieba、rank-bm25 等第三方库。

## 6. 约束与假设

- SQLite 默认，PostgreSQL schema 同步新增列。
- `embedding-3` 1536 维不变。
- 现有 vitest 测试必须全部通过。

## 7. 验收标准

### AC-1 文档通道并行召回

- **rule**：`createRAGService().search` 中 `similaritySearch` 与 `bm25Search` 通过 `Promise.all` 并发执行。
- **rule**：`rrfFuse` 签名包含 `vectorWeight` 与 `bm25Weight`，默认均为 1.0。
- **rule**：`QueryUnderstanding` 包含 `queryType` 字段，`ruleBasedUnderstanding` 对"我下周三的日程"返回 `keyword`，对"什么是闭包"返回 `conceptual`。
- **rubric**（检索质量，0-2）：对 10 条关键词型 + 10 条概念型查询，自适应权重下 Top-5 命中率 ≥ 等权 RRF 的 1.1 倍。≥1.1 倍得 2，1.0-1.1 得 1，<1.0 得 0。

### AC-2 chunks_vec 双写一致性

- **rule**：`processDocument` 写入路径经过 `vectorStore.addDocuments`，不存在直接 `db.insert(tables.chunks)` 且不同步 `chunks_vec` 的代码。
- **rule**：`DELETE /api/documents/:id` 调用 `vectorStore.deleteByDocId`。
- **rule**：启用 `USE_SQLITE_VEC=1` 后，主路由上传的文档可被 `chunks_vec` 路径召回。

### AC-3 向量血缘

- **rule**：`chunks` 表存在 `embedding_type` 与 `embedding_model` 列；`entry_embeddings` 表存在 `embedding_type` 列。
- **rule**：mock 降级期间写入的块 `embedding_type='hash'`，真实 API 期间为 `'real'`。
- **rule**：`embeddingMock` 从 true 变为 false 后，后台任务重嵌 `embedding_type='hash'` 的行并更新为 `real`。

### AC-4 前端降级可感知

- **rule**：`chat.vue` 消费 `embeddingMock`，为 true 时对话页展示降级提示条。
- **rule**：重嵌进行中时前端展示"正在重建语义索引"提示。
- **rubric**（文案清晰度，0-2）：提示文案明确包含"语义搜索暂不可用"。明确得 2，模糊得 1，无提示得 0。

### AC-5 BM25 字段权重

- **rule**：`bm25Rank` 支持 `fields` 参数，标题 boost=3.0 时标题命中得分高于正文命中。
- **rule**：`docChannel` 相关性阈值随查询 token 数缩放，长查询（>10 tokens）不再全部丢弃。

### AC-6 非目标确认

- **rule**：`EMBEDDING_MODEL` 默认值仍为 `embedding-3`，未引入新的 embedding 模型或第三方检索依赖。

## 8. 风险

| 风险                                          | 影响                                   | 缓解                                          |
| --------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| schema 迁移破坏现有数据                       | 已有 `chunks` 行 `embedding_type` 为空 | `ensureColumn` 设默认 `'real'`，不回填        |
| 增量重嵌触发 API 限流                         | 重嵌期间再次降级                       | 每批 ≤ `EMBEDDING_CONCURRENCY`，失败保持 hash |
| 自适应权重误判                                | 关键词查询 BM25 权重不足               | 规则优先 + 保守默认（概念型用 0.5/0.5 起步）  |
| 前端降级提示干扰                              | 用户频繁看到提示                       | 仅 `embeddingMock=true` 时展示                |
| `vectorStore.addDocuments` 改签名波及旧调用方 | 旧 RAG 入库链路报错                    | 新参数可选，默认 `real`/`embedding-3`         |
