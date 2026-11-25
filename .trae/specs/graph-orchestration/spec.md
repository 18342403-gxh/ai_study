# Agent 编排图化规格（LangGraph 方案 B）

> 日期：2026-11-23
> 范围：后端 `apps/server`（主）+ 前端 `apps/generator`（仅 P1 确认链路）
> 依据：三条链路代码通读 + 用户确认采用方案 B（LangGraph 作为编排层）

## 1. 问题定义

| 链路     | 入口                           | 现状                                                            | 缺陷                                                            |
| -------- | ------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------- |
| 检索     | `services/search/searchAll.ts` | `if/else` 硬编码：规则理解 → 三通道并行 → merge → rerank → 兜底 | 节点边界只靠注释；新增通道必须改主流程；条件分支无法独立单测    |
| 抽取     | `routes/extract.ts`            | 一次性函数：抽取 → 匹配 → 返回卡片；确认状态在前端内存          | 「草稿→确认→入库」不是真状态机；刷新丢草稿；失败需重跑 LLM      |
| 工具循环 | `services/tools/agent.ts`      | `for` 循环 + `maxIterations`                                    | 中间结果全在内存；超时/重启无法断点续跑；副作用工具可能重复执行 |

## 2. 决策与关键前提

- **采用方案 B**：引入 `@langchain/langgraph`，将三条链路的**编排层**迁移到 `StateGraph`。
- **不替换 `services/chain/model.ts`**：LangGraph 节点是普通 `async (state) => Partial<state>` 函数，节点内部继续调用现有 `createChatChain` / `invokeChatWithToolCalls` / 检索服务。框架只负责状态合并、条件边、检查点、interrupt/resume。
- **不引入 LangChain 运行时绑定**：不要求把自定义模型换成 `BaseChatModel`。

## 3. 目标

1. `searchAll` 的节点与条件边显式化，新增检索通道不改主流程骨架。
2. 抽取链路成为可中断、可恢复的状态机，草稿跨进程持久，确认后从断点入库。
3. 工具循环每轮落检查点，超时后可恢复且不重放已执行的工具调用。
4. 三条链路均可用环境变量灰度开关回退到旧实现。

## 4. 非目标

- 不改模型调用方式、不改 Prompt、不调整检索算法本身。
- 不迁移前端其他页面；P1 只改抽取确认相关交互。
- 不做 LangSmith 接入。
- 不删除旧实现（保留一个版本周期，靠开关切换）。

## 5. 架构

```
SearchGraph ──┐
ExtractGraph ─┼─→ LangGraph StateGraph ──→ Checkpointer
AgentGraph ───┘   (节点/条件边/中断)        (SQLite | Postgres)
```

新增目录 `apps/server/src/services/graph/`：

```
graph/
  runtime.ts        # createAppGraph()：compile + checkpointer 注入 + withSpan 节点包装
  checkpointer.ts   # 按 DATABASE_DRIVER 选择 SQLite / Postgres saver，复用 db/index.ts 连接
  thread.ts         # thread_id 生成与解析约定
  types.ts          # 共享状态类型、InterruptPayload
```

### thread_id 约定

| 图      | thread_id                                             |
| ------- | ----------------------------------------------------- |
| search  | `search:{sessionId ?? 'anon'}:{messageId}`            |
| extract | `extract:{draftId}`（draftId 同时返回前端作草稿标识） |
| agent   | `agent:{sessionId}:{messageId}`                       |

### 灰度开关

`ENABLE_GRAPH_SEARCH` / `ENABLE_GRAPH_EXTRACT` / `ENABLE_GRAPH_AGENT`，默认关闭，与现有 `ENABLE_RERANK`、`ENABLE_DECIDE_SKIP_DOC` 风格一致。

## 6. 分阶段计划

### 阶段 0：Spike（阻塞项，未通过则回退方案 A）

验证清单：

| 项                  | 通过标准                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 版本兼容            | `@langchain/langgraph` 与 `langchain@^1.5.9`、`@langchain/core@^1.2.8`、`zod@^4.4.3` 无 peer 冲突，`tsc --noEmit` 通过 |
| StateGraph 基本用法 | `Annotation` 定义状态，`addNode`/`addConditionalEdges`/`compile().invoke()` 跑通                                       |
| checkpointer        | SQLite saver 可复用现有 `better-sqlite3` 实例；Postgres saver 可复用现有 `postgres` client                             |
| interrupt/resume    | 首次 invoke 停在中断点；同 `thread_id` + `Command({ resume })` 从断点续跑，前置节点不重跑                              |

产出：`apps/server/scripts/graph-spike.mts`（验证后删除）+ 结论追加到本文件第 9 节。

### 阶段 1：地基封装

- `runtime.ts`、`checkpointer.ts`、`thread.ts`、`types.ts`。
- checkpointer 与业务表同库同连接，避免双连接与事务边界不一致。
- 节点包装沿用 `withSpan('graph.{graph}.{node}')`。

### 阶段 2：P0 — search 图化（纯重构，接口不变）

- 对外 `searchAll(options)` 签名不变。
- 节点：`understand` / `retrieve` / `merge` / `rerank` / `finalize`。
- 条件边：`retrieve → finalize`（通用问题早退）、`merge → rerank | finalize`（`ENABLE_RERANK`）、`rerank → finalize`。
- 验收：现有测试全绿；`tests/eval/run.ts` 对比图化前后 `SearchAllOutcome` 逐字段一致；新增条件边单测。

### 阶段 3：P1 — extract 中断恢复

- 图：`extract → (cancel/delete/update ? match→END : buildCards → confirm → commit → END)`。
- `confirm` 节点 `interrupt({ draftId, cards })`，检查点落库。
- 接口：
  - `POST /api/extract` 返回 `{ draftId, cards, interrupted: true }`
  - 新增 `POST /api/extract/:threadId/resume`（携带用户编辑内容，从 `commit` 续跑）
  - 新增 `GET /api/extract/:threadId`（读取未确认草稿）
- 前端 `pages/documents.vue`、`pages/chat.vue` 确认动作改走 resume；支持刷新后恢复草稿。
- 验收：进程重启后可 resume 入库；刷新不丢草稿；失败不重跑抽取。

### 阶段 4：P2 — agent 检查点

- 图：`decide → execute → decide（回环）/ summarize → END`。
- 每轮 `execute` 后落检查点（`messages` + `steps`）。
- 验收：超时恢复不重放已执行工具；`maxIterations` 行为与现状一致。
- 前置：确认存在长工具循环跨请求恢复的真实场景；否则缓做。

## 7. 验收标准

- AC-1：Spike 四项全部通过，结论记录在本文件第 9 节。
- AC-2：三条链路开关均可独立开关，关闭时行为与改造前完全一致。
- AC-3：P0 图化前后检索结果逐字段一致，现有测试与 ESLint 通过。
- AC-4：抽取刷新/重启后可恢复并完成入库。
- AC-5：agent 恢复不重复执行已完成的工具调用。
- AC-6：SQLite 与 Postgres 两种驱动的 checkpointer 均验证通过。
- AC-7：节点与条件边具备纯函数单测。

## 8. 风险与回滚

| 风险                                | 应对                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| Spike 版本冲突 / interrupt 语义不符 | 回退方案 A（自研轻量图运行时）                               |
| checkpointer 双方言适配超预期       | 阶段 1 预留缓冲，先只保证 SQLite，PG 单独验证                |
| 同一 thread_id 并发写竞态           | 请求级串行化或 thread_id 加请求序号                          |
| 框架升级节奏影响                    | 编排细节封装在 `services/graph/`，业务节点不直接依赖框架 API |

回滚：关闭对应环境变量即回到旧路径；checkpoint 表为新增表，不影响业务表，无需数据迁移。

## 9. Spike 结论

> 执行日期：2026-11-23。脚本 `apps/server/scripts/graph-spike.mts`，结果 **6/6 PASS**，整体 **PASS**，进入阶段 1。

### 9.1 依赖与版本

| 包                                         | 版本                                                |
| ------------------------------------------ | --------------------------------------------------- |
| `@langchain/langgraph`                     | 1.7.5                                               |
| `@langchain/core`                          | 1.5.0（由 1.2.8 升级）                              |
| `@langchain/langgraph-checkpoint`          | 1.2.3                                               |
| `@langchain/langgraph-checkpoint-sqlite`   | 1.1.1                                               |
| `@langchain/langgraph-checkpoint-postgres` | 1.1.4                                               |
| `langchain`                                | 1.5.9（peer `@langchain/core ^1.2.8`，1.5.0 满足）  |
| `zod`                                      | 4.4.3                                               |
| Node                                       | 20.20.2（langgraph 要求 >=18，langchain 要求 >=20） |

- `@langchain/langgraph@1.7.5` 的 peer 要求 `@langchain/core ^1.3.4`，原 1.2.8 不满足，因此将 server 的 `@langchain/core` 升到 `^1.5.0`；`langchain`、`@langchain/community`、`@langchain/textsplitters` 的 peer 区间均兼容，安装后 server 依赖树不再有 langchain 相关 peer 警告。
- 安装后残留的 peer 警告仅属于 `@browserbasehq/stagehand`、`goldenmatch`（与本次无关）。
- `better-sqlite3` 出现两份实例：业务直连仍为 11.1.2，checkpoint 包自带 12.11.1；`SqliteSaver` 接受我们传入的 11.x 实例，运行正常。

### 9.2 四项验证

| 项                  | 结果 | 证据                                                                                                                                                                                                    |
| ------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 版本兼容            | PASS | core=1.5.0 / langgraph=1.7.5 / checkpoint=1.2.3 / sqliteSaver=1.1.1 / zod=4.4.3；`tsc --noEmit` 通过；`vitest run` 266/266 通过                                                                         |
| StateGraph 基本用法 | PASS | `Annotation.Root` + 3 节点 + 条件边，`invoke({input:'hello'})` → `{upper:'HELLO', branch:'long:long'}`                                                                                                  |
| SQLite checkpointer | PASS | 用 `getSqliteRaw()` 的现有 `better-sqlite3` 实例构造 `SqliteSaver`，写入后 `getTuple` 读回，同 thread 5 条检查点；关闭并重新 `initDatabase()` 后凭同一 `thread_id` 读回同一 `checkpoint_id`             |
| interrupt/resume    | PASS | 首次 `invoke` 返回 `isInterrupted()=true`，payload `{draftId,cards}`；重连后 `new Command({resume})` 续跑得到 `committed:user-confirmed`，前置 `prepare` 节点只执行 1 次（`ask` 重执行 2 次属框架行为） |

### 9.3 对阶段 1 的影响

1. **SQLite 路径确认可行**：`checkpointer.ts` 直接 `new SqliteSaver(getSqliteRaw())`，检查点表由 `SqliteSaver.setup()` 在同库幂等自建，与业务表同连接、同事务边界；`journal_mode=WAL` 由业务初始化设置，无冲突。
2. **Postgres 路径需修正**：`PostgresSaver` 的构造函数/`fromConnString` 只接受 `pg.Pool`，无法复用 `db/index.ts` 的 `postgres.js` 客户端。阶段 1 的 PG 方案改为**独立 `pg.Pool` 连接同一 PG 库**（额外一个连接池，不影响业务表事务）；如需严格单连接，再评估自研 `BaseCheckpointSaver` 适配器。此项不阻塞 SQLite 先行。
3. 节点命名不能与状态字段重名（`upper` 既作字段又作节点名会抛错），图化时节点名统一采用动词式命名。
4. `interrupt` 以抛错方式传播，节点内禁止用会吞掉 `GraphInterrupt` 的 try/catch。
