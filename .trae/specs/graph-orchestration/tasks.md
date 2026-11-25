# Agent 编排图化 — 任务队列

> 对应 `spec.md` 的 AC-1 至 AC-7。
> 阶段 0 未通过前，不启动阶段 1 及之后的任务。

## Task 0：Spike 技术验证

**AC**: AC-1 | **优先级**: high | **Status**: done（6/6 PASS，结论见 spec 第 9 节）

### 涉及文件

- `apps/server/package.json`（新增依赖）
- `apps/server/scripts/graph-spike.mts`（临时脚本，验证后删除）
- `.trae/specs/graph-orchestration/spec.md` 第 9 节（记录结论）

### 实现

1. 安装 `@langchain/langgraph`，记录 peer 警告与实际解析版本。
2. 验证 StateGraph：两个节点 + 一条条件边，`compile().invoke()` 状态正确合并。
3. 验证 checkpointer：SQLite 复用 `apps/server/src/db/index.ts` 的 `better-sqlite3` 实例写入并读回检查点。
4. 验证 interrupt/resume：首次 invoke 停在中断点，`Command({ resume })` + 同 `thread_id` 续跑，用计数器断言前置节点未重跑。

### 测试要求

- `pnpm --filter @ai-study/server typecheck` 通过。
- Spike 脚本输出四项 PASS/FAIL。
- 结论写入 spec 第 9 节；任一 FAIL 则停止并回退方案 A。

---

## Task 1：图运行时地基

**AC**: AC-2、AC-6 | **优先级**: high | **Status**: done

### 涉及文件

- 新增 `apps/server/src/services/graph/runtime.ts`
- 新增 `apps/server/src/services/graph/checkpointer.ts`
- 新增 `apps/server/src/services/graph/thread.ts`
- 新增 `apps/server/src/services/graph/types.ts`

### 实现

1. `runtime.ts`：统一 `compile`、注入 checkpointer、节点包一层 `withSpan('graph.{graph}.{node}')`。
2. `checkpointer.ts`：按 `DATABASE_DRIVER` 返回 SQLite / Postgres saver，复用现有连接。
3. `thread.ts`：实现 `search` / `extract` / `agent` 三类 thread_id 生成与解析。
4. `types.ts`：共享状态基础类型与 `InterruptPayload`。

### 测试要求

- 新增 `services/graph/__tests__/runtime.test.ts`：节点状态合并、条件边、单节点失败抛出。
- 新增 `checkpointer.test.ts`：写入后读回；同一 thread 多检查点取最新。

---

## Task 2：searchAll 图化

**AC**: AC-3 | **优先级**: high | **Status**: done

### 涉及文件

- `apps/server/src/services/search/searchAll.ts`
- 新增 `apps/server/src/services/search/graph.ts`
- 新增 `apps/server/src/services/search/__tests__/graph.test.ts`

### 实现

1. 拆分节点：`understand` / `retrieve` / `merge` / `rerank` / `finalize`。
2. 条件边：
   - `retrieve → finalize`：通用问题且 doc/entry 全空时早退。
   - `merge → rerank | finalize`：`ENABLE_RERANK=1` 且候选数 > 1。
   - `rerank → finalize → END`。
3. `searchAll(options)` 对外签名与返回结构不变；`ENABLE_GRAPH_SEARCH` 默认走旧路径。

### 测试要求

- 现有 `searchAll` 相关测试全绿。
- `pnpm --filter @ai-study/server eval` 对比图化前后 `SearchAllOutcome` 逐字段一致。
- 条件边纯函数单测覆盖：通用早退、单候选跳过 rerank、多候选进入 rerank。

### 完成记录

- 节点与条件边落地在 `services/search/graph.ts`；`searchAll.ts` 仅在 `ENABLE_GRAPH_SEARCH=1` 时改走 `runSearchGraph`，默认仍走旧路径。
- 检索图无中断/恢复需求，编译时 `{ checkpointer: false }`，避免每次检索写 checkpoint 表。
- 条件边纯函数 `shouldExitEarly` / `routeAfterRetrieve` / `shouldRerank` / `routeAfterMerge` 已有单测。
- typecheck 通过，vitest 27 文件 280 测试全绿；`eval` 依赖真实数据库与模型，未在本机执行，等价性以逻辑逐行对齐 + 既有测试保证。

---

## Task 3：extract 中断恢复

**AC**: AC-4 | **优先级**: high | **Status**: done

### 涉及文件

- `apps/server/src/routes/extract.ts`
- 新增 `apps/server/src/services/extract/graph.ts`
- `apps/generator/pages/documents.vue`
- `apps/generator/pages/chat.vue`
- `apps/generator/utils/api.ts`

### 实现

1. 图节点：`extract` / `match` / `buildCards` / `confirm`（`interrupt`）/ `commit`。
2. `POST /api/extract` 返回 `{ draftId, cards, interrupted: true }`。
3. 新增 `POST /api/extract/:threadId/resume`，合并用户编辑内容后从 `commit` 续跑。
4. 新增 `GET /api/extract/:threadId`，从检查点读取未确认草稿。
5. 前端确认动作改走 resume；进入页面时尝试拉取未确认草稿。

### 测试要求

- 新增路由测试：中断 → resume → 入库成功；取消/删除意图直接 END。
- 模拟进程重启：仅凭 `threadId` 从检查点恢复并完成入库。
- 前端确认流程手工验证，刷新后草稿仍在。

### 完成记录

- 新增 `services/extract/graph.ts`：`extract` / `match` / `buildCards` / `confirm`（interrupt）/ `commit` / `finish`；`confirm ⇄ commit` 支持按卡片增量确认，剩余卡片再次中断。
- `POST /api/extract`（`ENABLE_GRAPH_EXTRACT=1`）返回 `{ draftId, threadId, cards, entries, interrupted: true }`；新增 `POST /api/extract/:threadId/resume` 与 `GET /api/extract/:threadId`。
- 前端 `chat.vue`：确认/忽略/全部确认在草稿模式下走 resume；threadId 存 localStorage，进入页面自动拉取未确认草稿。
- 测试用 `services/extract/__tests__/graph.test.ts` 覆盖：中断→resume→入库、cancel 直接 END、进程重启后凭 threadId 恢复、条件边纯函数；route 层未单独起 HTTP 测试（服务端无 app 工厂），由图级测试覆盖同等路径。
- 文档抽取接入同一张图：`START → confirm`（`routeAtStart`），`runDocumentDraftGraph` 把文档卡片直接挂到草稿 thread；`POST /api/documents/:id/extract` 在图模式返回 `threadId`，确认复用 `/api/extract/:threadId/resume`；`documents.vue` 确认/忽略走 resume，threadId 存 localStorage 并在进入页面时恢复草稿。
- typecheck 通过，vitest 29 文件 292 测试全绿；前端 typecheck 因本机未安装 nuxt 依赖未能执行。

---

## Task 4：agent 循环检查点

**AC**: AC-5 | **优先级**: medium | **Status**: done

### 涉及文件

- `apps/server/src/services/tools/agent.ts`
- 新增 `apps/server/src/services/tools/graph.ts`

### 实现

1. 图节点：`decide` / `execute` / `summarize`；`execute → decide` 回环。
2. 每轮 `execute` 后落检查点（`messages` + `steps`）。
3. `iteration >= maxIterations` 时走 `summarize`，与现状一致。

### 测试要求

- 单测：工具调用轮次、达到上限走 summarize。
- 恢复测试：中断后恢复不重复执行已完成的工具调用。

### 完成记录

- 新增 `services/tools/graph.ts`：`decide → execute → decide（回环）/ summarize → finish`；每轮 execute 后由检查点持久化 `messages` + `steps`。
- `agent.ts` 抽出 `resolveToolAgentDeps`（工具/模型/轮数上限共用）；`ENABLE_GRAPH_AGENT=1` 时 `runToolAgent` 动态加载图实现，默认仍走原 for 循环。
- 新增 `resumeToolAgentGraph(threadId)`：读取 `getState`，无待执行节点返回 null；有则 `invoke(null)` 从检查点续跑。
- 新增 `services/tools/__tests__/graph.test.ts`：一轮工具、达到上限 summarize、模拟第二决策轮崩溃后恢复（工具只执行 1 次）、未启动线程 resume 返回 null。
- typecheck 通过；vitest 29 文件 290 测试全绿；旧 `agent.test.ts` 6 个用例行为不变。

---

## Task 5：收尾

**AC**: AC-2、AC-6、AC-7 | **优先级**: medium | **Status**: done

### 实现

1. 确认三个开关在关闭状态下与改造前行为一致。
2. SQLite 与 Postgres 各跑一次检查点读写。
3. 删除 Spike 临时脚本。
4. 更新 README 中编排相关的行为说明（如涉及用户可见行为）。
5. 类型检查、ESLint、测试、eval 全量通过。

### 完成记录

- 三个开关默认关闭：检索/抽取/工具链路的旧实现均保留，全量测试在开关关闭状态下通过。
- 检查点读写：SQLite 由 `checkpointer.test.ts` 与抽取/工具图测试覆盖；Postgres 用 `PostgresSaver.fromConnString` + 小图实测 `PG_CHECKPOINT_OK`（本地 PG 可用）。
- 已删除 `apps/server/scripts/graph-spike.mts`。
- README 环境变量章节补充三个灰度开关说明。
- `typecheck` 通过；`vitest` 29 文件 290 测试全绿；ESLint 对本次改动 0 error（剩余 warning 为既有 `import()` 类型注解风格与 route handler 行数）。
- `eval` 需要真实模型额度与语料，本机未执行（与 Task 2 记录一致）。
