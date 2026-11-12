# 个人知识库 V5 — AI 能力实现全景文档

> 本文档面向**对项目不熟悉**的读者，系统梳理「个人知识库 V5」中所有与 AI 相关的前后端实现。相比初版，本版把每个模块的执行流程细化到**函数级与判断分支级**，让读者能顺着源码一步步看懂每一次调用、每一个 if 分支、每一处降级。可作为重构方案的基线参考。

---

## 目录

- [1. 项目背景与目标](#1-项目背景与目标)
- [2. 术语表](#2-术语表)
- [3. 技术栈](#3-技术栈)
- [4. 目录结构（AI 相关）](#4-目录结构ai-相关)
- [5. 整体架构：一条消息的完整旅程](#5-整体架构一条消息的完整旅程)
- [6. 后端 AI 模块详解](#6-后端-ai-模块详解)
  - [6.1 LLM 调用层（model.ts / chatChain.ts）](#61-llm-调用层modelts--chatchaints)
  - [6.2 RAG 检索层（Embedding / 向量 / BM25 / 分块）](#62-rag-检索层embedding--向量--bm25--分块)
  - [6.3 检索编排层（searchAll + 三通道）](#63-检索编排层searchall--三通道)
  - [6.4 生成层（答案组装与引用）](#64-生成层答案组装与引用)
  - [6.5 抽取层（意图判别 + 结构化）](#65-抽取层意图判别--结构化)
  - [6.6 成本与预算控制](#66-成本与预算控制)
  - [6.7 路由入口汇总](#67-路由入口汇总)
- [7. 前端 AI 交互详解](#7-前端-ai-交互详解)
  - [7.1 对话主链路 chat.vue](#71-对话主链路-chatvue)
  - [7.2 抽取卡片与条目编辑](#72-抽取卡片与条目编辑)
  - [7.3 文档上传与提取](#73-文档上传与提取)
  - [7.4 引用展示](#74-引用展示)
- [8. 配置项速查](#8-配置项速查)
- [9. 评测体系](#9-评测体系)
- [10. 已知问题与改进方向](#10-已知问题与改进方向)

---

## 1. 项目背景与目标

「个人知识库 V5」是一个**个人知识管理 + AI 助手**应用，核心目标：

1. 用户通过自然对话把自己的信息（日程、规划、事实、笔记）告诉 AI，AI 自动整理成结构化记录入库；
2. 用户提问时，AI 从已入库的记录和上传的文档中检索相关内容，据此作答（而非凭空编造）；
3. 支持上传 PDF / Word / 文本等文档，自动解析、分块、向量化，作为知识来源；
4. 对免费档 LLM 的限流、超时、余额不足做降级与熔断，保证基本可用。

产品形态：左侧导航四个页面——**对话、日程、规划、文档**。AI 能力集中在「对话」和「文档」两个入口，其余页面是数据的 CRUD 展示。

---

## 2. 术语表

| 术语                        | 含义                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **RAG**                     | Retrieval-Augmented Generation，检索增强生成。先从知识库检索相关内容，再让 LLM 基于这些内容作答，减少幻觉。                               |
| **Embedding**               | 把文本变成高维向量（本项目 1536 维），语义相近的文本向量距离近。用于语义检索。                                                            |
| **BM25**                    | 经典的关键词检索算法，基于词频与逆文档频率打分。与 Embedding 互补。                                                                       |
| **RRF**                     | Reciprocal Rank Fusion，倒数排名融合。把多个检索通道的排名合并成一个最终排序，无需调权重阈值。                                            |
| **chunk**                   | 文档分块后的片段，是向量化和检索的最小单位。                                                                                              |
| **cosine similarity**       | 余弦相似度，衡量两个向量方向的接近程度，值域 [-1, 1]，越大越相似。                                                                        |
| **降级（degraded）**        | LLM / Embedding 服务不可用时，用本地规则或哈希向量兜底，保证功能不中断但质量下降。                                                        |
| **熔断（circuit breaker）** | 连续失败后暂时停止调用后端服务，快速返回错误，避免雪崩。                                                                                  |
| **feature**                 | AI 调用的用途标签，用于成本统计与模型路由。取值：`chat_general` / `chat_with_records` / `extract` / `understand` / `embedding` / `eval`。 |

---

## 3. 技术栈

| 层        | 技术                                                                           |
| --------- | ------------------------------------------------------------------------------ |
| 前端      | Nuxt 3 (Vue 3 + Composition API)、TypeScript、Tailwind CSS、lucide-vue-next    |
| 后端      | Node.js + Express、Drizzle ORM、SQLite（可切换 PostgreSQL）、tsx（开发热重载） |
| LLM       | 智谱 AI（OpenAI 兼容协议），默认 `glm-4-flash`（免费档）                       |
| Embedding | 智谱 `embedding-3`（免费档），失败降级为 SHA-256 哈希向量                      |
| 文档解析  | pdf-parse（PDF）、mammoth + word-extractor（Word）                             |
| 测试      | Vitest（单元）、自定义评测脚本（集成）                                         |

---

## 4. 目录结构（AI 相关）

```
apps/server/src/
├── services/
│   ├── chain/
│   │   ├── model.ts          # LLM 调用 + 模型路由 + 熔断降级
│   │   └── chatChain.ts      # 对话链封装
│   ├── llm/
│   │   └── pricing.ts        # 单价表加载与成本估算
│   ├── rag/
│   │   ├── index.ts          # RAG 编排 barrel（混合检索/RRF）
│   │   ├── embeddings.ts     # Embedding 门面
│   │   ├── embeddingGateway.ts  # Embedding 实现 + 降级
│   │   ├── vectorStore.ts    # SQLite 向量存储
│   │   ├── bm25.ts           # BM25 关键词检索
│   │   ├── splitterPure.ts   # 文档分块（纯函数）
│   │   ├── fileText.ts       # PDF/Word/文本解析
│   │   └── loader.ts         # 文档加载
│   ├── search/
│   │   ├── searchAll.ts      # 统一检索编排入口
│   │   ├── queryUnderstanding.ts  # 查询意图理解
│   │   ├── timeChannel.ts    # 时间通道检索
│   │   ├── entrySearch.ts    # 条目语义检索
│   │   ├── docChannel.ts     # 文档语义检索
│   │   └── merge.ts          # 多通道融合排序
│   ├── answer/
│   │   ├── generate.ts       # 答案生成
│   │   ├── context.ts        # 上下文组装
│   │   └── citations.ts      # 引用快照
│   ├── extract/
│   │   ├── extractor.ts      # 对话抽取
│   │   ├── documentExtractor.ts  # 文档抽取
│   │   ├── timeParse.ts      # 时间解析
│   │   ├── recurrence.ts     # 重复规则
│   │   ├── dedupe.ts         # 去重判重
│   │   └── cards.ts          # 卡片构建
│   └── costTracker.ts        # 成本统计 + 预算熔断
├── routes/
│   ├── chat.ts               # 问答主链路
│   ├── extract.ts            # 抽取
│   ├── documents.ts          # 文档上传/提取
│   ├── search.ts             # 检索调试
│   ├── kb.ts / rag.ts        # 旧版 RAG 路由
│   └── cost.ts               # 成本查询
└── middleware/
    └── circuitBreaker.ts     # AI 熔断中间件

apps/generator/
├── pages/
│   ├── chat.vue              # 对话主链路
│   ├── documents.vue         # 文档页
│   ├── schedule.vue          # 日程（日历视图）
│   └── plans.vue             # 规划
├── components/
│   ├── EntryCard.vue         # 抽取卡片
│   ├── EntryEditor.vue       # 条目编辑
│   ├── CitationList.vue      # 引用列表
│   └── CitationDrawer.vue    # 引用详情抽屉
└── utils/
    ├── api.ts                # API 封装
    └── format.ts             # 时间格式化
```

---

## 5. 整体架构：一条消息的完整旅程

用户在对话页输入一句话，系统按以下流程处理：

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (chat.vue)                          │
│                                                               │
│  输入 → 意图路由（记录模式开关 OR 关键词正则）                 │
│       │                                                       │
│       ├── 问答路 → POST /api/chat ──────────────────────┐    │
│       │                                                  │    │
│       └── 抽取路 → POST /api/extract → 展示卡片 → 确认   │    │
│                              ↓                            │    │
│                       POST /api/entries (入库)            │    │
└──────────────────────────────────────────────────────────│────┘
                                                           │
┌──────────────────────────────────────────────────────────▼────┐
│                     后端 (Express)                              │
│                                                                │
│  POST /api/chat                                                │
│    │                                                           │
│    ├─① searchAll(query)                                        │
│    │   ├─ queryUnderstanding   规则 + LLM 判断意图/时间窗      │
│    │   ├─ 时间通道              SQL 区间查 schedule/plan        │
│    │   ├─ 条目语义通道          向量 + BM25 → RRF              │
│    │   ├─ 文档语义通道          向量 + BM25 → RRF              │
│    │   └─ merge                 加权融合 + 去重                │
│    │                                                           │
│    ├─② generateAnswer(query, search)                           │
│    │   ├─ assembleContext      按编号组装检索结果为文本         │
│    │   ├─ invoke LLM           基于上下文生成回答              │
│    │   └─ buildCitations       提取 [n] 引用编号               │
│    │                                                           │
│    └─③ 持久化 user + assistant 消息到 DB                       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 6. 后端 AI 模块详解

### 6.1 LLM 调用层（model.ts / chatChain.ts）

**文件**：[`services/chain/model.ts`](file:///d:/project/ai_study/apps/server/src/services/chain/model.ts)、[`services/chain/chatChain.ts`](file:///d:/project/ai_study/apps/server/src/services/chain/chatChain.ts)

#### 6.1.1 职责与对外接口

封装对 LLM 服务的 HTTP 调用，统一处理**超时、429 重试、降级标记、预算熔断、成本记账**。不依赖 LangChain 的厂商集成，直接 `fetch` OpenAI 兼容协议。

```ts
createChatModel(config?: ModelConfig) => {
  invoke(messages): Promise<string>        // 非流式
  stream(messages, { signal }): AsyncGenerator<string>  // 流式
  bindTools(tools)                          // 占位，未实现
}
```

```ts
ModelConfig = {
  provider?: 'zhipu' | 'openai' | 'mock'
  model?: string          // 显式指定模型
  tier?: 'small' | 'large'  // 小档/大档路由
  temperature?: number
  maxTokens?: number      // ⚠️ 目前未生效（未写入请求体）
  feature?: AiFeature     // 用于成本统计
}
```

#### 6.1.2 模型路由 `resolveModelName(config, env)`

优先级判断（[model.ts L49-53](file:///d:/project/ai_study/apps/server/src/services/chain/model.ts#L49-L53)）：

1. `config.model` 显式指定 → 直接用
2. `config.tier === 'large'` 且配置了 `AI_MODEL_LARGE` → 用大档
3. 否则用 `AI_MODEL`（默认 `glm-4-flash`）

#### 6.1.3 关键常量

| 常量                 | 值                                                       | 说明                     |
| -------------------- | -------------------------------------------------------- | ------------------------ |
| `LLM_TIMEOUT_MS`     | `max(1000, AI_TIMEOUT_MS \|\| 60000)`                    | 单次请求超时，默认 60s   |
| `RETRY_429_DELAY_MS` | VITEST 时 10ms，否则 4000ms                              | 429 限流后等待重试的时间 |
| `DEGRADED_PATTERN`   | `/余额不足\|1113\|insufficient\|rate.?limit\|too many/i` | 命中即标记为降级状态     |

#### 6.1.4 非流式调用 `invokeChat(ctx, input)` 逐步流程

这是所有非流式 LLM 调用（问答生成、抽取、查询理解）的底层实现。

**步骤 1 — 预处理 `prepareCall`**（[model.ts L138-146](file:///d:/project/ai_study/apps/server/src/services/chain/model.ts#L138-L146)）：

- 把 `input`（字符串或消息数组）统一成 `messages` 数组
- 调 `resolveModelName` 得到目标模型名
- 调 `applyBudgetCircuit` 做预算熔断（见 6.1.6），可能把付费模型降级为免费档

**步骤 2 — 发送请求 + 429 重试**（[model.ts L220-232](file:///d:/project/ai_study/apps/server/src/services/chain/model.ts#L220-L232)）：

- 循环最多 2 次（attempt 0 和 attempt 1）
- 每次调 `postChat`（`fetch` 到 `${apiUrl}/chat/completions`，带 `AbortSignal.timeout(LLM_TIMEOUT_MS)`）
- `response.ok` → 跳出循环
- `response.status === 429 && attempt < 1` → 等 `RETRY_429_DELAY_MS` 后 `continue` 重试
- 其他非 2xx → 调 `throwHttpError` 抛错（不会重试）

> **关键判断**：只有 HTTP 429 才重试；超时（`TimeoutError`）和网络错误直接抛，不重试。

**步骤 3 — 解析响应**（[model.ts L234-243](file:///d:/project/ai_study/apps/server/src/services/chain/model.ts#L234-L243)）：

- `response.json()` 取 `choices[0].message.content`
- 调 `clearChatDegraded()` 清除降级标记（成功一次即恢复）
- 如果响应带 `usage`，调 `trackUsage` 记入成本

**步骤 4 — 异常处理**（[model.ts L244-256](file:///d:/project/ai_study/apps/server/src/services/chain/model.ts#L244-L256)）：

- 错误消息以「AI 请求失败」开头 → 原样抛出（已是 `throwHttpError` 处理过的）
- `err.name === 'TimeoutError'` → 转抛「AI 响应超时，请稍后重试」
- 其他 → 记录网络异常日志后抛出

#### 6.1.5 流式调用 `streamChat(ctx, input, options)` 逐步流程

**步骤 1**：同非流式的 `prepareCall`（模型路由 + 预算熔断）

**步骤 2**：`postChat` 发送请求（`stream: true`），**不做 429 重试**

**步骤 3 — SSE 解析**（[model.ts L281-315](file:///d:/project/ai_study/apps/server/src/services/chain/model.ts#L281-L315)）：

- 用 `ReadableStream` 的 `getReader()` 逐块读取
- `TextDecoder` 解码后按 `\n` 切行，保留最后一行到 `buffer`（可能不完整）
- 对每行：
  - 空行或不以 `data: ` 开头 → 跳过
  - `data: [DONE]` → 标记 `finishReason='done'`，跳出
  - 否则 `JSON.parse(trimmed.slice(6))` 解析：
    - 如果带 `usage` → 存到 `streamUsage`（最后几个 chunk 可能带）
    - 取 `choices[0].delta.content`，非空则 `yield`

**步骤 4**：流读完后 `clearChatDegraded()`，如果有 `streamUsage` 则记账

> **注意**：流式调用遇到非 2xx 直接 `throwHttpError`，不重试；解析单个 chunk 失败只 `catch` 忽略，不中断流。

#### 6.1.6 预算熔断 `applyBudgetCircuit(provider, model, env)`

（[model.ts L93-118](file:///d:/project/ai_study/apps/server/src/services/chain/model.ts#L93-L118)）

```
输入: provider, model, env
  │
  ├─ isFreeModel(provider, model) === true
  │    → 直接放行（免费模型不受预算约束）
  │
  └─ 付费模型:
       ├─ checkMonthlyBudget().blocked === true 且 model !== env.defaultModel
       │    → 强制降级为 env.defaultModel，返回 { model: defaultModel, downgradedFrom: model }
       │
       ├─ checkMonthlyBudget().warning === true 且距上次告警 > 60s
       │    → 打 warn 日志（不降级）
       │
       └─ 正常 → 返回 { model, downgradedFrom: null }
```

`checkMonthlyBudget` 有 60s 缓存（[costTracker.ts L330-351](file:///d:/project/ai_study/apps/server/src/services/costTracker.ts#L330-L351)），避免每次调用都查库。

#### 6.1.7 降级标记 `chatDegraded`

进程级单例状态（[model.ts L63](file:///d:/project/ai_study/apps/server/src/services/chain/model.ts#L63)）：

- `markChatDegraded(reason)`：HTTP 429 或响应体匹配 `DEGRADED_PATTERN` 时调用，置 `degraded=true`
- `clearChatDegraded()`：每次成功调用后调用，置 `degraded=false`
- `isChatDegraded()` / `getChatDegradedState()`：供 `/api/cost` 查询展示

> **注意**：这个标记**只做状态展示**，不影响模型路由。真正的强制降级只发生在预算熔断（`applyBudgetCircuit`）。

#### 6.1.8 成本记账 `trackUsage`

（[model.ts L195-206](file:///d:/project/ai_study/apps/server/src/services/chain/model.ts#L195-L206)）

每次成功调用后，把 `feature / model / provider / prompt_tokens / completion_tokens / total_tokens / costMs` 通过 `costTracker.track()` 发出事件，异步入库到 `ai_usage_logs` 表（见 6.6）。

#### 6.1.9 对话链 chatChain

在 `model` 之上封装，`createChatChain({ model, temperature, feature })` 返回 `{ invoke, stream }`。`invoke(request)` 返回 `{ content, usage? }`。

> ⚠️ **已知问题**：`usage` 永远为空，`model.ts` 里的 usage 没有透传到 `chatChain.invoke` 的返回值。

---

### 6.2 RAG 检索层（Embedding / 向量 / BM25 / 分块）

#### 6.2.1 Embedding 网关

**文件**：[`services/rag/embeddingGateway.ts`](file:///d:/project/ai_study/apps/server/src/services/rag/embeddingGateway.ts)

```ts
getEmbedding(text): Promise<number[]>       // 单条
getEmbeddings(texts): Promise<number[][]>   // 批量（并发 4）
cosineSimilarity(a, b): number              // 余弦相似度
hashVector(text): number[]                  // 降级用：SHA-256 → 正态分布向量
isMockMode(): boolean                       // 是否处于降级模式
```

**维度**：1536（与智谱 `embedding-3` 一致）

**`getEmbedding(text)` 逐步流程**（[embeddingGateway.ts L100-190](file:///d:/project/ai_study/apps/server/src/services/rag/embeddingGateway.ts#L100-L190)）：

```
1. 读取环境变量（apiUrl, apiKey, model, forceMock, disableFallback）
2. forceMock === true
     → 记录 mock 成本（tokens=0, metadata.mock=true）
     → return hashVector(text)
3. fetch(`${apiUrl}/embeddings`, { signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS=15s) })
4. response.ok === false
     → throw new Error(`HTTP ${status}: ${errorText}`)
5. 解析 data.data[0].embedding
6. 有 usage → costTracker.track({ feature:'embedding', ... })
7. return embedding

catch 分支:
  - disableFallback === true → 直接 throw
  - 否则:
      - 首次降级打 warn（mockModeActivated=true，后续不再打）
      - 记录 mock 成本
      - return hashVector(text)
```

**`hashVector(text)` 原理**（[embeddingGateway.ts L53-94](file:///d:/project/ai_study/apps/server/src/services/rag/embeddingGateway.ts#L53-L94)）：

1. `SHA-256(text)` → 64 位 hex → 切成 8 个 32-bit 种子
2. 用 `Mulberry32` 伪随机数生成器（确定性）
3. `Box-Muller` 变换生成 1536 个正态分布数
4. L2 归一化（向量长度 = 1.0）

特性：相同文本 → 完全相同向量（幂等）；不同文本 → cosine ≈ 0（无语义）。

**`getEmbeddings(texts)` 批量**（[embeddingGateway.ts L193-220](file:///d:/project/ai_study/apps/server/src/services/rag/embeddingGateway.ts#L193-L220)）：

- 并发数 = `EMBEDDING_CONCURRENCY`（默认 4）
- worker pool 模式：多个 worker 共享 `next` 指针，逐个取文本调用 `getEmbedding`
- 单个失败 → `hashVector` 降级，不影响其他

> ⚠️ **粘滞问题**：`isMockMode()` 一旦触发（`mockModeActivated=true`），进程内永久为 true，API 恢复也不会自动恢复，需重启。这导致 `entrySearch` 在 mock 模式下永久跳过向量通道。

#### 6.2.2 向量存储 vectorStore

**文件**：[`services/rag/vectorStore.ts`](file:///d:/project/ai_study/apps/server/src/services/rag/vectorStore.ts)

```ts
createSqliteVectorStore() => {
  addDocuments(docs, docId?): Promise<string[]>
  similaritySearch(query, k=4, docId?): Promise<VectorSearchResult[]>
  deleteByDocId(docId): Promise<number>
}
```

**`similaritySearch(query, k, docId)` 逐步流程**（[vectorStore.ts L69-96](file:///d:/project/ai_study/apps/server/src/services/rag/vectorStore.ts#L69-L96)）：

```
1. queryEmbedding = await getEmbedding(query)
2. SELECT * FROM chunks WHERE embedding IS NOT NULL [AND doc_id = ?]
3. 对每一行:
     - JSON.parse(row.embedding) 得到向量
     - score = cosineSimilarity(queryEmbedding, embedding)
4. 按 score 降序排序
5. slice(0, k) 返回
```

- embedding 以 JSON 文本存在 `chunks.embedding` 列
- ⚠️ **全表扫描**：取出所有 chunk 在内存算 cosine，无 ANN 索引（500 行内可接受）

#### 6.2.3 BM25 关键词检索

**文件**：[`services/rag/bm25.ts`](file:///d:/project/ai_study/apps/server/src/services/rag/bm25.ts)

**分词器 `tokenize(text)`**（[bm25.ts L36-73](file:///d:/project/ai_study/apps/server/src/services/rag/bm25.ts#L36-L73)）：

1. 按标点/空白切成候选段（`toLowerCase`）
2. 纯 ASCII 段 → 整词（长度 > 1 才保留）
3. 中文/混合段：
   - 抽出英文单词（`/[a-z0-9]+/g`）
   - 剩余中文做 **2-gram 滑窗**（如「知识库」→「知识」「识库」）
   - 单字中文直接保留

**`bm25Rank(query, docs, k)` 逐步流程**（[bm25.ts L84-141](file:///d:/project/ai_study/apps/server/src/services/rag/bm25.ts#L84-L141)）：

```
1. queryTokens = tokenize(query)；为空则返回 []
2. N = docs.length
3. 对每个 doc: docTokens[i] = tokenize(doc.text); docLens[i] = len
4. avgdl = 平均文档长度
5. 计算每个 doc 的 tf（词频 map）
6. 计算每个 query token 的 df（包含该 token 的文档数）
7. 对每个 doc i:
     score = Σ over queryTokens qt:
       idf = ln((N - df[qt] + 0.5) / (df[qt] + 0.5) + 1)
       denom = tf[qt] + K1 * (1 - B + B * (docLens[i] / avgdl))
       score += idf * (tf[qt] * (K1 + 1)) / denom
8. 按 score 降序，取 top k
```

参数：`K1=1.2`（词频饱和），`B=0.75`（文档长度归一化）。

**`bm25Search(query, k, docId?)`**：从 `chunks` 表读全部行（可选 docId 过滤），调用 `bm25Rank` 返回结构化结果。

#### 6.2.4 混合检索 RRF

**文件**：[`services/rag/index.ts`](file:///d:/project/ai_study/apps/server/src/services/rag/index.ts)（也定义在 `entrySearch.ts` 的 `rrfFuseIds`）

```ts
rrfFuse(vectorRanked, bm25Ranked, (k = 60))
// score(d) = Σ 1/(k + rank(d))
```

`entrySearch.ts` 的 `rrfFuseIds(lists, k=60)`（[entrySearch.ts L61-71](file:///d:/project/ai_study/apps/server/src/services/search/entrySearch.ts#L61-L71)）：

- 输入：多个排名列表（每个是 id 数组，按相关度从高到低）
- 对每个 id，累加 `1 / (k + rank + 1)`（rank 从 0 开始）
- 按总分降序返回

RRF 的优势：不需要对向量分和 BM25 分做归一化，直接按排名融合。

#### 6.2.5 分块 splitterPure

**文件**：[`services/rag/splitterPure.ts`](file:///d:/project/ai_study/apps/server/src/services/rag/splitterPure.ts)

四级切分（按优先级）：**结构（标题/列表）→ 段落 → 句子 → 硬切**

| 参数     | 默认值   |
| -------- | -------- |
| 目标块长 | 600 字符 |
| 最小块长 | 80       |
| 重叠     | 80       |
| 硬上限   | 900      |
| 最大块数 | 500      |

#### 6.2.6 文件解析 fileText

**文件**：[`services/rag/fileText.ts`](file:///d:/project/ai_study/apps/server/src/services/rag/fileText.ts)

| 格式             | 解析器                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `.pdf`           | `pdf-parse/lib/pdf-parse.js`（绕过 index 入口的 debug 模式 bug，用 `createRequire` 直引） |
| `.docx`          | `mammoth`，失败回落 `word-extractor`                                                      |
| `.doc`           | `word-extractor`                                                                          |
| `.txt/.md/.json` | UTF-8 读取                                                                                |

统一做：去 BOM、CRLF→LF、trim；空文本抛错（避免扫描件被标记为 ready）。

---

### 6.3 检索编排层（searchAll + 三通道）

**文件**：[`services/search/searchAll.ts`](file:///d:/project/ai_study/apps/server/src/services/search/searchAll.ts)

#### 6.3.1 接口

```ts
searchAll({ query, libraryId?, now?, timezone?, timeRange?, includeArchived?, skipUnderstanding? }) => {
  understanding: QueryUnderstanding   // 意图理解结果（可能被 fallback 修正）
  window: TimeWindow | null           // 时间窗
  results: SearchResultItem[]         // 融合后的检索结果
  summary: SearchSummary | null       // 超量汇总
  channels: { time, entry, doc }      // 各通道命中数
  embeddingMock: boolean              // embedding 是否处于 mock 降级
  empty: boolean                      // 是否全无命中
}
```

#### 6.3.2 主流程逐步详解

（[searchAll.ts L51-147](file:///d:/project/ai_study/apps/server/src/services/search/searchAll.ts#L51-L147)）

**步骤 1 — 查询理解（规则优先，LLM 兜底）**

```ts
const rules = ruleBasedUnderstanding(query, nowMs)
const understanding =
  options.timeRange !== undefined
    ? { needsPersonalContext: true, timeRange: options.timeRange, ... }  // 显式指定窗口
    : options.skipUnderstanding || rules.timeRange !== null || !rules.needsPersonalContext
      ? rules                    // 规则已能判定 → 不调 LLM（省一次调用）
      : await understandQuery({ query, now, timezone })  // 规则不确定 → 调 LLM（8s 超时）
```

**关键判断**：

- `rules.timeRange !== null`（规则识别出时间窗）→ 直接用规则，不调 LLM
- `!rules.needsPersonalContext`（规则判定为通用问题）→ 直接用规则
- 只有规则判定 `needsPersonalContext=true` 且无时间窗时才调 LLM

**步骤 2 — 三通道并行检索（`Promise.all`）**

```ts
const [timeHits, entryHits, docHits] = await Promise.all([
  needsPersonal && window
    ? searchTimeChannel({ windowStart, windowEnd, libraryId, includeArchived, now })
    : Promise.resolve([]), // 时间通道：需个人 + 有时间窗
  needsPersonal ? searchEntriesSemantic({ query, libraryId }) : Promise.resolve([]), // 条目语义：需个人
  searchDocumentsSemantic(query).catch(() => []), // 文档语义：始终跑，失败降级 []
])
```

**步骤 3 — 通用问题兜底**

```ts
if (!needsPersonal && docHits.length === 0) {
  return { results: [], empty: true, ... }  // 通用问题且文档无命中 → 空结果，走通用问答
}
```

> 设计理由：「龚熙皓是谁」可能被误判为通用问题，但答案在文档里；所以文档通道始终跑。如果文档也没命中，才确认为通用知识问题。

**步骤 4 — 融合排序**

```ts
const { results, summary } = mergeSearchSignals({ timeHits, entryHits, docHits })
```

**步骤 5 — 三路全空的回退判断**

```ts
const fallbackToGeneral = needsPersonal && results.length === 0 && !OWNER_CUE_RE.test(query)
// OWNER_CUE_RE = /我|咱|安排|日程|进度|待办|提醒|记得|记录|计划/
```

- `needsPersonal=true` 但三路全空，且 query 不含个人归属词（如「您好」「今天天气怎么样」）→ 回退为通用问答（`needsPersonalContext=false`）
- 否则保持 `needsPersonalContext=true`（让生成层返回「未找到」话术）

**步骤 6 — 返回**

```ts
return {
  understanding: resolved, // 可能被修正为 general
  window,
  results,
  summary,
  channels: { time, entry, doc },
  embeddingMock: isMockMode(),
  empty: results.length === 0,
}
```

#### 6.3.3 查询理解 queryUnderstanding

**文件**：[`services/search/queryUnderstanding.ts`](file:///d:/project/ai_study/apps/server/src/services/search/queryUnderstanding.ts)

**规则层 `ruleBasedUnderstanding(query, nowMs)`**（[queryUnderstanding.ts L128-142](file:///d:/project/ai_study/apps/server/src/services/search/queryUnderstanding.ts#L128-L142)）：

```
timeRange = detectTimeWindow(query, nowMs)
needsPersonalContext = PERSONAL_CUE.test(query) || timeRange !== null
// PERSONAL_CUE = /我|咱|最近|近N天|今天|明天|这周|安排|日程|计划|提醒|记得|记录/
```

> **关键设计**：`needsPersonalContext` 默认 `false`。只有出现个人线索或明确时间语义时才 `true`。
> 反过来（默认 true）会让「您好」这类问题检索 0 命中后直接回「你的记录里没有相关内容」，通用问答没机会执行。

**`detectTimeWindow(query, nowMs)` 支持的时间表达**（[queryUnderstanding.ts L90-125](file:///d:/project/ai_study/apps/server/src/services/search/queryUnderstanding.ts#L90-L125)）：

| 表达                  | 窗口                     |
| --------------------- | ------------------------ |
| 最近/近/过去 N 天     | `[today-(N-1), today+1)` |
| 上个月/上月           | 整月                     |
| 这个月/本月           | 整月                     |
| 上周                  | `[本周一-7, 本周一)`     |
| 下周                  | `[本周一+7, 本周一+14)`  |
| 这周/本周             | `[本周一, 本周一+7)`     |
| 大后天/后天/明天/今天 | 当天                     |

**LLM 层 `understandQuery`**（[queryUnderstanding.ts L225-249](file:///d:/project/ai_study/apps/server/src/services/search/queryUnderstanding.ts#L225-L249)）：

```
1. fallback = ruleBasedUnderstanding(query, nowMs)
2. try:
     content = withTimeout(invoke(buildMessages(query, nowMs, timezone)), 8000ms)
     parsed = normalizeLlmUnderstanding(parseLooseJson(content), fallback)
     parsed === null → return fallback（输出非法）
     return parsed
   catch:
     return fallback（超时/网络错）
```

`normalizeLlmUnderstanding` 校验：

- `needsPersonalContext` 必须是 boolean，否则用 fallback
- `timeRange` 必须有合法的 start/end 且 end > start，否则用 fallback 的 timeRange
- `entityTypes` 只接受 schedule/plan/fact/note，否则全类型
- `keywords` 最多 5 个，每个最长 20 字符

#### 6.3.4 时间通道 timeChannel

**文件**：[`services/search/timeChannel.ts`](file:///d:/project/ai_study/apps/server/src/services/search/timeChannel.ts)

**`searchTimeChannel(options)` 逐步流程**（[timeChannel.ts L44-132](file:///d:/project/ai_study/apps/server/src/services/search/timeChannel.ts#L44-L132)）：

```
windowStart = startOfLocalDay(options.windowStart)  // 对齐到当天 00:00
windowEnd = options.windowEnd

第一步：单次事件（schedule / plan，无 recurrence）
  SQL 条件:
    status = 'active' (或 includeArchived 时 active+archived)
    type IN ('schedule', 'plan')
    recurrence IS NULL
    startAt IS NOT NULL
    startAt < windowEnd
    COALESCE(endAt, startAt) >= windowStart
  ORDER BY startAt ASC, LIMIT 20
  → 每个 hit: score = timeScore(startAt, now)  // 1 / (1 + |startAt - now| / 7天)

第二步：重复事件（schedule，有 recurrence）
  SQL 条件:
    status = 'active'
    type = 'schedule'
    recurrence IS NOT NULL
    startAt IS NOT NULL
    recurrenceUntil IS NULL OR recurrenceUntil >= windowStart
  LIMIT 200
  → 对每行:
      recurrence = normalizeRecurrence(row.recurrence, nowMs, startAt)
      occurrences = expandOccurrences({ startAt, endAt, recurrence, windowStart, windowEnd })
      对每个 occurrence:
        hits.push({ entry, startAt: occurrence.start, occurrence: true, score: timeScore(...) })
        if hits.length >= 120 break

第三步：hits.sort((a,b) => a.startAt - b.startAt)
return options.limit ? hits.slice(0, limit) : hits
```

常量：`MAX_SINGLE_HITS=20`，`MAX_RECURRING_ROWS=200`，`MAX_EXPAND_HITS=120`

#### 6.3.5 条目语义通道 entrySearch

**文件**：[`services/search/entrySearch.ts`](file:///d:/project/ai_study/apps/server/src/services/search/entrySearch.ts)

**`searchEntriesSemantic(options)` 逐步流程**（[entrySearch.ts L73-142](file:///d:/project/ai_study/apps/server/src/services/search/entrySearch.ts#L73-L142)）：

```
1. k = 15, minScore = 0.35
2. 读 entries 表: status='active' [AND library_id=?], ORDER BY updatedAt DESC, LIMIT 500
3. rows 为空 → return []

4. 向量路:
   if isMockMode():
     embeddings = empty Map   // mock 模式跳过向量（hash 向量无语义）
   else:
     embeddings = loadEmbeddings(rows.map(r => r.id))  // 分批 400 条读 entry_embeddings 表
   if embeddings.size > 0:
     queryVector = getEmbedding(query)
     对每个 [entryId, vector]:
       score = cosineSimilarity(queryVector, vector)
       score >= 0.35 → vectorScores.set(entryId, score)
   vectorRanked = 按 score 降序的 entryId 列表，取 top k*3=45

5. BM25 路:
   bm25Hits = bm25Rank(query, rows.map(r => ({ id, text: entryEmbeddingText(title, content) })), k*3)
   bm25Scores = score > 0 的 hit

6. RRF 融合:
   rrfFuseIds([vectorRanked, bm25Ranked])  // k=60
   取 top k=15
   → 每个返回 { entry, score, vectorScore?, bm25Score? }
```

> **关键点**：mock 模式下向量路整体跳过，只有 BM25 有意义。向量路取 top 45（k\*3）再融合，给 RRF 足够的候选池。

#### 6.3.6 文档语义通道 docChannel

**文件**：[`services/search/docChannel.ts`](file:///d:/project/ai_study/apps/server/src/services/search/docChannel.ts)

**`searchDocumentsSemantic(query, k=15)` 逐步流程**（[docChannel.ts L22-47](file:///d:/project/ai_study/apps/server/src/services/search/docChannel.ts#L22-L47)）：

```
1. mock = isMockMode()
2. results = createRAGService().search(query, k)  // 复用 RAGService（向量 + BM25 → RRF）
3. 对每个 result:
     docId = result.doc.metadata.docId
     if docId 不是 string 或无 doc.id → 跳过
     bm25 = result.bm25Score ?? 0
     cosine = result.vectorScore ?? 0
     // 相关性兜底：RRF 是排名分，零相关也会有正分
     if bm25 <= 0 && (mock || cosine < 0.35) → 跳过
     → 返回 { docId, chunkId, chunkIndex, content, score, vectorScore?, bm25Score? }
```

> **关键判断**：`bm25 <= 0 && (mock || cosine < 0.35)` 时丢弃。
>
> - mock 模式下只看 BM25（cosine 不可信）
> - 真实模式下 BM25=0 且 cosine<0.35 → 不相关

#### 6.3.7 融合排序 merge

**文件**：[`services/search/merge.ts`](file:///d:/project/ai_study/apps/server/src/services/search/merge.ts)

**`mergeSearchSignals({ timeHits, entryHits, docHits })` 逐步流程**（[merge.ts L146-273](file:///d:/project/ai_study/apps/server/src/services/search/merge.ts#L146-L273)）：

**权重**：时间 1.3 / 条目 1.0 / 文档 0.8
**上限**：条目 10 / 文档 5 / 合计 15

```
1. 构造 raw 列表（每个 hit 带 weight）:
   - timeHits: weight=1.3, source='time', kind='entry'
   - entryHits: 跳过已在 timeHits 中出现的 entryId（去重），weight=1.0, source='semantic'
   - docHits: 先 mergeAdjacentChunks（同文档相邻 chunk 合并），weight=0.8, source='semantic', kind='chunk'

2. 归一化 normalize(raw):
   - 按 group = `${source}:${kind}` 分组，找到每组的最高分 max
   - channelScore = score / max
   - 最终 score = channelScore * weight
   （避免 RRF 的微小数值让时间通道天然压制语义通道）

3. 排序:
   - 主序: score 降序
   - 次序: time 优先于 semantic
   - 第三序: startAt 升序（早的在前）

4. 截断 + 汇总:
   - 遍历 sorted:
     - withinTotal (results.length < 15) && withinKind (entry<10 或 doc<5) → push
     - 否则 → remaining++，按类型计数
   - remaining > 0 → 构建 summary:
       text = `另有 N 条相关记录（X 条日程、Y 条文档片段），已合并`
       汇总行编号固定为 16（MAX_TOTAL_RESULTS + 1）
```

**`mergeAdjacentChunks`**（[merge.ts L85-115](file:///d:/project/ai_study/apps/server/src/services/search/merge.ts#L85-L115)）：

- 按 docId 分组
- 同文档内按 chunkIndex 排序
- 相邻 chunk（index 差 1）合并：content 用 `\n` 拼接，score 取 max

---

### 6.4 生成层（答案组装与引用）

**文件**：[`services/answer/generate.ts`](file:///d:/project/ai_study/apps/server/src/services/answer/generate.ts)

#### 6.4.1 接口

```ts
generateAnswer({ query, search, history?, timezone?, invoke?, docNames?, timeoutMs? }) => {
  reply: string
  citations: Citation[]
  missing: string[]
  degraded: boolean
  degradedReason: 'timeout' | 'llm_error' | 'not_found' | null
  empty: boolean
  general: boolean
}
```

**常量**：`DEFAULT_ANSWER_TIMEOUT_MS = 30_000`，`HISTORY_MAX_CHARS = 2000`，`HISTORY_MAX_MESSAGES = 12`

#### 6.4.2 主流程逐步详解

（[generate.ts L165-255](file:///d:/project/ai_study/apps/server/src/services/answer/generate.ts#L165-L255)）

**分支 1 — 通用问题**（`!search.understanding.needsPersonalContext`）：

```
messages = buildAnswerMessages({
  query,
  contextText: '',              // 不注入个人记录
  history: trimHistory(history),
  general: true                  // SYSTEM_GENERAL prompt
})
content = withTimeout(invoke(messages, 'chat_general'), 30s)
return { reply: content, citations: [], missing: [], degraded: false, general: true }
```

**分支 2 — 检索为空**（`search.empty`）：

```
return {
  reply: NOT_FOUND_REPLY,  // '你的记录里没有相关内容。可以先「记一条」把它告诉我。'
  citations: [], missing: [],
  degraded: true, degradedReason: 'not_found',
  empty: true, general: false
}
// 不调模型
```

**分支 3 — 正常生成**（有检索结果）：

```
1. docNames = resolveDocNames(results 中的 docId)  // 批量查文档名
2. assembled = assembleContext({ results, summary, docNames, timezone })
3. citations = buildCitations(assembled, summary, docNames)
4. messages = buildAnswerMessages({
     query,
     contextText: assembled.text,
     history: trimHistory(history),
     general: false  // SYSTEM_WITH_RECORDS prompt
   })
5. try:
     content = withTimeout(invoke(messages, 'chat_with_records'), 30s)
   catch:
     timeout → degradedReason='timeout'
     其他 → degradedReason='llm_error'
     return { reply: fallbackReply(assembled), citations, degraded: true, ... }
6. { reply, missing } = parseMissing(content)  // 剥离末尾「未命中：A、B」
7. return { reply, citations, missing, degraded: false, ... }
```

#### 6.4.3 降级矩阵总结

| 情形                         | 行为                     | degradedReason | general |
| ---------------------------- | ------------------------ | -------------- | ------- |
| `needsPersonalContext=false` | 不注入上下文，直接问 LLM | null           | true    |
| 检索结果为空                 | 固定话术，**不调模型**   | `not_found`    | false   |
| LLM 超时                     | 列出检索结果编号         | `timeout`      | false   |
| LLM 失败                     | 列出检索结果编号         | `llm_error`    | false   |
| 正常                         | LLM 基于上下文作答       | null           | false   |

#### 6.4.4 上下文组装 context.ts

**文件**：[`services/answer/context.ts`](file:///d:/project/ai_study/apps/server/src/services/answer/context.ts)

**预算**：条目行 160 字 / 片段 400 字 / 总计 3200 字（按中文 1 token ≈ 1.3 字符折算）

**`assembleContext({ results, summary, docNames, timezone })` 逐步流程**（[context.ts L74-110](file:///d:/project/ai_study/apps/server/src/services/answer/context.ts#L74-L110)）：

```
entryLines = [], chunkLines = [], numbered = [], used = 0

for item of results:
  num = numbered.length + 1
  line = item.kind === 'entry'
    ? entryLine(num, item, timezone)   // "1. [日程] 2026-11-11 周三 14:00 标题 内容（录入于 2026-11-06）"
    : chunkLine(num, item, docNames)   // "4. 《文档名》内容..."
  if used + line.length > 3200 → break  // 超预算的低优先级不注入、不编号
  used += line.length
  numbered.push({ num, item })
  按 kind 分别 push 到 entryLines / chunkLines

sections = []
if entryLines.length > 0: sections.push(`[个人记录]\n${entryLines.join('\n')}`)
if chunkLines.length > 0: sections.push(`[资料片段]\n${chunkLines.join('\n')}`)

summaryNum = null
if summary && numbered.length > 0:
  summaryNum = 16  // 固定编号，即使详细条数不足 15 也保持语义稳定
  sections.push(`[其他相关]\n16. ${summary.text}`)

return { text: sections.join('\n\n'), numbered, summaryNum }
```

**`entryLine` 格式**：`{num}. [{类型}] {时间} {标题} {内容}（录入于 {日期}）`

- 时间：有 startAt 时格式化；同日有 endAt 时显示 `start-end`，否则只显示 start
- 内容：与标题不同才追加
- 超 160 字截断加 `…`

**`chunkLine` 格式**：`{num}. 《{文档名}》{内容}`，超 400 字截断

> **关键**：编号从 1 开始连续分配，超预算截断的条目**不编号、不出现在引用里**。汇总行固定编号 16。

#### 6.4.5 引用构建 citations.ts

**文件**：[`services/answer/citations.ts`](file:///d:/project/ai_study/apps/server/src/services/answer/citations.ts)

**`buildCitations(assembled, summary, docNames)` 逐步流程**（[citations.ts L56-101](file:///d:/project/ai_study/apps/server/src/services/answer/citations.ts#L56-L101)）：

```
citations = []
for { num, item } of assembled.numbered:
  if item.kind === 'entry':
    citations.push({
      num, type: 'entry', id: entryId, entryType, label: title,
      snippet: snippet(content) || TYPE_LABEL[type],
      startAt, endAt, occurrence
    })
  else:
    citations.push({
      num, type: 'chunk', id: chunkId, docId, docName, chunkIndex,
      snippet: snippet(content)
    })

if summary && assembled.summaryNum !== null:
  citations.push({
    num: 16, type: 'summary', text: summary.text,
    remaining, byType, docChunks
  })
```

**`Citation` 类型**：

```ts
type Citation =
  | { type: 'entry'; num; id; entryType; label; snippet; startAt; endAt; occurrence }
  | { type: 'chunk'; num; id; docId; docName; chunkIndex; snippet }
  | { type: 'summary'; num; text; remaining; byType; docChunks }
```

`buildCitations` 返回的引用列表**同时写入 `messages.citations` 做快照**，条目后续被修改也不影响历史回答对账。

#### 6.4.6 历史裁剪 `trimHistory`

（[generate.ts L84-98](file:///d:/project/ai_study/apps/server/src/services/answer/generate.ts#L84-L98)）

```
1. 过滤掉非 user/assistant 和空内容
2. 取最近 12 条（6 轮）
3. 从新到旧遍历，累加字符数：
   - used + content.length > 2000 → 停止（保留已经加的）
   - 否则 unshift 到 kept
4. return kept（旧→新顺序）
```

#### 6.4.7 未命中解析 `parseMissing`

（[generate.ts L117-127](file:///d:/project/ai_study/apps/server/src/services/answer/generate.ts#L117-L127)）

```
正则: /未命中[：:]\s*([^\n]+?)\s*$/
匹配到:
  missing = 按 [、，,] 分割，trim，去尾标点
  reply = 去掉这一行后的内容
未匹配: reply = 原文 trim, missing = []
```

#### 6.4.8 兜底回答 `fallbackReply`

（[generate.ts L156-163](file:///d:/project/ai_study/apps/server/src/services/answer/generate.ts#L156-L163)）

```
lines = assembled.numbered.map(({ num, item }) => {
  label = item.kind === 'chunk' ? '资料' : TYPE_LABEL[type]
  text = title || content.slice(0, 40)
  return `${num}. [${label}] ${text}`
})
return `回答生成超时，以下是你的相关记录：\n${lines.join('\n')}`
```

---

### 6.5 抽取层（意图判别 + 结构化）

**文件**：[`services/extract/extractor.ts`](file:///d:/project/ai_study/apps/server/src/services/extract/extractor.ts)

#### 6.5.1 接口

```ts
extractEntries({ text, mode?, now?, timezone?, existingEntries?, maxEntries?, invoke?, timeoutMs? }) => {
  ok: boolean
  intent: 'record' | 'query' | 'chat'
  reply: string
  entries: ExtractedEntry[]
  truncated: boolean
  remaining: number
  failed: 'non_json' | 'timeout' | 'llm_error' | null
  rawText: string
}
```

**常量**：`MAX_EXTRACT_ENTRIES = 5`（对话），`DEFAULT_EXTRACT_TIMEOUT_MS = max(1000, EXTRACT_TIMEOUT_MS || 25000)`

#### 6.5.2 主流程逐步详解

（[extractor.ts L561-642](file:///d:/project/ai_study/apps/server/src/services/extract/extractor.ts#L561-L642)）

```
messages = buildExtractMessages({ text, nowMs, timezone, mode, existingEntries })
maxEntries = options.maxEntries ?? 5
lastFailure = 'non_json'
consistencyFeedback = null

for attempt in 0..1:
  requestMessages = attempt === 0 ? messages : retryMessages(messages, consistencyFeedback)

  try:
    content = withTimeout(invoke(requestMessages), timeoutMs)
  catch err:
    if timeout:
      lastFailure = 'timeout'
      break  // 超时不重试，直接降级
    else:
      lastFailure = 'llm_error'
      continue  // 网络错误重试一次

  payload = parseLooseJson(content)
  normalized = payload ? normalizeExtractResponse(payload, nowMs, text) : null

  if !normalized:
    lastFailure = 'non_json'
    continue  // 非 JSON 重试一次

  // 一致性校验（仅 conversation 模式）
  violations = mode === 'document' ? [] : verifyConsistency(normalized.entries, text)
  if violations.length > 0 && attempt === 0:
    consistencyFeedback = violations
    continue  // 带违例反馈重试一次
  if violations.length > 0:
    // 重试后仍不一致：标注让用户核对
    for entry of entries:
      entry.warnings.push(...violations)
      entry.needsReview = true
      entry.confidence = min(confidence, 0.5)

  entries = normalized.entries.slice(0, maxEntries)
  return {
    ok: true, intent, reply, entries,
    truncated: total > maxEntries,
    remaining: max(0, total - maxEntries),
    failed: null, rawText: text
  }

return failureOutcome(text, lastFailure)
```

**`failureOutcome` 的 reply 文案**：

- `timeout` → 「整理超时了，已保留你的原文，可以手动新建或稍后重试。」
- `llm_error` → 「整理失败，已保留你的原文，可以手动新建或稍后重试。」
- `non_json` → 「没能整理成记录，已保留你的原文，可以手动新建。」

#### 6.5.3 重试消息构造 `retryMessages`

（[extractor.ts L525-538](file:///d:/project/ai_study/apps/server/src/services/extract/extractor.ts#L525-L538)）

- 有 `consistencyFeedback`：追加「（注意：上一次输出与原文不一致——{违例}。请严格按原文拆分与命名，只输出 JSON。）」
- 无非 JSON：追加「（注意：上一次输出不是合法 JSON。请只输出 JSON 对象，不要解释，不要代码围栏。）」

追加方式：替换最后一条 user 消息的 content，在末尾加 `\n\n{note}`。

#### 6.5.4 条目规范化 `buildEntry` 校正链

（[extractor.ts L265-419](file:///d:/project/ai_study/apps/server/src/services/extract/extractor.ts#L265-L419)）

这是抽取中最复杂的函数，把模型输出的原始 JSON 转成可信的结构化条目。逐步流程：

**① 基础字段**

- `title`：模型给的 title，没有则 `deriveTitle(content)`（取 content 前 30 字）
- `type`：模型给的 type，必须是 schedule/plan/fact/note，否则记 warning，按 note 处理
- `confidence`：模型给的，没有则 0.3（缺字段时）或 0.5；clamp 到 [0,1]
- 有缺失字段 → confidence = min(confidence, 0.3)，加 warning「字段不完整」

**② 时间解析**

- `start = parseIsoTime(timeRecord.start)`，`end = parseIsoTime(timeRecord.end)`
- 模型给了 start 但解析失败 → warning「开始时间格式无法识别」
- start 为 null 但有 `rawTimeText` → `parseRelativeTime(rawTimeText, nowMs)` 兜底（相对时间解析）
- 原文有星期（`parseStatedWeekday`）且模型给的日期星期对不上 → 用原文相对时间校正，加 warning「时间与原文不一致，已按原文校正」

**③ 重复规则**

- `recurrenceCue = /每|隔\s*[一二两三四五六七八九十\d]/.test(sourceText + rawTimeText)`
- 模型给了 recurrence 但原文无重复线索 → 丢弃模型臆测，用 fallbackRecurrence，加 warning「原文未表达重复，已按单次事件处理」
- `normalizeRecurrence(recurrenceInput, nowMs, start)` 规范化
- 有 recurrence 但无 start → `firstRecurrenceDay(recurrence, nowMs)` 取首次发生
- start 与 recurrence 规则不一致 → `alignRecurrenceStart` 对齐到下一次

**④ 时间校验**

- `validateTimeRange(start, end, nowMs, { recurring })`：检查过去时间、起止颠倒等
- `type === 'schedule' && start === null` → 降级为 `plan`，加 warning「没有解析到具体时间，已降级为计划」

**⑤ 构建 time 对象**（start !== null 时）

```ts
time = {
  raw: rawTimeText || formatDateTime(start),
  start,
  end,
  confidence: clamp01(timeConfidence ?? confidence),
  startText: formatDateTime(start),
  endText: end ? formatDateTime(end) : null,
}
```

**⑥ needsReview 判断**

```ts
needsReview =
  confidence < 0.6 ||
  warnings.some((w) =>
    [
      '不完整',
      '已过去',
      '未指定',
      '未说明',
      '不够精确',
      '不确定',
      '无法识别',
      '降级',
      '暂不支持',
    ].some((h) => w.includes(h)),
  )
```

> **关键**：只有「不确定」类提醒才触发 needsReview；确定性校正（如按原文对齐时间）不打扰用户。

#### 6.5.5 一致性校验 `verifyConsistency`

（[extractor.ts L470-496](file:///d:/project/ai_study/apps/server/src/services/extract/extractor.ts#L470-L496)）

只在 `mode === 'conversation'` 时执行。

**覆盖检查**：

- `TIME_MENTION_RE = /(?:星期|周)[一二三四五六日天]|大后天|后天|明天|今晚|周末/g`
- 原文中每个时间词必须出现在某条目的 `time.raw / title / content` 中
- 遗漏 → `遗漏：原文的「明天」没有对应条目`

**忠实检查**：

- `INVENTED_TIME_RE = /(?:每|隔)\s*[\d天周月年晚]|(?:星期|周)[一二三四五六日天]|大后天|后天|明天|今晚|周末/g`
- 条目的 title/content 中不能出现原文没有的时间/重复词
- 臆造 → `「标题」包含原文没有的信息：每周`

#### 6.5.6 意图判别规则

`normalizeExtractResponse` 中（[extractor.ts L435-440](file:///d:/project/ai_study/apps/server/src/services/extract/extractor.ts#L435-L440)）：

- 模型给的 intent 必须是 record/query/chat，否则默认 chat
- **有抽取结果时，intent 一律视为 record**（先抽取再回答）

Prompt 中的判别规则：

- 疑问句（含「什么/怎么/为什么/哪些/哪个/多少/如何/是否/有没有」）→ query
- 纯寒暄 → chat
- 含时间/自我描述/未来意图 → record
- 同时含提问与陈述 → record，并在 reply 中回答问题

#### 6.5.7 文档抽取 documentExtractor

**文件**：[`services/extract/documentExtractor.ts`](file:///d:/project/ai_study/apps/server/src/services/extract/documentExtractor.ts)

**常量**：`MAX_DOC_CHUNKS = 100`，`DOC_CHUNK_BATCH_SIZE = 5`，`MAX_DOC_ENTRIES = 10`

**`extractDocumentChunks(params)` 逐步流程**（[documentExtractor.ts L86-126](file:///d:/project/ai_study/apps/server/src/services/extract/documentExtractor.ts#L86-L126)）：

```
for batch of groupChunks(chunks, 5):  // 每 5 块一批
  text = buildBatchText(batch)  // 【第 1 块】\n内容\n\n---\n\n【第 2 块】...
  outcome = extractEntries({ text, mode: 'document', maxEntries: 100, now, timezone, existingEntries })

  if !outcome.ok:
    failedChunks += batch.length
    continue

  succeededChunkIds.push(...batch.ids)
  collected.push(...outcome.entries)

unique = dedupeCandidates(collected)  // 按 type|title|content 去重
entries = unique.slice(0, 10)
return {
  entries, truncated: unique.length > 10,
  remaining: max(0, unique.length - 10),
  chunksProcessed: succeededChunkIds.length,
  failedChunks, succeededChunkIds
}
```

> **关键**：文档模式 `mode='document'` 不做一致性校验（文档内容本身可能就是概括性的）；批次失败不中断，只累加 `failedChunks`。

---

### 6.6 成本与预算控制

**文件**：[`services/costTracker.ts`](file:///d:/project/ai_study/apps/server/src/services/costTracker.ts)、[`services/llm/pricing.ts`](file:///d:/project/ai_study/apps/server/src/services/llm/pricing.ts)、[`config/models.json`](file:///d:/project/ai_study/apps/server/config/models.json)

#### 6.6.1 架构

```
model.ts / embeddingGateway.ts 调用完 AI
  → costTracker.track(usageInfo)   // emit('usage', info)
  → 监听 'usage' 事件 → 异步入库 ai_usage_logs
  → checkDailyBudget(info)          // 检查日预算
```

**设计原则**：非阻塞（异步）、容错（写入失败只 warn 不 throw）、统一入口。

#### 6.6.2 用量入库

（[costTracker.ts L81-117](file:///d:/project/ai_study/apps/server/src/services/costTracker.ts#L81-L117)）

```
1. cost = estimateCostYuan(provider, model, promptTokens, completionTokens)
2. INSERT INTO ai_usage_logs {
     id, feature, model, provider,
     prompt_tokens, completion_tokens, total_tokens,
     cost_ms, cost, user_id, session_id, metadata, created_at
   }
3. checkDailyBudget(info)
```

#### 6.6.3 日预算检查 `checkDailyBudget`

（[costTracker.ts L124-171](file:///d:/project/ai_study/apps/server/src/services/costTracker.ts#L124-L171)）

```
1. DAILY_TOKEN_BUDGET 未配置 → return
2. 60s 频率限制（lastBudgetCheck）
3. startOfDay = 今天 00:00
4. SELECT COALESCE(SUM(total_tokens), 0) FROM ai_usage_logs WHERE created_at >= startOfDay
5. dailyTotal >= dailyBudget:
     - emit('budget_warning', { dailyTotalTokens, dailyBudgetTokens, usagePct, at })
   dailyTotal >= dailyBudget * 0.8:
     - warn 日志（接近阈值）
```

> **注意**：日预算只 emit 警告事件，不阻断调用。真正的强制降级在月度预算（`applyBudgetCircuit`）。

#### 6.6.4 月度预算 `getMonthCost` / `checkMonthlyBudget`

（[costTracker.ts L310-351](file:///d:/project/ai_study/apps/server/src/services/costTracker.ts#L310-L351)）

```
monthStart = 本月 1 号 00:00
SELECT COALESCE(SUM(cost), 0) FROM ai_usage_logs WHERE created_at >= monthStart
costYuan = 累计金额
budgetYuan = MONTHLY_COST_BUDGET（默认 10）
pct = costYuan / budgetYuan * 100
return { costYuan, budgetYuan, pct, blocked: pct>=100, warning: pct>=80 }
```

`checkMonthlyBudget` 有 60s 缓存（`monthCache`），避免每次 LLM 调用都查库。

**熔断逻辑**（在 `applyBudgetCircuit` 中）：付费模型 + `blocked=true` → 强制降级为默认免费模型。

#### 6.6.5 单价表

`config/models.json` 定义各模型的输入/输出单价（元/1M tokens）：

| 模型        | 输入 | 输出 | 免费 |
| ----------- | ---- | ---- | ---- |
| glm-4-flash | 0    | 0    | ✅   |
| glm-4-air   | 0.5  | 0.5  | ❌   |
| glm-4-airx  | 5    | 5    | ❌   |
| glm-4-plus  | 50   | 50   | ❌   |
| embedding-3 | 0    | 0    | ✅   |

`isFreeModel(provider, model)` 判断是否免费模型，免费模型跳过预算检查。

---

### 6.7 路由入口汇总

#### 6.7.1 问答主路由 POST /api/chat

**文件**：[`routes/chat.ts`](file:///d:/project/ai_study/apps/server/src/routes/chat.ts)

**逐步流程**（[chat.ts L47-152](file:///d:/project/ai_study/apps/server/src/routes/chat.ts#L47-L152)）：

```
1. validate body: { message (1-5000字), sessionId?, libraryId='default' }
2. timezone = getLocalTimezone()
3. 如果传了 sessionId:
     SELECT id FROM sessions WHERE id = sessionId LIMIT 1
     不存在 → 404 SESSION_NOT_FOUND
4. 取历史（最近 12 条，倒序取再 reverse）:
     SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 12
     只保留 user/assistant
5. search = searchAll({ query: message, libraryId, timezone })
6. answer = generateAnswer({ query: message, search, history, timezone })
7. 如果有 sessionId:
     INSERT messages (user 消息 + assistant 消息)
     assistant 消息的 citations = answer.citations（快照）
     assistant 消息的 metadata = JSON.stringify({ missing, degraded, degradedReason })
     UPDATE sessions SET updated_at = now WHERE id = sessionId
8. res.json({ ok, reply, citations, missing, degraded, degradedReason, empty, general, embeddingMock, sessionId, userMessageId, assistantMessageId })
```

> **关键**：消息持久化在同一次请求内完成（user + assistant 一起 insert），assistant 的 `createdAt` 比 user 晚 1ms。

#### 6.7.2 抽取路由 POST /api/extract

**文件**：[`routes/extract.ts`](file:///d:/project/ai_study/apps/server/src/routes/extract.ts)

**逐步流程**（[extract.ts L37-88](file:///d:/project/ai_study/apps/server/src/routes/extract.ts#L37-L88)）：

```
1. validate body: { text (1-5000字), sessionId?, libraryId='default' }
2. 读已有条目（判重 + Prompt 参考）:
     SELECT * FROM entries WHERE library_id=? AND status='active' ORDER BY updated_at DESC LIMIT 50
3. related = pickRelated(text, rows)  // 按相关度排序
4. promptEntries = related.map(row => ({ type, title, content, timeText: rowTimeText(row) }))
5. outcome = extractEntries({ text, now, timezone, existingEntries: promptEntries })
6. entries = buildEntryCards(outcome.entries, rows.map(rowToExisting), now, timezone)
7. res.json({ ...outcome, entries, source: { sessionId, libraryId } })
```

> 本接口**只做抽取与提示，不写库**；用户确认后走 `POST /api/entries`。

#### 6.7.3 文档上传路由 POST /api/documents/upload

**文件**：[`routes/documents.ts`](file:///d:/project/ai_study/apps/server/src/routes/documents.ts)

**逐步流程**（[documents.ts L96-165](file:///d:/project/ai_study/apps/server/src/routes/documents.ts#L96-L165)）：

```
1. multer 处理文件上传:
     - dest: uploads/
     - fileSize: 10MB
     - fileFilter: 中文名 latin1→utf8 转码，校验扩展名
2. INSERT documents { id, name, size, mime_type, storage_path, status:'processing', chunk_count:0 }
3. 立即返回 { id, name, status:'processing' }（不等待解析）
4. 后台异步（IIFE）:
     try:
       text = extractTextFromFile(path, originalname)
       chunks = splitStructured(text)
       embeddings = getEmbeddings(chunks.map(c => c.content))
       INSERT chunks (每个 chunk 的 content, chunk_index, embedding JSON)
       UPDATE documents SET status='ready', chunk_count=chunks.length
     catch:
       UPDATE documents SET status='failed'
```

> **关键**：解析在后台异步执行，前端轮询 `GET /api/documents` 直到 status 变为 ready/failed。

#### 6.7.4 文档抽取路由 POST /api/documents/:id/extract

（[documents.ts L180-293](file:///d:/project/ai_study/apps/server/src/routes/documents.ts#L180-L293)）

```
1. 校验 docId 存在且未删除，status='ready'
2. 读 chunks（可选 chunkIds 过滤，按 chunkIndex 排序）
3. chunks 为空 → 400 NO_CHUNKS
4. chunks > 100 → 400 TOO_MANY_CHUNKS
5. alreadyExtracted = 所有 chunk.extracted_at !== null
6. 读已有条目（判重参考），pickRelated 取相关
7. result = extractDocumentChunks({ chunks, nowMs, timezone, existingEntries })
8. 标记成功抽取的 chunk: UPDATE chunks SET extracted_at = now WHERE id IN succeededChunkIds
9. entries = buildEntryCards(result.entries, existing, nowMs, timezone)
10. res.json({ ok, entries, truncated, remaining, totalChunks, chunksProcessed, failedChunks, alreadyExtracted, source })
```

#### 6.7.5 路由总表

| 路由                         | 方法 | 用途                               | 是否走 AI |
| ---------------------------- | ---- | ---------------------------------- | --------- |
| `/api/chat`                  | POST | **问答主链路**：检索 + 生成 + 落库 | ✅        |
| `/api/chat/completions`      | POST | LLM 纯代理（流式 SSE）             | ✅        |
| `/api/extract`               | POST | 抽取意图 + 结构化（不写库）        | ✅        |
| `/api/documents/upload`      | POST | 上传文档，后台异步解析+分块+向量化 | ✅        |
| `/api/documents/:id/extract` | POST | 文档块抽取为记录                   | ✅        |
| `/api/kb/query`              | POST | 旧版 RAG 问答（全量 cosine）       | ✅        |
| `/api/rag/query`             | POST | 旧版 RAG 问答（RRF）               | ✅        |
| `/api/rag/documents`         | POST | 旧版文档上传（同步灌向量）         | ✅        |
| `/api/rag/documents/url`     | POST | URL 导入                           | ✅        |
| `/api/search`                | POST | 检索调试接口                       | ✅        |
| `/api/cost/*`                | GET  | 成本/预算/降级状态查询             | ❌        |

> ⚠️ 存在**两套文档链路**：新 `/api/documents/*`（异步 + 轮询）和旧 `/api/rag/documents*`（同步），最终落同一张表但反馈语义不同。

---

## 7. 前端 AI 交互详解

### 7.1 对话主链路 chat.vue

**文件**：[`pages/chat.vue`](file:///d:/project/ai_study/apps/generator/pages/chat.vue)

#### 7.1.1 意图路由（前端层）

前端只做一层**粗筛**，真正的意图判别在后端 `/api/extract`。

（[chat.vue L786-793](file:///d:/project/ai_study/apps/generator/pages/chat.vue#L786-L793)、[chat.vue L830-833](file:///d:/project/ai_study/apps/generator/pages/chat.vue#L830-L833)）

```
输入文本
  │
  ├─ recordMode === true（「记一下」开关开启）
  │    → 抽取路：POST /api/extract
  │
  ├─ looksLikeStorage(text) === true（命中关键词正则）
  │    → 抽取路：POST /api/extract
  │
  └─ 否则
       → 问答路：POST /api/chat
```

关键词正则：`/记住|帮我记|记一下|记下来|记一条|记录一下|存一下|存一条|提醒我|别忘了|备忘|收藏一下|加个日程|帮我安排/`

> **设计理由**：默认问答是安全选择——把问题误判成存储会生成空卡片，反过来只是少一次主动整理。

#### 7.1.2 问答路 `askAI(text, sid)`

（[chat.vue L795-815](file:///d:/project/ai_study/apps/generator/pages/chat.vue#L795-L815)）

```
1. push assistant { loading: true }
2. placeholder = messages[messages.length - 1]  // 必须取回响应式代理
3. try:
     answer = apiPost('/api/chat', { message: text, sessionId: sid }, 90_000)
     placeholder.loading = false
     placeholder.content = answer.reply
     placeholder.citations = answer.citations
     placeholder.missing = answer.missing
     placeholder.degraded = answer.degraded
     placeholder.general = answer.general
   catch:
     placeholder.loading = false
     placeholder.error = error.message
4. scrollToBottom()
```

> **关键细节**：`messages.value.push(obj)` 后直接改 `obj.loading=false` 不会触发视图更新（Vue 响应式代理问题）。必须 `const placeholder = messages.value[messages.value.length - 1]` 取回代理再改。

#### 7.1.3 抽取路 `send()` 中的抽取分支

（[chat.vue L835-871](file:///d:/project/ai_study/apps/generator/pages/chat.vue#L835-L871)）

```
1. push pending { loading: true }
2. extracted = apiPost('/api/extract', { text, sessionId: sid }, 75_000)
3. finally: messages = messages.filter(m => m.id !== pending.id)  // 移除加载占位

4. if extracted.intent === 'record' && extracted.entries.length > 0:
     persistMessage(user, text)
     persistMessage(assistant, '整理出 N 条记录，请确认入库')
     push assistant { content: summary, cards: extracted.entries.map(...) }
   elif extracted.failed:
     push assistant { content: extracted.reply }  // 降级话术，不二次问答
   else:
     askAI(text, sid)  // intent=query/chat → 回落问答
```

> **关键**：抽取失败时直接展示后端降级话术，不再二次调用问答（避免重复等待）。

#### 7.1.4 消息状态机

```
发送
  ├─ push(user 消息)
  │
  ├─ 问答路:
  │   push(assistant { loading: true })
  │     ├─ 成功 → loading=false, content/citations/missing/degraded/general
  │     └─ 失败 → loading=false, error
  │
  └─ 抽取路:
      push(assistant { loading: true })
        ├─ intent=record + 有 entries → 移除占位，push assistant { cards }
        ├─ failed → 移除占位，push assistant { content: reply }
        └─ 其他 → 移除占位，askAI()
```

#### 7.1.5 会话与持久化

- `ensureSession(title)`：无 sessionId 时 `POST /api/sessions` 创建，title 取输入前 20 字
- `persistMessage(sid, role, content)`：`POST /api/sessions/:sid/messages`
- `loadLatestSession()`：`onMounted` 时拉取最近会话，恢复消息列表（解析 metadata 中的 missing/degraded）

---

### 7.2 抽取卡片与条目编辑

#### 7.2.1 EntryCard.vue

抽取结果的确认卡片，三态：`pending` → `confirmed` / `ignored`，编辑态 `editing`。

**展示内容**：标题、类型、时间、重复规则、置信度、去重/冲突提示

**操作**：

- 确认 → `POST /api/entries` 入库
- 编辑 → 进入编辑态
- 忽略 → `state = 'ignored'`

**`confirmAll(message)`**（[chat.vue L910-926](file:///d:/project/ai_study/apps/generator/pages/chat.vue#L910-L926)）：

```
pending = cards.filter(state === 'pending')
for item of pending:
  payload = { type, title, content, status:'active', startAt, endAt, recurrence, sourceType:'conversation', confidence }
  confirmCard(message, item, payload)
```

> ⚠️ **已知问题**：`sourceType` 硬编码为 `'conversation'`，文档提取来源会被错误标记。

#### 7.2.2 EntryEditor.vue

已入库条目的编辑弹窗，用于日程/规划页。`PATCH /api/entries/:id`。

---

### 7.3 文档上传与提取

#### 7.3.1 对话页上传（chat.vue）

（[chat.vue L702-762](file:///d:/project/ai_study/apps/generator/pages/chat.vue#L702-L762)）

```
for file of files:
  if !isSupported(name): push error, continue

  sid = ensureSession(file.name)
  push upload chip { status:'uploading' }
  push user message { attachment }

  form = FormData(); form.append('file', file)
  created = apiUpload('/api/documents/upload', form)
  doc = waitForDocument(created.id)  // 轮询

  chip.status = doc?.status === 'failed' ? 'error' : 'done'
  persistMessage(user, `上传文档：${file.name}`)

  ack = doc?.status === 'ready' ? '解析成功' : doc?.status === 'failed' ? '解析失败' : '还在解析中'
  push assistant { content: ack }
  persistMessage(assistant, ack)
```

**`waitForDocument(id)` 轮询**（[chat.vue L687-700](file:///d:/project/ai_study/apps/generator/pages/chat.vue#L687-L700)）：

- 最多 25 次，每次间隔 700ms（约 17.5s）
- 每次 `GET /api/documents` 找目标文档
- status !== 'processing' → 返回
- 超时返回 null

#### 7.3.2 文档页上传（documents.vue）

```
上传 → POST /api/documents/upload (FormData, 10MB)
     → 立即返回 { id, status: 'processing' }
     → 前端轮询 GET /api/documents (30次×2s ≈ 60s)
     → status: ready/failed
```

解析在后端**后台异步**执行：`extractTextFromFile` → `splitStructured` → `getEmbeddings` → 写 chunks。

#### 7.3.3 提取为记录

```
POST /api/documents/:id/extract
→ { entries, truncated, remaining, totalChunks, chunksProcessed, failedChunks, alreadyExtracted, source }
```

每 5 块一批调 LLM，最多返回 10 条，其余用 `remaining` 提示。

> ⚠️ 前端 `DocExtractResponse` 类型未声明 `truncated/remaining/failedChunks`，这些信息目前不可见。

---

### 7.4 引用展示

- **CitationList.vue**：回答底部「依据」列表，按 entry/chunk/summary 分类
- **CitationDrawer.vue**：右侧 360px 抽屉，展示被引用条目的完整内容

**引用点击**（[chat.vue L593-599](file:///d:/project/ai_study/apps/generator/pages/chat.vue#L593-L599)）：

```
onAnswerClick(event):
  num = citationFromEvent(event)  // 从事件目标解析 [n] 编号
  message = messages.find(m => m.citations?.some(c => c.num === num))
  citation = message?.citations?.find(c => c.num === num)
  if citation: activeCitation = citation  // 打开抽屉
```

引用编号 `[n]` 通过事件委托绑定，点击在 `citations` 数组中查找对应条目。

---

## 8. 配置项速查

### 环境变量

| 变量                         | 默认值                                 | 说明                          |
| ---------------------------- | -------------------------------------- | ----------------------------- |
| `AI_API_URL`                 | `https://open.bigmodel.cn/api/paas/v4` | LLM 网关                      |
| `AI_API_KEY`                 | `''`                                   | API Key（仅后端读取）         |
| `AI_MODEL`                   | `glm-4-flash`                          | 默认模型                      |
| `AI_MODEL_LARGE`             | `''`                                   | 大档模型                      |
| `AI_TIMEOUT_MS`              | `60000`                                | LLM 单次超时                  |
| `EMBEDDING_MODEL`            | `embedding-3`                          | Embedding 模型                |
| `EMBEDDING_TIMEOUT_MS`       | `15000`                                | Embedding 超时                |
| `EMBEDDING_CONCURRENCY`      | `4`                                    | Embedding 并发数              |
| `ENABLE_MOCK_EMBEDDING`      | 未设                                   | `1` 强制哈希向量降级          |
| `DISABLE_EMBEDDING_FALLBACK` | 未设                                   | `1` 时 embedding 失败直接抛错 |
| `DAILY_TOKEN_BUDGET`         | 未设                                   | 日 token 预算                 |
| `MONTHLY_COST_BUDGET`        | `10`                                   | 月度费用预算（元）            |
| `EXTRACT_TIMEOUT_MS`         | `25000`                                | 抽取超时                      |
| `DB_PATH`                    | `./data/knowledge.db`                  | SQLite 路径                   |

### 关键常量

| 常量                                | 值                  | 位置                               |
| ----------------------------------- | ------------------- | ---------------------------------- |
| EMBEDDING_DIM                       | 1536                | embeddingGateway.ts                |
| BM25 K1 / B                         | 1.2 / 0.75          | bm25.ts                            |
| RRF k                               | 60                  | index.ts, entrySearch.ts           |
| 通道权重 时间/条目/文档             | 1.3 / 1.0 / 0.8     | merge.ts                           |
| 结果上限 条目/文档/合计             | 10 / 5 / 15         | merge.ts                           |
| 上下文预算 条目/片段/总计           | 160 / 400 / 3200 字 | context.ts                         |
| 回答超时 / 历史上限                 | 30s / 12 条         | generate.ts                        |
| 查询理解超时                        | 8s                  | queryUnderstanding.ts              |
| cosine 下限                         | 0.35                | entrySearch.ts, docChannel.ts      |
| 分块 目标/最小/重叠/硬上限/最大块数 | 600/80/80/900/500   | splitterPure.ts                    |
| 抽取上限 对话/文档                  | 5 / 10              | extractor.ts, documentExtractor.ts |
| 上传限制                            | 10MB                | documents.ts                       |
| 熔断 失败次数/开路时间              | 3 / 30s             | circuitBreaker.ts                  |

---

## 9. 评测体系

**目录**：[`tests/eval/`](file:///d:/project/ai_study/apps/server/tests/eval)

### 用例

`cases.json` 包含 20 条用例，覆盖 6 类：

| 类别     | 数量 | 测试点                                |
| -------- | ---- | ------------------------------------- |
| time     | 5    | 时间窗口检索命中                      |
| plan     | 4    | 规划类检索                            |
| fact     | 4    | 事实类检索                            |
| miss     | 3    | 无命中时正确说"没有"                  |
| conflict | 2    | 冲突信息如实呈现                      |
| degraded | 2    | embedding 降级（hash 向量）下仍能命中 |

种子时间用相对偏移（`offsetDays` / `weekday`）保证用例不过期。

### 指标与门禁

| 指标         | 口径                     | 门禁    |
| ------------ | ------------------------ | ------- |
| 命中率       | 期望引用全部出现在回答中 | ≥ 80%   |
| 引用准确率   | LLM 裁判判定无引用错误   | ≥ 80%   |
| 幻觉率       | LLM 裁判判定无来源外断言 | **= 0** |
| 无命中识别率 | 无命中用例正确回答"没有" | 100%    |

### 运行

```bash
pnpm eval                    # 全量
pnpm eval -- --no-judge      # 跳过 LLM 裁判
pnpm eval -- --only=time     # 只跑某类
```

任一指标不达标 → 退出码 1（可挂 CI）。

---

## 10. 已知问题与改进方向

### 架构性问题

| #   | 问题                                                         | 影响                       | 建议                                           |
| --- | ------------------------------------------------------------ | -------------------------- | ---------------------------------------------- |
| 1   | 两套文档链路并行（`/api/documents/*` 与 `/api/rag/*`）       | 反馈语义不一致，维护成本高 | 统一到 `/api/documents/*`，删除旧 `/api/rag/*` |
| 2   | 旧 RAG 路由 `/api/kb/query`、`/api/rag/query` 未走 searchAll | 检索质量与主链路不一致     | 合并到 `/api/chat` 的检索逻辑                  |
| 3   | 向量检索全表扫描，无 ANN 索引                                | 数据量大时性能差           | 引入 sqlite-vec 或 pgvector                    |
| 4   | `POST /api/chat` 未接熔断                                    | 供应商故障时不会快速失败   | 纳入 `AI_ROUTE_PATHS`                          |
| 5   | `isMockMode()` 全局粘滞                                      | API 恢复后仍跳过向量路     | 加 TTL 或定期探测恢复                          |

### 功能缺陷

| #   | 问题                                                   | 建议                               |
| --- | ------------------------------------------------------ | ---------------------------------- |
| 6   | `maxTokens` 未生效                                     | 请求体加 `max_tokens`              |
| 7   | 429 重试不对称（流式不重试）                           | 流式也加重试                       |
| 8   | `ChatResponse.usage` 永远为空                          | 透传 usage                         |
| 9   | 抽取失败路径不持久化用户原文                           | 失败时也写库                       |
| 10  | `EntryCard` 硬编码 `sourceType:'conversation'`         | 文档提取改为 `'document'`          |
| 11  | `not_found` 降级提示错位（显示"超时或失败"）           | 区分 `degradedReason` 渲染不同文案 |
| 12  | 文档抽取前端超时(90s)可能早于后端最坏耗时              | 调大或改为异步轮询                 |
| 13  | 文档上传后台任务无重试/无并发上限                      | 加重试与队列                       |
| 14  | 未知模型不计入月度金额累计                             | 未知模型按保守单价估算             |
| 15  | `pricing.ts` 相对路径在 dist 下可能找不到 models.json  | 构建时拷贝 config 或用绝对路径     |
| 16  | 文档抽取 `truncated/remaining/failedChunks` 前端未消费 | 前端展示剩余数量与失败块           |
| 17  | 抽取路径 `intent=query` 回落问答时，用户原文未持久化   | 回落前先写库                       |

---

> **文档版本**：基于 `feat/architecture-v5` 分支梳理。
> **维护说明**：重构时请同步更新本文档对应章节。每个模块的流程已细化到函数级与判断分支级，新增/修改逻辑时请同步更新对应逐步流程。
