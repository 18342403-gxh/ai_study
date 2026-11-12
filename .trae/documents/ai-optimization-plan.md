# 个人知识库 V5 — AI 能力技术优化方案

> 本文档基于 [`ai-capabilities-overview.md`](./ai-capabilities-overview.md) 的现状梳理，针对 5 个结构性问题提出修复设计，并规划 6 项技术升级的落地路径。**本阶段只输出方案，不修改代码。**
>
> 核心结论：当前最严重的不是「模型不够强」，而是 **mock 粘滞让检索无声退化、全表扫描让检索随数据增长变慢、双链路让任何优化只覆盖一半入口**。先堵住这三个结构性漏水点，再叠 sqlite-vec、约束解码和 rerank，最后才考虑 Agentic RAG 这类控制层升级。

---

## 目录

- [0. 方案概述](#0-方案概述)
- [1. 问题诊断与修复设计（按优先级）](#1-问题诊断与修复设计按优先级)
  - [1.1 P0：isMockMode 全局粘滞修复](#11-p0ismockmode-全局粘滞修复)
  - [1.2 P0：抽取失败用户原文持久化](#12-p0抽取失败用户原文持久化)
  - [1.3 P1：向量检索全表扫描 → sqlite-vec](#13-p1向量检索全表扫描--sqlite-vec)
  - [1.4 P1：抽取结构化输出 → Function Calling](#14-p1抽取结构化输出--function-calling)
  - [1.5 P2：双文档链路 + 旧 RAG 路由收敛](#15-p2双文档链路--旧-rag-路由收敛)
  - [1.6 P2：上下文硬截断 → rerank + 压缩](#16-p2上下文硬截断--rerank--压缩)
  - [1.7 P2：多轮对话查询凝练（Query Condensation）](#17-p2多轮对话查询凝练query-condensation)
- [2. 新技术引入设计](#2-新技术引入设计)
  - [2.1 Function Calling / 约束解码](#21-function-calling--约束解码)
  - [2.2 轻量重排序 Reranker](#22-轻量重排序-reranker)
  - [2.3 sqlite-vec 向量索引](#23-sqlite-vec-向量索引)
  - [2.4 Ragas 评估流水线](#24-ragas-评估流水线)
  - [2.5 Agentic RAG（中期方向）](#25-agentic-rag中期方向)
  - [2.6 记忆管理与知识编译（长期方向）](#26-记忆管理与知识编译长期方向)
- [3. 分阶段执行计划](#3-分阶段执行计划)
- [4. 风险与回滚策略](#4-风险与回滚策略)
- [5. 验收指标](#5-验收指标)

---

## 0. 方案概述

### 0.1 现状基线

当前 AI 能力链路已跑通：对话问答（检索 + 生成 + 引用）、自然语言抽取入库、文档上传解析。但存在 **6 个结构性问题**，其中 2 个是 P0（检索无声退化 + 数据丢失风险），2 个是 P1（性能瓶颈 + 可靠性不足），2 个是 P2（架构慢性出血 + 上下文硬截断），另有多轮对话查询凝练的空白待补。

### 0.2 优化目标

| 维度       | 现状                               | 目标                                                               |
| ---------- | ---------------------------------- | ------------------------------------------------------------------ |
| 检索自愈   | embedding 失败后永久 mock          | 5 分钟 TTL + 主动探测，自动恢复                                    |
| 检索性能   | 全表扫描 + JSON.parse              | sqlite-vec KNN，千级 chunk < 50ms                                  |
| 抽取可靠性 | prompt 要 JSON + 重试              | Function Calling，结构失败率 → 0；语义失败率（一致性违例）单独度量 |
| 数据安全   | 抽取失败原文丢失                   | 失败时原文落库，可手动恢复                                         |
| 架构一致性 | 双文档链路 + 旧 RAG 绕过 searchAll | 统一入口，所有检索走 searchAll                                     |
| 上下文质量 | 硬截断 3200 字                     | rerank + query-conditioned 压缩，按质量注入                        |

### 0.3 执行原则

1. **先止血后升级**：P0 问题不修，任何算法优化都可能被无声退化抵消
2. **最小侵入**：每个改造保留原路径作为 fallback，可通过环境变量开关回退
3. **可观测**：每次降级/恢复都有日志和可查询的状态，前端有感知
4. **渐进式**：新技术先以「旁路 + 对比」方式接入，验证收益后再替换主路径

---

## 1. 问题诊断与修复设计（按优先级）

### 1.1 P0：isMockMode 全局粘滞修复

#### 1.1.1 问题诊断

**代码位置**：[`services/rag/embeddingGateway.ts`](file:///d:/project/ai_study/apps/server/src/services/rag/embeddingGateway.ts)

`mockModeActivated` 是模块级单例变量（L97）：

```ts
let mockModeActivated = false // 一旦置 true，进程生命周期内永不重置
```

触发条件（L166-172）：任何一次 `getEmbedding` 调用失败（超时/429/网络错）→ `mockModeActivated = true`。

`isMockMode()`（L243-246）直接返回 `forceMock || mockModeActivated`，**没有 TTL、没有探测恢复机制**。

**影响链**：

```
embedding 一次失败
  → mockModeActivated = true
  → entrySearch 跳过向量通道（entrySearch.ts L95-97）
  → docChannel 向量分不可信（docChannel.ts L33）
  → 所有语义检索只剩 BM25
  → 检索质量断崖下降，前端 embeddingMock 仅展示无告警
```

#### 1.1.2 修复方案：TTL + 主动探测

**核心思路**：把「是否 mock」从「进程级永久标记」改为「带 TTL 的状态 + 每次调用前探测」。

**改造点**：

1. **给 mock 状态加 TTL**（默认 5 分钟，可配 `EMBEDDING_MOCK_TTL_MS`）：

   ```ts
   let mockUntil = 0 // mock 失效的时间戳，0 表示正常
   const isMockMode = () => Date.now() < mockUntil
   ```

2. **失败时设置 TTL 而非永久标记**：

   ```ts
   // catch 分支
   mockUntil = Date.now() + MOCK_TTL_MS
   ```

3. **TTL 过期后主动探测**：在 `getEmbedding` 入口判断：

   ```ts
   if (mockUntil && Date.now() >= mockUntil) {
     // 用短文本探测一次 API
     try {
       const probe = await fetchEmbedding('ping') // 短文本，成本极低
       mockUntil = 0 // 探测成功，清除 mock
       return probe
     } catch {
       mockUntil = Date.now() + MOCK_TTL_MS // 探测失败，续期
       return hashVector(text)
     }
   }
   ```

4. **成功时主动清除**：`getEmbedding` 成功后 `mockUntil = 0`（已有 `clearChatDegraded` 的先例）。

5. **可观测性**：
   - `isMockMode()` 状态通过 `/api/cost` 暴露给前端
   - mock 触发和恢复都打 `logger.info`（不是只打一次 warn）
   - 前端在 `embeddingMock=true` 时，在对话页顶部显示「语义检索降级中，5 分钟后自动重试」提示

#### 1.1.3 实现步骤

| 步骤 | 改动文件              | 内容                                                                           |
| ---- | --------------------- | ------------------------------------------------------------------------------ |
| 1    | `embeddingGateway.ts` | `mockModeActivated: boolean` → `mockUntil: number`；catch 中设 TTL；成功时清零 |
| 2    | `embeddingGateway.ts` | `getEmbedding` 入口加 TTL 过期探测逻辑                                         |
| 3    | `embeddingGateway.ts` | 新增 `EMBEDDING_MOCK_TTL_MS` 环境变量（默认 300000）                           |
| 4    | `routes/cost.ts`      | 暴露 `mockUntil` 时间戳，前端可算剩余时间                                      |
| 5    | `chat.vue`            | `embeddingMock=true` 时显示降级提示条                                          |
| 6    | 测试                  | 模拟 embedding 失败 → 验证 5 分钟后自动恢复                                    |

#### 1.1.4 验收标准

- 模拟 embedding API 失败后，`isMockMode()` 返回 true
- 5 分钟后下一次 `getEmbedding` 调用会探测真实 API
- 探测成功后 `isMockMode()` 返回 false，向量通道恢复
- 前端在 mock 期间有可见提示

#### 1.1.5 风险与回滚

- **风险**：探测调用如果也失败，会增加一次延迟（但只在 TTL 过期时发生，频率很低）
- **回滚**：`EMBEDDING_MOCK_TTL_MS=0` 可恢复永久 mock 行为（不推荐，仅用于紧急回滚）

---

### 1.2 P0：抽取失败用户原文持久化

#### 1.2.1 问题诊断

**代码位置**：[`services/extract/extractor.ts`](file:///d:/project/ai_study/apps/server/src/services/extract/extractor.ts) `failureOutcome`（L540-558）

抽取在 `non_json` 或 `llm_error` 重试后仍失败时，返回 `failureOutcome`：

```ts
return {
  ok: false,
  intent: 'chat',
  reply: '整理超时了，已保留你的原文...',  // 只是文案
  entries: [],
  rawText: text,  // 原文在响应里，但没写库
  ...
}
```

前端 `chat.vue`（L862-868）收到 `failed` 后只展示 `reply`，**没有把原文写入任何持久化位置**。用户关掉页面后原文彻底丢失。

#### 1.2.2 修复方案

**核心思路**：抽取失败时，把用户原文以 `draft` 状态写入 entries 表，标记 `needsReview=true`，用户可在日程/规划页看到并手动编辑确认。

**改造点**：

1. **路由层落库**：`routes/extract.ts` 在 `outcome.failed !== null` 时，`INSERT entries` 一条 `type='note'`、`status='draft'`、`content=text` 的记录，`source_type='conversation'`。

2. **返回 draftEntryId**：响应里加 `draftEntryId` 字段，前端可跳转到该条目编辑。

3. **前端提示**：抽取失败时提示「已保存为草稿，可在笔记页编辑」，并提供跳转链接。

#### 1.2.3 实现步骤

| 步骤 | 改动文件            | 内容                                                                |
| ---- | ------------------- | ------------------------------------------------------------------- |
| 1    | `routes/extract.ts` | `outcome.failed` 时 INSERT entries（draft 状态），返回 draftEntryId |
| 2    | `extractor.ts`      | `ExtractOutcome` 加可选 `draftEntryId` 字段                         |
| 3    | `chat.vue`          | 失败分支展示 draftEntryId 跳转链接                                  |
| 4    | 测试                | 抽取失败后验证 entries 表有 draft 记录                              |

#### 1.2.4 验收标准

- 抽取失败后，`entries` 表存在一条 `status='draft'` 的记录，content 为用户原文
- 前端展示「已保存为草稿」并可跳转编辑
- 正常抽取成功路径不受影响

---

### 1.3 P1：向量检索全表扫描 → sqlite-vec

#### 1.3.1 问题诊断

**代码位置**：[`services/rag/vectorStore.ts`](file:///d:/project/ai_study/apps/server/src/services/rag/vectorStore.ts) `similaritySearch`（L69-96）

当前实现：

```ts
const rows = await db.select().from(tables.chunks).where(isNotNull(embedding))
// 全量取出，逐行 JSON.parse，内存算 cosine
```

**瓶颈**：

- `chunks.embedding` 存的是 JSON 文本，每次查询要 `JSON.parse` 每个向量
- 无 ANN 索引，复杂度 O(N×D)（N=chunks 数，D=1536）
- 分块上限 500 块/文档，3 个文档就可能 1500 行，单次查询延迟可达数秒

#### 1.3.2 技术选型：sqlite-vec

**已验证**：

- npm `sqlite-vec`（asg017/sqlite-vec）提供预编译二进制，支持 Windows x64/ARM64
- 项目使用 `better-sqlite3`，支持 `db.loadExtension()` 加载扩展
- 项目已支持 PostgreSQL + pgvector（`db/index.ts` L285-354），sqlite-vec 是 SQLite 侧的对等方案

**关键实现细节**（避免踩坑）：

- sqlite-vec 的 `vec0` 虚拟表默认用 **L2 距离**，不能直接拿 `v.distance` 当 cosine
- 正确做法：用 `MATCH ? AND k = ?` 做候选裁剪，SELECT 里用 `vec_distance_cosine()` 算分数
- 或者：在写入前对向量做 L2 归一化，L2 距离最小等价于 cosine 最大

#### 1.3.3 修复方案

**核心思路**：在 `chunks` 表旁边建一个 `chunks_vec` 虚拟表，写入时双写，查询时走 vec0。

**改造点**：

1. **加载扩展**（`db/index.ts` `initSqlite`）：

   ```ts
   import sqliteVec from 'sqlite-vec'
   sqliteDb.loadExtension(sqliteVec.loadablePath)
   ```

2. **建 vec0 虚拟表**：

   ```sql
   CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
     chunk_id TEXT PRIMARY KEY,
     embedding FLOAT[1536]
   )
   ```

3. **写入时双写**（`documents.ts` 上传处理 + `vectorStore.addDocuments`）：

   ```ts
   // 写 chunks 表（保留，供内容回显）
   // 写 chunks_vec（供 KNN 查询）
   ```

4. **查询走 vec0**（`vectorStore.similaritySearch`）：

   ```sql
   SELECT v.chunk_id, vec_distance_cosine(v.embedding, ?) as score
   FROM chunks_vec v
   WHERE v.embedding MATCH ? AND v.k = ?
   ORDER BY score DESC
   LIMIT ?
   ```

5. **isMockMode 时保留 BM25 fallback**：mock 模式下不调向量查询，只走 BM25。

6. **entry_embeddings 同步迁移**：条目语义检索也走 vec0（建 `entries_vec` 表）。

#### 1.3.4 数据迁移

- 存量数据：启动时扫描 `chunks` 和 `entry_embeddings` 表，把 JSON embedding 写入 vec0 表（一次性，幂等）
- 新增 `migrate-vectors` 脚本，可手动重跑

#### 1.3.5 实现步骤

| 步骤 | 改动文件                         | 内容                                                |
| ---- | -------------------------------- | --------------------------------------------------- |
| 1    | `package.json`                   | 安装 `sqlite-vec`                                   |
| 2    | `db/index.ts`                    | `initSqlite` 中加载扩展 + 建 vec0 表 + 存量迁移     |
| 3    | `services/rag/vectorStore.ts`    | `similaritySearch` 改用 vec0 查询                   |
| 4    | `routes/documents.ts`            | 上传处理时双写 vec0                                 |
| 5    | `services/search/entrySearch.ts` | 向量路改用 vec0                                     |
| 6    | 测试                             | 千级 chunk 下查询延迟 < 100ms，结果与原 cosine 一致 |

#### 1.3.6 验收标准

- 1000 个 chunk 规模下，`similaritySearch` 延迟 < 100ms（原方案约 500ms-1s）
- 查询结果与原全表扫描 cosine 排序一致（top-10 重合率 ≥ 95%）
- isMockMode 时 BM25 路径正常

#### 1.3.7 风险与回滚

- **风险**：sqlite-vec 扩展在 Windows 上的加载兼容性（已验证有预编译包）
- **回滚**：`USE_SQLITE_VEC=0` 环境变量可切回全表扫描路径

---

### 1.4 P1：抽取结构化输出 → Function Calling

#### 1.4.1 问题诊断

**代码位置**：[`services/extract/extractor.ts`](file:///d:/project/ai_study/apps/server/src/services/extract/extractor.ts)

当前抽取可靠性依赖：

- `parseLooseJson`（L219-240）：尝试剥离 ```json 围栏、截取 `{...}`
- `retryMessages`（L525-538）：重试时在 user 消息末尾追加「请只输出 JSON」

**问题**：

- 这是 **prompt 层约束**，模型不遵守时没有硬性保证
- 重试一次后仍 non_json → `failureOutcome`，用户原文可能丢失（见 1.2）
- 一致性校验违例的重试也是 prompt 反馈，模型可能再次违例

#### 1.4.2 技术选型：Function Calling

**已验证**：智谱 GLM-4-Flash 支持 Function Calling（tools 参数）和结构化输出（[智谱文档](https://docs.bigmodel.cn/cn/guide/models/free/glm-4-flash-250414)）。

**优势**：

- schema 校验由 API 层完成，`tool_calls[0].function.arguments` 保证是合法 JSON
- schema-validity 高于 prompt-shaped JSON mode
- 保留模型的自由生成质量（不像约束解码那样限制 token）

**GLM 强制 tool_choice 不可靠（阻塞性约束，限定版本范围）**：2026 年工程实践已明确，通过 OpenAI 兼容接口暴露的 GLM 模型，对 `tool_choice="required"` 或指定具体函数名的支持是不完整的——DeepSeek / GLM / Kimi 等模型对 `tool_choice="required"` 或指定函数名的支持不完整，GLM 后端 cannot enforce `tool_choice 'required' or a named function`，建议发送 `auto` 或 `none`。

> **版本限定**：这个结论更适用于 **glm-4-flash**（当前默认模型）或通过某些 OpenAI 兼容网关暴露的场景。2026 年 11 月智谱迁移文档显示，**GLM-5.3 已支持流式工具调用**（`stream=True, tool_stream=True`），GLM-5 系列文档明确列出 `tool_choice` 的 `none / required / auto` 三种取值。当前默认 glm-4-flash 仍采用 auto + 强 prompt 基线，但在「模式探针」步骤中应增加版本探测：若检测到模型为 glm-4.5 以上或 glm-5.\*，可有条件地测试 `tool_choice: 'required'`，新版模型可能已支持。

这意味着：**GLM 可能根本不执行强制 tool_choice，直接退化为 auto 行为**。问题不是「强制 tool_choice 可能被 schema 约束抑制」，而是 GLM 不支持这个特性。

**约束税（Constraint Tax）补充说明**：即使在支持强制 tool_choice 的模型上，当 tool calling 和 JSON Schema 结构化输出约束同时启用时，grammar-based token masking 可能让 tool-call token 在解码时不可达，导致工具调用率归零。GLM 上由于强制 tool_choice 本身不生效，约束税的表现形式不同（退化为 auto），但本质问题仍需缓解。

**模式设计（以 `tool_choice: 'auto'` 为基线）**：

- **基线模式（生产首选）**：Function Calling + `tool_choice: 'auto'` + system prompt 强指令「你必须调用 `extract_entries` 工具，不要直接回复文本」。这是 GLM 上实际可行的最高可靠性配置。
- **备选模式**：JSON Mode（`response_format: { type: 'json_object' }`）+ schema 校验 + 带 schema 错误信息的修复调用（比盲重试可靠）。
- **强制 tool_choice 模式**：仅作为探针测试的对照项，不作为生产候选。

**约束税缓解策略 — Transparent Two-Pass Execution**：将「工具调用」和「schema 约束生成」解耦为两次独立调用：

1. 第一次调用：让模型决定是否调用工具、调用哪个（**不施加 JSON schema 约束**），避免 tool-call token 被 grammar mask 抑制
2. 第二次调用：在 tool result 回传后，再施加结构化输出约束生成最终内容

这比简单的「降级到 auto 或 JSON Mode」更精确地针对 Tool Suppression 的根因。可在基线模式（auto）工具触发率不达预期时启用。

在全量切换前必须做「模式探针」测试（见 1.4.4 步骤 0），对比基线模式与备选模式的结构合法率 × 内容正确率。

#### 1.4.3 修复方案

**核心思路**：把抽取从「发 system prompt 要求输出 JSON」改为「定义 `extract_entries` tool，读取 `tool_calls`」。

**改造点**：

1. **定义 tool schema**：

   ```ts
   const extractTool = {
     type: 'function',
     function: {
       name: 'extract_entries',
       description: '从用户文本中抽取结构化记录',
       parameters: {
         type: 'object',
         properties: {
           intent: { type: 'string', enum: ['record', 'query', 'chat'] },
           entries: {
             type: 'array',
             items: {
               /* ExtractedEntry schema */
             },
           },
           reply: { type: 'string' },
         },
         required: ['intent', 'entries', 'reply'],
       },
     },
   }
   ```

2. **请求体加 tools（基线模式）**：

   ```ts
   body: {
     model, messages,
     tools: [extractTool],
     tool_choice: 'auto'  // GLM 不支持强制指定函数名，用 auto + 强 prompt 指令
   }
   // system prompt 中追加：「你必须调用 extract_entries 工具来返回结构化结果，不要直接回复文本。」
   ```

3. **解析 tool_calls**：

   ```ts
   const args = JSON.parse(response.choices[0].message.tool_calls[0].function.arguments)
   const normalized = normalizeExtractResponse(args, nowMs, text)
   ```

4. **保留 retryMessages**：一致性校验违例仍可重试，但 non_json 不再需要重试。

5. **model.ts 改造**：`createChatModel` 支持 `tools` / `toolChoice` 参数，`invokeChat` 透传到请求体。

#### 1.4.4 实现步骤

| 步骤 | 改动文件                        | 内容                                                                                                                                        |
| ---- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | 新建测试脚本                    | **模式探针**：用 20-30 条真实抽取样本，对比：基线模式（auto + 强 prompt）vs 备选模式（JSON Mode），度量结构合法率 × 内容正确率 × 工具触发率 |
| 1    | `services/chain/model.ts`       | `ModelConfig` 加 `tools` / `toolChoice` / `responseFormat`；`postChat` 透传                                                                 |
| 2    | `services/extract/extractor.ts` | `buildExtractMessages` 改为返回 `{ messages, tools, responseFormat }`；主循环解析 tool_calls（无 tool_calls 时回退 JSON 内容）              |
| 3    | `services/extract/extractor.ts` | `retryMessages` 只用于一致性违例，去掉 non_json 分支                                                                                        |
| 4    | 测试                            | 验证基线模式的 tool_calls/JSON 可直接 parse，无需 parseLooseJson                                                                            |
| 5    | 降级                            | 若基线模式工具触发率 < 90%，启用 Transparent Two-Pass 或切到 JSON Mode                                                                      |

#### 1.4.5 验收标准

**结构失败率（schema 合法性）**：

- 抽取调用的 non_json 失败率从「偶发」降到 0（tool_calls 或 JSON Mode 保证 JSON 合法）

**语义失败率（内容与原文一致性）**：

- 一致性校验违例率（`verifyConsistency` 命中数 / 总抽取数）单独统计，目标 ≤ 10%
- 一致性违例的重试仍可正常工作
- **注意**：Function Calling 消除的是结构失败，不消除语义失败。`verifyConsistency` 仍然不可或缺。

**模式探针**：

- 基线模式（auto + 强 prompt）的工具调用触发率 ≥ 90%
- 若 < 90%，启用 Transparent Two-Pass Execution 或降级到 JSON Mode
- 强制 tool_choice 模式仅作对照，不进入生产

**性能**：

- 抽取耗时不增加（Function Calling 不比 JSON 输出慢）

---

### 1.5 P2：双文档链路 + 旧 RAG 路由收敛

#### 1.5.1 问题诊断

当前存在两套文档链路：

- **新链路**：`/api/documents/*`（异步上传 + 轮询，走 `searchAll` 三通道）
- **旧链路**：`/api/rag/documents*`（同步灌向量，`/api/rag/query` 走旧版全量 cosine，绕过 `searchAll`）

还有 `/api/kb/query` 也绕过 `searchAll`。

**影响**：

- 检索层优化只覆盖 `/api/chat`，旧路由行为与评测集脱节
- 文档上传的反馈语义不一致（一个轮询、一个同步等待）
- 维护成本翻倍

#### 1.5.2 修复方案

**核心思路**：分三步收敛，不一次性删除。

**第一步：标记旧路由为 deprecated**（阶段三）

- `/api/rag/*` 和 `/api/kb/query` 的响应加 `warning: 'deprecated'` 字段
- 日志中记录调用来源
- 前端确认没有使用旧路由后再删

**第二步：旧 RAG 问答路由走 searchAll**（**阶段二，与 sqlite-vec 同步**）

- `/api/rag/query` 和 `/api/kb/query` 的检索逻辑改为调用 `searchAll`
- 保持响应格式不变（兼容旧前端）
- **为什么提前到阶段二**：sqlite-vec 改造会影响 `similaritySearch` 和 `entrySearch` 的向量路。如果旧 RAG 路由仍绕过 `searchAll` 直接调用 `similaritySearch`，sqlite-vec 迁移就必须同时兼容两套查询语义，测试面翻倍。先让所有入口共享同一套向量查询路径，sqlite-vec 只需在一个地方验证。

**第三步：删除旧文档上传路由**（阶段三）

- 确认 `/api/rag/documents` 和 `/api/rag/documents/url` 无调用后删除
- 文档上传统一走 `/api/documents/upload`

#### 1.5.3 实现步骤

| 步骤 | 改动文件                        | 内容                                        |
| ---- | ------------------------------- | ------------------------------------------- |
| 1    | `routes/rag.ts`, `routes/kb.ts` | 响应加 deprecated warning                   |
| 2    | `routes/rag.ts`, `routes/kb.ts` | 检索逻辑改为 `searchAll` + `generateAnswer` |
| 3    | 前端                            | 确认无旧路由调用                            |
| 4    | `routes/rag.ts`                 | 删除旧文档上传路由                          |

#### 1.5.4 验收标准

- 所有问答入口（`/api/chat`、`/api/rag/query`、`/api/kb/query`）都走 `searchAll`
- 文档上传只有 `/api/documents/upload` 一个入口
- 旧路由在 1 个月的 deprecated 期后删除

---

### 1.6 P2：上下文硬截断 → rerank + 压缩

#### 1.6.1 问题诊断

**代码位置**：[`services/answer/context.ts`](file:///d:/project/ai_study/apps/server/src/services/answer/context.ts) `assembleContext`（L74-110）

当前逻辑：按 merge 排序遍历，`used + line.length > 3200` 时 `break`。超预算的条目既不注入也不编号。

**问题**：

- 排在第 16 位的可能是关键事实，但被前面某条长 content 挤掉
- RRF + 通道权重的排序不等于「对查询的回答价值排序」
- 检索指标（召回率）高估了生成收益（retrieval-generation gap）

#### 1.6.2 修复方案：先决定 rerank 插入点，再加压缩

**核心决策：rerank 插在哪里？**

这不是实现细节，而是决定收益大小的架构决策。当前 `mergeSearchSignals` 的流程是：三通道原始结果 → min-max 归一化 → 乘权重 → 排序 → 截断。rerank 有两个可选插入点：

- **(a) merge 后全局 rerank**：面对的是已经被通道权重和归一化扭曲过的候选池，可能已经丢失了低排名但高相关的条目
- **(b) 各语义通道内部 rerank**（entry + doc 通道各自 rerank 后再 RRF）：通道内部质量先优化，计算量 = 2 次 rerank（当前只有两个语义通道，可控）

**必须先做 A/B 对比**：用评测集同时跑 (a) 和 (b)，对比 Faithfulness / Context Relevance。如果 (b) 收益明显高于 (a)，说明当前 merge 的归一化加权是瓶颈，rerank 应优先修通道内部质量。

**Reranker 选项**（按落地成本）：

1. **LLM-based rerank**（零依赖，先用）：

   - 调一次 LLM，输入 query + 候选列表，让模型输出「最相关的 N 条」的编号
   - ⚠️ **不与 answer 生成合并调用**：让模型在同一个 prompt 里先选再答会引入隐性耦合——模型可能为了「作答方便」优先选择容易生成流畅答案的条目，而非真正相关的条目。rerank 必须独立调用，用 Context Relevance 单独度量候选选择质量。

2. **API rerank**（智谱如有 rerank 端点）：

   - 调 `/rerank` 接口，输入 query + documents，返回重排序分数
   - 成本：按 token 计费

3. **本地 cross-encoder**（长期）：
   - ONNX 版 BGE-reranker，本地推理
   - 成本：CPU 推理，~50ms/条

**上下文压缩（解决单条内容过长吃掉预算）**：

rerank 解决了「截断丢关键条目」的问题，但没解决「单个条目内容太长，一条就吃掉预算」的问题。在 `assembleContext` 中增加 query-conditioned 摘要：

- 对超过 160 字的 entry 和超过 400 字的 chunk，不直接硬截断加 `…`
- 改为先让 LLM 做一次 query-conditioned 摘要（「只保留与 `{query}` 相关的部分，不超过 100 字」）
- 这个摘要调用可以和 rerank **共用一次 LLM 请求**（同一 prompt 里让模型先 rerank 再对每条做摘要），边际成本很低

**压缩 fallback 链**：当 LLM 摘要因超时或降级不可用时，回退到 **LLMLingua 本地压缩**（ONNX 版本，与生成模型解耦的小语言模型做 token 级压缩，可在不丢失关键信息的前提下缩短数倍），最后兜底为硬截断。这符合「每个改造保留原路径作为 fallback」的执行原则。

效果：把「预算花在刀刃上」从条目级推进到内容片段级，直接对应「一条长 content 挤掉后面关键事实」的根因。

#### 1.6.3 实现步骤

| 步骤 | 改动文件                                           | 内容                                                                                                                                                  |
| ---- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | 评测脚本                                           | A/B 对比 rerank 插入点 (a) merge 后 vs (b) 通道内部，选择收益更高的位置                                                                               |
| 1    | `services/search/rerank.ts`（新建）                | 实现 LLM-based rerank（独立调用，不与 answer 合并）                                                                                                   |
| 2    | `services/search/entrySearch.ts` / `docChannel.ts` | 若选 (b)，在通道内加 rerank；若选 (a)，不动通道                                                                                                       |
| 3    | `services/answer/context.ts`                       | 超预算的 entry/chunk 改为 query-conditioned 摘要（与 rerank 共用 LLM 调用）；压缩 fallback 链：LLM 摘要 → LLMLingua 本地压缩 → 硬截断（按可用性递减） |
| 4    | `services/answer/generate.ts`                      | 按选定插入点接入 rerank                                                                                                                               |
| 5    | 配置                                               | `ENABLE_RERANK=1`、`RERANK_POSITION=merge\|channel` 开关，默认关闭                                                                                    |
| 6    | 评测                                               | 对比 rerank 前后的 Faithfulness / Context Relevance / Token Efficiency                                                                                |

#### 1.6.4 验收标准

- **插入点决策**：A/B 对比后明确选择 (a) 或 (b)，记录 Context Relevance 对比数据
- 开启 rerank 后，评测集 Context Relevance 提升 ≥ 5%（不能只看 Faithfulness）
- 开启 query-conditioned 压缩后，达到同等 Faithfulness 所需的上下文 token 数下降 ≥ 15%（Token Efficiency 提升）
- 问答延迟增加 < 3s（rerank + 摘要调用开销）
- 可通过环境变量开关回退

---

### 1.7 P2：多轮对话查询凝练（Query Condensation）

#### 1.7.1 问题诊断

**代码位置**：[`services/search/searchAll.ts`](file:///d:/project/ai_study/apps/server/src/services/search/searchAll.ts)、[`services/answer/generate.ts`](file:///d:/project/ai_study/apps/server/src/services/answer/generate.ts)

当前 `queryUnderstanding` 的 `ruleBasedUnderstanding` 和 LLM 兜底处理的都是**单轮查询**的时间窗和意图识别。但对话是多轮的（`chat.vue` 维护 session，`generateAnswer` 接收 history），用户追问「那它呢」「这个后来改了吗」时，检索链路会把指代不明确的原始 query 直接送入 `searchAll`——向量和 BM25 都无法处理「它」指代什么。

#### 1.7.2 修复方案：检索前的 Query Condensation

**核心思路**：在 `searchAll` 入口增加一个轻量的查询凝练步骤，把带指代、带省略的追问还原成能独立成立的完整问题，再走检索。

**设计原则**（区别于 Agentic rewrite 节点）：

- 这是**检索前必须做**的前置步骤，不是「检索质量不足时重写」的补救
- 改写后的 query 用于检索，**原问题保留**用于生成答案（答案应回应用户的原始措辞）
- 改写置信度低时**回退到原 query**，而不是给改写结果打低分后继续检索
- 多查询扩展可以保留原问题一路兜底，但指代消解的原问题本身没有信息量，检索只用改写后的那一条

**实现方式**：

1. **话题连续性门控（前置，低成本）**：先计算当前 query 与上一轮 user 消息的 embedding 余弦相似度
   - 相似度 > 0.8 → 判定为追问，进入改写
   - 相似度 < 0.3 → 判定为新话题，**跳过改写**，直接用原 query 检索（避免历史上下文污染新话题）
   - 中间区间（0.3–0.8）→ 调 LLM 做精细分类
   - 开关：`CONDENSATION_TOPIC_GATE=1`
2. 判定为追问时，取最近 2-3 轮 user/assistant 消息作为上下文
3. 用一次短 LLM 调用（temperature=0，< 5s 超时）把当前 query 改写为独立问题
4. 改写失败或置信度低时保留原 query
5. 用改写后的 query 走 `searchAll`，但 `generateAnswer` 的 prompt 中同时保留原 query 和改写后 query

#### 1.7.3 实现步骤

| 步骤 | 改动文件                                     | 内容                                                                    |
| ---- | -------------------------------------------- | ----------------------------------------------------------------------- |
| 1    | `services/search/condensateQuery.ts`（新建） | 实现 query condensation，输入 query + history，输出改写后 query         |
| 2    | `routes/chat.ts`                             | `searchAll` 前调用 `condensateQuery`，改写后的 query 用于检索           |
| 3    | `services/answer/generate.ts`                | prompt 中同时包含原 query（用于回应）和改写后 query（用于检索依据说明） |
| 4    | 配置                                         | `ENABLE_QUERY_CONDENSATION=1` 开关，默认关闭                            |
| 5    | 评测                                         | 新增多轮追问用例，对比开启前后的命中率                                  |

#### 1.7.4 验收标准

- 多轮追问（含「它」「这个」等指代）的检索命中率提升 ≥ 10%
- 单轮查询不受影响（原 query 直接通过，不增加延迟）
- 改写失败时自动回退原 query，不报错

---

## 2. 新技术引入设计

### 2.1 Function Calling / 约束解码

见 [1.4 节](#14-p1抽取结构化输出--function-calling)。

**扩展考虑**：

- 问答生成也可考虑用 Function Calling 让模型输出 `{ answer, citations[] }` 结构化结果，替代当前的 `parseMissing` 正则解析
- 但问答的回答长度和灵活性要求更高，JSON 输出可能限制表达，**建议抽取先上，问答保持现状**

---

### 2.2 轻量重排序 Reranker

见 [1.6 节](#16-p2上下文硬截断--rerank--压缩)。

**技术选型建议**：

- **短期**：LLM-based rerank（零额外依赖，与生成合并调用）
- **中期**：智谱 rerank API（如果支持且成本可控）
- **长期**：本地 cross-encoder（BGE-reranker ONNX，零外部调用）

---

### 2.3 sqlite-vec 向量索引

见 [1.3 节](#13-p1向量检索全表扫描--sqlite-vec)。

**扩展考虑**：

- `entry_embeddings` 表也建 vec0 虚拟表，条目语义检索同步受益
- 可加 `vec0` 的 `distance_metric` 参数指定 cosine，避免归一化开销

**选型边界与量化路径**：

sqlite-vec 的 vec0 是**暴力扫描（brute-force）**，没有 HNSW/IVF 近似索引。1536 维 float32 向量的延迟基准：50K 行约 108ms，100K 行约 218ms。

为了在不急于迁移 pgvector 的前提下扩大 sqlite-vec 的可用规模，使用 **sqlite-vec 内置 rescore 索引**（PR #276，2026 年 3 月合并）：

| 路径                     | 实现方式                                           | Recall@10              | 适用规模   |
| ------------------------ | -------------------------------------------------- | ---------------------- | ---------- |
| float32 暴力扫描         | `vec0` 默认                                        | 100%                   | < 50K      |
| **INT8 rescore（内置）** | `INDEXED BY rescore(quantizer=int8, oversample=8)` | **~100%**（K=10 场景） | 50K – 200K |
| pgvector + HNSW          | ANN 索引                                           | 可调                   | > 200K     |

**内置 rescore 的机制**：用 int8 量化向量做粗排（oversample 放大候选数），再用原始 float32 向量对候选做精排。实测数据：int8 rescore 在 K=10 查询上实现 perfect recall（100%），速度是纯 float 暴力扫描的 2 倍以上；binary rescore 在 oversample=8 时 recall 约 0.988。top-1 与精确 float32 一致，top-3 重叠 ≥ 2/3。

这意味着**不需要自己手写两阶段 rescore**，直接用内置索引即可，且召回损失在 K=10 场景下基本可忽略。把 pgvector 迁移的触发线推迟到 **200K 以上**，更节省工程成本。

**验收标准补充**：启用 int8 rescore 后，`similaritySearch` 的 top-10 与 float32 全量扫描的召回差异 ≤ 1%。

---

### 2.4 Ragas 评估流水线

#### 2.4.1 现状

当前评测（`apps/server/tests/eval`）有 4 项指标：命中率、引用准确率、幻觉率、无命中识别率。方向正确，但口径偏业务层，缺少检索层和生成忠实度的细粒度度量。

#### 2.4.2 改进方案

**引入 Ragas 指标**（可与现有 LLM 裁判复用）：

| 指标                           | 口径                                             | 门禁   |
| ------------------------------ | ------------------------------------------------ | ------ |
| Faithfulness                   | 答案是否忠于检索上下文                           | ≥ 0.75 |
| Context Relevance              | 检索上下文是否与问题相关                         | ≥ 0.70 |
| Answer Correctness             | 答案与期望答案的相似度                           | ≥ 0.65 |
| **Citation Coverage**          | 答案中实际出现的 [n] 引用数 / 注入上下文的编号数 | ≥ 0.60 |
| **Citation Support Precision** | 被引用的 [n] 中，引用片段真正支撑对应陈述的比例  | ≥ 0.80 |

**Citation Coverage（注入内容利用率）**：当前 `buildCitations` 是事后快照——把 `assembleContext` 编号过的条目原样转成引用列表。但如果模型生成时实际没有引用第 3 条，citations 里仍然会有第 3 条，因为它按「注入过上下文」而非「被答案实际引用」构建。

Citation Coverage = 答案中实际出现的 `[n]` 数 / 注入的编号数。如果 Coverage 明显低于 1，说明 `assembleContext` 注入了模型认为不值得引用的内容——这正好是 query-conditioned 压缩（1.6.2）应该削减的目标。60% 意味着约四成注入内容未被模型采信，正好对应压缩目标。

**Citation Support Precision（引用支撑度，学术口径）**：度量「引用是否真的支撑陈述」，而非「模型引用了多少注入内容」。模型可以引用第 3 条，但第 3 条并不支撑它说的那句话——按 Coverage 口径算命中，按学术口径算失败。

实现方式：用 LLM 裁判或轻量 NLI 模型对每个「陈述-引用片段」对做蕴含判断。ScienceDirect 2026 年 9 月的受控故障注入研究将此指标阈值设为 < 0.80 即触发告警，AWS Bedrock 内置指标 `Builtin.CitationPrecision` 和 ALCE 基准也采用相同口径。用户看到 `[3]` 时默认第 3 条支撑了那句话，因此 Support Precision 比 Coverage 更接近用户对「引用可信」的感知。

**RAG Triad 归因逻辑**：

将端到端流程解耦为 Query → Context → Answer 三节点，Faithfulness / Context Relevance / Answer Correctness 不是并列黑盒指标，而是有联合诊断意义：

| Context Relevance | Faithfulness | 归因                   | 修复方向               |
| ----------------- | ------------ | ---------------------- | ---------------------- |
| 低                | -            | 检索召回了噪声         | 修检索 / rerank / 分块 |
| 正常              | 低           | 模型拿到正确依据却编造 | 修 prompt / 生成约束   |
| 正常              | 正常         | 健康                   | -                      |

这条归因规则比单独看两个指标更有操作价值：当 Faithfulness 下降时，先看 Context Relevance 是否同步下降，决定是检索问题还是生成问题。

**关于 Token Efficiency（自定义指标，非 Ragas 原生）**：

`correctness / log(1 + context_tokens)` 是一个自定义复合指标，**不是 Ragas 原生输出**，存在两个隐含假设：(1) correctness 与 token 数是对数线性关系；(2) 不同查询间的 correctness 可无归一化直接相加。这两个假设在 RAG 场景下不一定成立——一个问题需 5K token 达 0.8 correctness，另一个只需 1K token 达 0.8，前者效率分更低但可能只是问题复杂度不同。

因此 Token Efficiency **不作为阻断/告警门禁**，仅作为趋势观测指标，用于**同一查询集的前后对比**（如 rerank 开启 vs 关闭、压缩开启 vs 关闭）。

**可执行的效率度量**：在 Faithfulness 不变的前提下，度量 `context_tokens` 的下降百分比（方案 1.6.4 已写「下降 ≥ 15%」），这个口径比复合公式更直接、更可解释。Token Efficiency 保留在评估报告中作为参考列，不设硬性阈值。

**CI 门禁分级（含统计稳定性处理）**：

| 级别         | 条件                                              | 动作         |
| ------------ | ------------------------------------------------- | ------------ |
| **阻断级**   | 幻觉用例数 ≥ 3 **且** 连续 2 次运行都 ≥ 3         | 阻断发布     |
| **告警级**   | 连续 3 次运行幻觉率上升 > 1%                      | 告警但放行   |
| **告警级**   | Faithfulness 下降 > 5%                            | 告警但放行   |
| **现有门禁** | 命中率 ≥ 80%、引用准确率 ≥ 80%、无命中识别率 100% | 不达标则阻断 |

> **为什么不用百分比做阻断级**：评测集只有 20 条用例，幻觉率 2% 意味着最多允许 0-1 条幻觉。如此小样本下，单条用例的标签噪声（LLM 裁判本身不稳定性）就足以让门禁在「刚好 1 条」和「刚好 2 条」之间抖动。改用「绝对条数 + 连续运行」作为阻断条件，统计稳定性更高。

**实现方式**：

- 不直接引入 ragas Python 包（项目是 TS），而是用 LLM 裁判实现等价逻辑
- Faithfulness：让 LLM 判断答案中的每个陈述是否有上下文支撑
- Context Relevance：让 LLM 判断每个检索片段是否与问题相关
- Citation Coverage：从答案文本中正则抽取 `[n]` 编号，与注入的编号集合做交集计算
- Citation Support Precision：用 LLM 裁判/NLI 对每个「陈述-引用片段」对做蕴含判断，统计支撑比例
- Token Efficiency：记录每次评测的 context_tokens，仅用于同查询集前后对比，不参与门禁判断

**CI 门禁工程化参考**：开源工具 `rag-eval-gate` 已实现与本方案一致的 CI 门禁逻辑（Ragas 指标 + Token Efficiency + 可配置阈值 + GitHub Actions PR 评论）。可参考其门禁配置结构（`eval_config.yaml` 式的阈值集中管理）和 PR 评分表输出形式，让评估结果在 CI 中更可读。

---

### 2.5 Agentic RAG（中期方向）

#### 2.5.1 适用场景

当前 `searchAll` 是固定三通道并行，对于「我上个月关于项目 X 的规划和实际进展差在哪里」这类需要**多跳、跨源、迭代检索**的查询不够。

#### 2.5.2 设计思路：decide → retrieve → grade → rewrite → answer

不直接跳到「完全自主的多轮检索」，而是先实现一个轻量的 5 节点 Agentic RAG 图：

```
decide → retrieve → grade → rewrite → answer
  ↑                    │
  └──── (grade 不通过) ─┘
```

| 节点         | 职责                                    | 实现方式                                          |
| ------------ | --------------------------------------- | ------------------------------------------------- |
| **decide**   | 判断是否需要检索、检索哪个源            | 规则（`ruleBasedUnderstanding` 扩展）+ 小模型判断 |
| **retrieve** | 执行检索（调用 `searchAll` 的指定通道） | 复用现有三通道                                    |
| **grade**    | 评估检索结果质量是否足够回答            | LLM 判断「这些结果能否回答问题」                  |
| **rewrite**  | 质量不足时重写查询                      | LLM 改写 query，回到 retrieve                     |
| **answer**   | 基于最终检索结果生成答案                | 复用 `generateAnswer`                             |

**缓存安全约束（Fork Safety）**：如果 decide / grade / rewrite 节点各自发起独立 LLM 调用但不共享 system prompt、tool schema 等缓存关键参数，每次子调用都会 cache miss，Agentic 循环成本远高于预期。

约束规则：grade / rewrite 节点必须**复用 `generateAnswer` 的同一个 system prompt 前缀和 tool schema 定义**，只追加节点特定的短指令，而不是重新构造完整的 system prompt。

**推理参数一致性**：除 prompt 和 schema 外，`maxOutputTokens`、`temperature` 等推理参数如果被包含在提供商的缓存 key 中，子节点为了「给更多输出空间」而调大 `maxOutputTokens`，会静默 invalidate 整个父级缓存。因此 grade / rewrite 节点的 `maxOutputTokens` 应与 `generateAnswer` 的生成调用保持一致（或至少不高于它），`temperature` 也应复用同一配置。

这确保 prompt 缓存（prompt caching）命中，把多轮 Agentic 调用的边际成本降到接近「只有新增指令部分」。不需要在阶段四之前实现，但应在方案中写明，避免实现时踩坑。

**AMRAG 自适应检索策略（成本可控版）**：

不是让 LLM 在每个推理步骤都自由决定「要不要检索」，而是基于当前问题中关键实体的**流行度（popularity）**判断：

- 高流行度知识（如常识、近期热点）→ 模型大概率已在参数中掌握，**不触发检索**
- 低流行度知识（如个人日程、私有文档）→ **触发检索**

对本项目的启示：decide 节点不需要「完全自主」，可以先做一个轻量判断：

- 个人线索（`PERSONAL_CUE` 正则命中）→ 检索个人通道
- 时间窗 → 检索时间通道
- 通用问题 → 检索文档通道（已有逻辑）
- 其余 → 不检索，直接问答

这本质上是现有 `ruleBasedUnderstanding` 的扩展，不是重写。把 Agentic 的粒度控制在「是否需要检索」一层，比直接做多轮迭代检索的风险低得多。

#### 2.5.3 阶段三轻量实验：decide 节点前置

完整的 decide → grade → rewrite 循环放在阶段四，但 **decide 节点本身可以提前到阶段三做轻量实验**，与 rerank 并行推进——因为它本质是对 `ruleBasedUnderstanding` 的扩展，不是对检索管线的重写。

**实验内容**：当前 `searchAll` 每次都会跑文档通道（`searchDocumentsSemantic(query).catch(() => [])` 始终执行）。基于 `ruleBasedUnderstanding` 的输出增加一条规则：

```
如果 needsPersonalContext === false
  且 timeRange === null
  且 query 不包含文档引用线索（如「文档」「资料」「上传」等关键词）
则跳过文档通道
```

**验证方法**：用评测集对比「跳过文档通道」vs「始终跑文档通道」的命中率差异。如果 miss 用例的命中率下降 ≤ 2%，则在阶段三固化这条规则，为阶段四的完整 Agentic 循环积累 decide 节点的调优经验。

**收益**：对于明确不需要文档检索的通用问题，可完全跳过一次 embedding + 向量查询 + BM25 的开销，降低 `/api/chat` 延迟。

**前提条件**（完整 Agentic 循环，阶段四）：

- 入口收敛（1.5）
- rerank 基线稳定（1.6）
- sqlite-vec 迁移完成（1.3）——让检索管线本身「可观测、可对比」
- decide 轻量实验验证通过（2.5.3）

**不建议现在做的理由**：在双链路并存、无 rerank 的检索层上叠 Agentic 控制层，调试复杂度指数上升。

---

### 2.6 记忆管理与知识编译（长期方向）

#### 2.6.1 现状问题

抽取链路是「用户说 → 抽取 → 卡片确认 → 入库」，入库后没有持续整理。长期使用后：

- 条目之间语义重叠（多次说同一件事）
- 时间冲突（改了时间但旧条目还在）
- 过期事实累积

#### 2.6.2 务实方案：周期性整理任务

不重写成 Agentic 记忆系统，而是加一个**周期性批量整理任务**：

- 按周/月触发（非每次对话）
- LLM 扫描新入库条目，识别：
  - 可合并的重复项（生成合并建议）
  - 已过期的事实（标注待确认）
  - 时间冲突（标注待确认）
- 生成待用户确认的整理建议，不自动修改

**长期演进方向：轻量 Graph RAG**：当条目量增长到纯 LLM 全量扫描成本过高时，引入 LightRAG / nano-GraphRAG / KAG 等轻量化变体——先抽取实体和关系建一张轻量实体-关系图，后续整理任务只扫描图上的「冲突边」和「重复社区」，而非全量条目。这比纯 LLM 全量扫描的 token 成本低一个数量级，也更容易增量维护。还可结合 Agentic GraphRAG 的分层检索（实体、chunk、社区报告、图邻域）改善跨文档的事实关联。

---

## 3. 分阶段执行计划

| 阶段                    | 时间   | 动作                                                              | 对应问题                           | 前置依赖   |
| ----------------------- | ------ | ----------------------------------------------------------------- | ---------------------------------- | ---------- |
| **一：止血**            | 立即   | 1.1 isMockMode TTL + 探测                                         | 检索无声退化                       | 无         |
|                         | 立即   | 1.2 抽取失败原文落库                                              | 数据丢失                           | 无         |
| **二：性能与可靠性**    | 1-2 周 | 1.3 sqlite-vec 替换全表扫描                                       | /api/chat 性能                     | 无         |
|                         | 1-2 周 | **1.5 第二步：旧 RAG 问答路由走 searchAll**                       | 架构慢性出血（与 sqlite-vec 同步） | 无         |
|                         | 1-2 周 | 1.4 抽取改 Function Calling（含约束税探针）                       | non_json 不可靠                    | 无         |
| **三：架构收敛 + 质量** | 3-4 周 | 1.5 剩余：deprecated 标记 + 删除旧上传路由                        | 架构慢性出血                       | 阶段二完成 |
|                         | 3-4 周 | 1.6 rerank（先 A/B 决定插入点）+ query-conditioned 压缩           | 上下文硬截断                       | 阶段二完成 |
|                         | 3-4 周 | **1.7 多轮对话 Query Condensation**                               | 多轮追问命中率                     | 无         |
|                         | 3-4 周 | 2.4 Ragas 指标接入 CI 门禁（Citation Precision + RAG Triad 归因） | 评估与发布解耦                     | 无         |
|                         | 3-4 周 | **2.5.3 decide 轻量实验：跳过文档通道的规则验证**                 | 为 Agentic 铺路                    | 阶段二完成 |
| **四：智能化升级**      | 长期   | 2.5 Agentic 检索循环（decide→retrieve→grade→rewrite）             | 复杂查询                           | 阶段三完成 |
|                         | 长期   | 2.6 周期性知识整理                                                | 长期知识质量                       | 阶段三完成 |

> **为什么把「旧 RAG 路由走 searchAll」提前到阶段二**：1.3 的 sqlite-vec 改造会同时影响 `vectorStore.similaritySearch` 和 `entrySearch` 的向量路。如果旧 RAG 路由仍绕过 `searchAll` 直接调用 `similaritySearch`，sqlite-vec 迁移就必须同时兼容「新链路」和「旧链路」两套查询语义，测试面翻倍。先让所有入口共享同一套向量查询路径，sqlite-vec 只需在一个地方验证。

---

## 4. 风险与回滚策略

| 改造项           | 风险                              | 回滚方式                                |
| ---------------- | --------------------------------- | --------------------------------------- |
| isMockMode TTL   | 探测调用增加延迟（仅 TTL 过期时） | `EMBEDDING_MOCK_TTL_MS=0` 恢复永久 mock |
| sqlite-vec       | Windows 扩展加载兼容性            | `USE_SQLITE_VEC=0` 切回全表扫描         |
| Function Calling | glm-4-flash 支持不完整            | 回退到 JSON Mode + schema 校验          |
| rerank           | 问答延迟增加                      | `ENABLE_RERANK=0` 关闭                  |
| 路由收敛         | 旧前端调用旧路由                  | deprecated 期 1 个月，不强制删除        |

**通用回滚原则**：

1. 每个改造都有环境变量开关
2. 默认关闭新路径，验证后再开启
3. 保留原路径代码至少 1 个版本周期

---

## 5. 验收指标

### 5.1 功能验收

| 指标                         | 现状              | 目标                              |
| ---------------------------- | ----------------- | --------------------------------- |
| embedding 失败后恢复         | 需重启进程        | 5 分钟内自动探测恢复              |
| 抽取失败原文                 | 丢失              | 落库为 draft 草稿                 |
| 千级 chunk 查询延迟          | ~500ms-1s         | < 100ms                           |
| 抽取结构失败率（non_json）   | 偶发              | 0（Function Calling / JSON Mode） |
| 抽取语义失败率（一致性违例） | 未单独统计        | ≤ 10%                             |
| 问答入口一致性               | 3 个入口 2 套逻辑 | 统一走 searchAll                  |

### 5.2 质量验收（评测集）

| 指标                       | 现状门禁 | 目标门禁                                 |
| -------------------------- | -------- | ---------------------------------------- |
| 命中率                     | ≥ 80%    | ≥ 80%                                    |
| 引用准确率                 | ≥ 80%    | ≥ 80%                                    |
| 幻觉率（阻断级）           | = 0      | 幻觉用例 ≥ 3 且连续 2 次 → 阻断          |
| 幻觉率（告警级）           | -        | 连续 3 次上升 > 1% → 告警                |
| 无命中识别率               | 100%     | 100%                                     |
| Faithfulness               | -        | ≥ 0.75                                   |
| Context Relevance          | -        | ≥ 0.70                                   |
| Answer Correctness         | -        | ≥ 0.65                                   |
| Citation Coverage          | -        | ≥ 0.60                                   |
| Citation Support Precision | -        | ≥ 0.80                                   |
| Token Efficiency           | -        | 趋势观测（同查询集前后对比，不设硬阈值） |

### 5.3 性能验收

| 场景               | 规模        | 目标延迟 |
| ------------------ | ----------- | -------- |
| /api/chat P95      | 1000 chunks | < 3s     |
| /api/chat P95      | 5000 chunks | < 5s     |
| /api/extract P95   | -           | < 30s    |
| 文档上传（100 块） | -           | < 60s    |

---

> **方案版本**：v1.4，基于 `feat/architecture-v5` 分支现状。
> **v1.3 更新**：补全结构性空白——1.7 新增多轮对话 Query Condensation（检索前指代消解，区别于 Agentic rewrite）；2.4 新增 Citation Precision 指标（实际被引用数/注入数，防止引用准确率虚高）和 RAG Triad 归因逻辑（Context Relevance 低→修检索，Faithfulness 低但 Context Relevance 正常→修生成）；2.4 补充 rag-eval-gate CI 门禁工程化参考。技术细节精化——2.3 改用 sqlite-vec 内置 rescore 索引（PR #276，K=10 perfect recall，不需手写两阶段）；1.4 限定 GLM tool_choice 结论的版本范围（glm-4-flash 不支持，glm-5.3+ 支持，探针需版本探测）；2.5 新增 Fork Safety 缓存安全约束（grade/rewrite 复用 generateAnswer 的 system prompt 前缀）。
> **v1.4 更新**：指标口径收紧——2.4 拆分 Citation 为 Coverage（注入利用率，≥0.60）和 Support Precision（引用支撑度，≥0.80，学术/NLI 口径）；1.7 增加话题连续性门控（query embedding 余弦相似度 >0.8 追问、<0.3 新话题跳过改写，避免历史污染新话题）；2.5 Fork Safety 补充推理参数一致性（maxOutputTokens、temperature 不高于 generateAnswer，防止缓存 invalidate）；1.6 压缩阶段补充 LLMLingua 本地压缩作为 LLM 摘要不可用时的 fallback；2.6 补充轻量 Graph RAG（LightRAG/nano-GraphRAG）作为长期演进方向。
> **下一步**：按阶段一（止血）开始实施，每完成一项跑一次 typecheck + vitest + lint。
