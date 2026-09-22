---
name: fullstack-builder
description: Build full-stack AI-powered apps from zero to production through a gated 6-phase workflow. Use when starting a new project, choosing architecture, or when the user needs structured development phases. Do not use for single-feature bug fixes.
---

# Fullstack Builder Workflow

A **deterministic state machine** with 6 phases, each with mandatory gates. The workflow persists its state to `.workflow-state.json` so it survives across sessions.

## 默认技术栈（开箱即用）

`state.js init` 创建的状态文件自带以下默认值。这不是硬限制 — 每个都可以用 `state.js set` 覆盖。

| 层               | 默认值              | 理由                                                           |
| ---------------- | ------------------- | -------------------------------------------------------------- |
| **Layout**       | `monorepo-noshared` | 两个 app（server + web），不需要共享包。pnpm workspaces 零配置 |
| **Backend**      | `express`           | Node.js 生态，AI SDK（LangChain/Dify/Mastra）都是 TS first     |
| **Frontend**     | `vite+vue`          | SPA 开发效率高，Pinia 状态管理                                 |
| **Database**     | `sqlite`            | 零 infra，本地开发秒启动；部署时可切 PG                        |
| **Vector Store** | `sqlite-cosine`     | 零 infra，app 内计算 cosine，<100K 文档完全够用                |
| **Package**      | `pnpm`              | 磁盘高效 + Monorepo workspaces 原生支持                        |

**Node.js 是第一公民**。本 Skill 产出的所有 Prompt、代码模板、脚手架都以 TypeScript + Node.js 为主方向。Python Go Rust 等后端可选，但不是默认路径。

---

## 启动命令

当你想启动构建流程时，**必须**显式说出来。触发方式：

```
"/build <project-name>"
"start fullstack builder for <project>"
"按工作流来做 <project>"
```

收到启动命令后，**立即执行以下 3 步**：

1. **`node skill/scripts/state.js init <project-name>`** — 创建 `.workflow-state.json`
2. 输出 Phase 1 的 Actions 清单，开始执行
3. 每完成一个 gate，运行 `node skill/scripts/state.js pass <gate-slug>` 标记通过并输出进度

**所有脚本都在 `.trae/skills/fullstack-builder/scripts/` 目录下，零依赖，纯 Node.js。**

---

## 状态文件 schema

`.workflow-state.json` — 整个工作流的真相来源。**每完成一个 gate 就 update 一次**。

```json
{
  "project": "ai-blog-assistant",
  "currentPhase": 1,
  "startedAt": "2026-09-16T10:00:00Z",
  "gatesPassed": {
    "phase1.productBrief": true,
    "phase1.profile": true,
    "phase1.techChoices": false
  },
  "projectProfile": {
    "size": "startup-mvp",
    "team": "solo",
    "deployment": "single-vps",
    "aiScale": "low",
    "frontendScope": "spa"
  },
  "techStack": {
    "backend": "express",
    "frontend": "vite+vue",
    "database": "sqlite",
    "vectorStore": "sqlite-cosine",
    "layout": "single-package"
  },
  "phaseHistory": [{ "phase": 1, "enteredAt": "...", "gatesPassed": 0, "notes": "..." }]
}
```

**规则**：

- 任何时候被中断（session 断了、用户切话题），回来后先读这个文件，`currentPhase` 就是你该继续的地方
- Gate key 格式：`phase{N}.{gateSlug}`（比如 `phase2.typecheck`）
- Gate 只有 `true` / `false` / 不存在（=false）三种状态

---

## 状态机图

```
                    ┌──────────────┐
  startup command ─→│  Phase 1     │
                    │  Discovery   │
                    └──────┬───────┘
                           │ ALL gates pass
                           ▼
                    ┌──────────────┐
                    │  Phase 2     │
                    │  Scaffolding │
                    └──────┬───────┘
                           │ ALL gates pass
                           ▼
                    ┌──────────────┐
                    │  Phase 3     │◄──────────────────┐
                    │  Core Features│                   │
                    └──────┬───────┘                   │
                           │ ALL gates pass            │ more modules?
                           ▼                           │
                    ┌──────────────┐                   │
                    │  Phase 4     │                   │
                    │  Cross-Cut   │                   │
                    └──────┬───────┘                   │
                           │ ALL gates pass            │
                           ▼                           │
                    ┌──────────────┐                   │
                    │  Phase 5     │                   │
                    │  Productize  │                   │
                    └──────┬───────┘                   │
                           │ ALL gates pass            │
                           ▼                           │
                    ┌──────────────┐                   │
                    │  Phase 6     │                   │
                    │  Handoff     │                   │
                    └──────┬───────┘                   │
                           │ ALL gates pass            │
                           ▼                           │
                    ✅ WORKFLOW COMPLETE               │
                                                       │
                  Any gate fails ──────────────────────┘
                  → 修复 → 重新检查那个 gate
```

---

## Phase 1: Discovery & Design

**Goal**: 决定做什么、怎么做。**零代码**。

### Actions（按顺序执行）

**1.1 Product Brief（对话形式收集）**
向用户问 3 个问题，然后把回答整理成 2 段话：

- "这个产品给谁用？解决什么具体痛点？"
- "AI 在哪里？核心 AI 能力是什么（chat / RAG / agent / code gen / 多模态）？"
- "MVP 不做什么？（边界声明，防止 scope creep）"

**1.2 Project Profile（填进状态文件）**
| 维度 | 选项 | 作用 |
|------|------|------|
| `size` | personal / startup-mvp / enterprise-internal | 决定你能接受多少运维复杂度 |
| `team` | solo / 2-3 / 10+ | 决定技术栈的学习成本优先级 |
| `deployment` | local-only / single-vps / k8s / serverless | 决定数据库和部署方案 |
| `aiScale` | low (<10/hr) / medium (<1K/min) / high (>1K/min) | 决定成本控制和缓存策略 |
| `frontendScope` | spa / ssr / mobile / desktop | 决定前端框架 |

**1.3 Tech Stack Selection（填进状态文件）**
对每一层，给 2-3 个候选方案 + 1 句 justification（必须引用 profile 里的某个值，不能说"最新"）：

| 层           | 候选方案                                                         | 选择依据                     |
| ------------ | ---------------------------------------------------------------- | ---------------------------- |
| Backend      | Express / Fastify / Hono / FastAPI / Gin                         | 团队熟悉度 + deployment 约束 |
| Frontend     | Vite+Vue / Nuxt / Vite+React / Next / RN+Expo / Tauri / Electron | frontendScope + SEO 需求     |
| Database     | SQLite / PostgreSQL / MongoDB / DynamoDB                         | size + deployment            |
| Vector Store | SQLite-cosine / pgvector / Pinecone / Qdrant                     | 文档规模预估 + 零 infra      |
| Layout       | single-package / monorepo-noshared / monorepo-shared             | 有几个 app                   |

**1.4 Architecture Diagram**
ASCII 图，标注每个服务和协议：

```
[Frontend :3003] ──HTTP──▶ [BFF :3001] ──SQL──▶ [(DB)]
                                │
                                ├──HTTP──▶ [LLM API]
                                └──HTTP──▶ [Embedding API]
```

**1.5 Data Model**
每个表 5-8 个关键列，形状只写名字和类型，不写实现。

### Gate Check（必须全部 pass 才能进 Phase 2）

| Gate                              | Slug                  | 检查动作                                                           |
| --------------------------------- | --------------------- | ------------------------------------------------------------------ |
| Product Brief 写好了              | `phase1.productBrief` | 打开文档，有 2 段清晰描述                                          |
| Project Profile 填满              | `phase1.profile`      | 状态文件里 5 个维度都有值                                          |
| 每个 tech choice 有 justification | `phase1.techChoices`  | 状态文件 `techStack` 里每项都有一句"因为 profile.X 选了 Y 所以..." |
| 架构图画了                        | `phase1.archDiagram`  | 有 ASCII 图                                                        |
| 数据模型列了                      | `phase1.dataModel`    | 有所有表的列清单                                                   |

**Gate 失败处理**：向用户指出缺什么，补完再检查。

---

## Phase 2: Scaffolding

**Goal**: 创建项目骨架和基础设施。**零功能代码**。

### Actions

**2.1 目录结构**（按 Phase 1 选的 layout 创建）

**2.2 DB Layer** — 按 Phase 1 选的 DB 建连接层。多驱动（SQLite+PG）必须实现统一 async facade。**参考 `references/db-patterns.md`**。

**2.3 Middleware Pipeline** — Minimum: `cors → body parser → request logger → error handler`。按 profile 加 rate-limit / circuit-breaker / cache / auth。

**2.4 Logger** — 结构化 logger，requestId 追踪。**禁止 `console.log`**。

**2.5 Health Check** — `GET /health` 返回 `{ status, uptime, db, llm }`。

### Gate Check

| Gate                             | Slug                | 检查动作                                                                                    |
| -------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------- |
| Server 能启动 + /health 返回 200 | `phase2.health`     | **执行** `curl http://localhost:PORT/health`（或 PowerShell `Invoke-WebRequest`），贴出响应 |
| DB 表自动创建                    | `phase2.db`         | **执行** `curl /health`，db 字段 = `"ok"`                                                   |
| Type 检查零错误                  | `phase2.typecheck`  | **执行** TypeScript: `npx tsc --noEmit` / Python: `mypy` / Go: `go vet`，贴出输出           |
| **ESLint 零 error**              | `phase2.lint`       | **执行** `npx eslint --quiet .`（只报 error，warning 不拦），必须零 error                   |
| 零 console.log / print           | `phase2.noconsole`  | **执行** Grep: `rg "console\.(log                                                           | warn | error)" src/`(TS) /`rg "^\s\*print\(" src/` (Python)，应该零匹配 |
| .env.example 存在                | `phase2.envExample` | 文件存在，包含所有必需变量                                                                  |

---

## Phase 3: Core Features

**Goal**: 逐模块实现。**每个模块走完整个 per-module 流程再下一个**。

### Per-Module Workflow

```
┌─────────────────────────────────────────────────────────────┐
│  ① Design Doc（10-20 行）                                    │
│     → 写什么功能？API 端点？数据形状？                         │
├─────────────────────────────────────────────────────────────┤
│  ② Prompt Design（有 LLM 调用的模块）                         │
│     → 按 references/ai-patterns.md#4 规范生成 prompt          │
│     → 过 8 项 checklist                                       │
├─────────────────────────────────────────────────────────────┤
│ ③ Route + Handler                                           │
│     → 输入校验(Zod/Joi/Pydantic) → 业务逻辑 → 错误处理         │
│     → 参考 references/backend-patterns.md#1                  │
├─────────────────────────────────────────────────────────────┤
│ ④ Service Layer                                             │
│     → 业务逻辑 + costTracker 注入(有 LLM 调用时)                │
│     → 参考 references/backend-patterns.md#3                  │
├─────────────────────────────────────────────────────────────┤
│ ⑤ Frontend                                                  │
│     → 只做后端已暴露的 API 的 UI                               │
├─────────────────────────────────────────────────────────────┤
│ ⑥ Manual Test                                               │
│     → curl 端点 → 验证响应形状 → 验证错误路径                   │
├─────────────────────────────────────────────────────────────┤
│ ⑦ Commit                                                    │
│     → `type(feature): description`                            │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
    Per-Module Gate ←── 不通过则回去修
         │
         ▼
    还有下一个模块吗？──是──▶ 回到 ①
         │
        否
         ▼
    Phase 3 Gate（所有模块都过了）
```

### Per-Module Gate

| Gate                                 | 检查动作                                                           |
| ------------------------------------ | ------------------------------------------------------------------ |
| E2E 通                               | curl 端点 + 打开前端页面，走完整流程                               |
| 错误路径通                           | 发 bad request（缺字段、越界值）→ 返回 4xx 不崩                    |
| Cost Tracker 有记录                  | 执行 API 后 `SELECT * FROM ai_usage_logs WHERE feature = ?` 有新行 |
| Prompt Checklist 过（有 LLM 调用时） | 8 项全勾（references/ai-patterns.md#4f）                           |
| 已 commit                            | git log 有新 commit                                                |

### Phase 3 Exit Gate

| Gate                | Slug                | 检查动作                                               |
| ------------------- | ------------------- | ------------------------------------------------------ |
| 所有计划模块已完成  | `phase3.allModules` | 状态文件里记录了每个模块的完成时间                     |
| Type 检查仍然零错误 | `phase3.typecheck`  | 同 Phase 2 的 typecheck gate，**跑一遍确保没引入回归** |

---

## Phase 4: Cross-Cutting Concerns

**Goal**: 生产安全网。**不是可选的**。

### Actions

**4.1 Cost Tracking** — 所有 LLM + Embedding 调用都要 log usage。参考 `references/backend-patterns.md#3` + schema 在 `references/db-patterns.md`。

**4.2 Embedding Fallback** — hashVector 降级。参考 `references/ai-patterns.md#1`。

**4.3 Input Safety** — Prompt injection 检测。

**4.4 预算告警** — env var 阈值 + 80% warn / 100% block。

### Gate Check

| Gate                    | Slug                | 检查动作                                                                                                   |
| ----------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| 禁用 API key 仍能启动   | `phase4.degrade`    | 设 `ENABLE_MOCK_EMBEDDING=1` + 无效 LLM key → `curl /health` 仍返回 200，db 和 embedding 字段 `"degraded"` |
| Usage 查询有数据        | `phase4.usageQuery` | 执行一次 LLM 调用后，`curl /api/usage/today` 返回非零 total_tokens                                         |
| 预算阈值在 .env.example | `phase4.budgetEnv`  | `.env.example` 里有 `DAILY_BUDGET_USD=` 或类似变量                                                         |

---

## Phase 5: Productization

**Goal**: 像产品，不像原型。

### Actions（按 Phase 1 profile 选的项目做，不是全做）

1. Empty states + Loading
2. Error boundaries（白屏禁止）
3. Desktop wrapper（选了 Electron/Tauri 才做）
4. Build & deploy（按 Phase 1 选的 deployment）
5. DB migrations（选了 PG/MySQL 才做；SQLite 跳过）

### Gate Check

| Gate             | Slug                 | 检查动作                                                               |
| ---------------- | -------------------- | ---------------------------------------------------------------------- |
| 首屏不空         | `phase5.firstScreen` | 截图或打开页面，有内容有引导                                           |
| 无效配置不崩     | `phase5.badConfig`   | 删 .env 或填错 key → app 显示 "please configure" 页面                  |
| Fresh clone 能跑 | `phase5.freshClone`  | `rm -rf node_modules && npm install && npm run dev` 能在 10 分钟内启动 |

---

## Phase 6: Documentation & Handoff

**Goal**: 留后路。

### Actions

1. Architecture walkthrough（每个主要决策写 trade-off）
2. Portfolio Q&A（10 道硬决策题，面试准备）
3. Cost summary（一个月 token 费多少 + top 3 省钱手段）
4. Troubleshooting guide（Top 5 故障 + 修复）

### Gate Check

| Gate                     | Slug               | 检查动作                               |
| ------------------------ | ------------------ | -------------------------------------- |
| 新开发者 10 分钟内跑起来 | `phase6.fastStart` | （假装你是新开发者）按文档做一遍，计时 |
| 每个 "为什么" 有答案     | `phase6.rationale` | 随机挑 3 个技术决策，文档里能找到理由  |

---

## Gate 执行规则

1. **优先用脚本检查**：先跑 `node scripts/gate-check.js single <gate-slug>`，贴出结果
   - ✅ 好：`node gate-check.js single phase2.typecheck` → 脚本输出结果 → 判断
   - ⚠️ 脚本未覆盖的 gate：自己跑命令 + 贴输出 + 判断
   - ❌ 坏："typecheck 过了吗？"
2. **Gate 通过后立即运行 `node scripts/state.js pass <gate-slug>`** — 这会自动更新 JSON 并推进 phase
3. **Gate 失败 → 回到那个 gate 对应的 action 修复**，修复后**重新执行完整 gate 检查**
4. **Phase 1 填 profile/stack 时**，用 `node scripts/state.js set projectProfile.size startup-mvp` 而不是手动改 JSON
5. **每次 session 开始时先运行 `node scripts/state.js show`** — 确定 currentPhase 和哪些 gate 过了
6. **跳过 gate 要写理由** — 只有 Phase 3 per-module gate 可以临时 skip，其他不能跳过

---

## Anti-Patterns（工作流执行中的红线）

1. **Skip phases 或 gates** — 每一步都必须 pass 才能进下一步
2. **Gate 不执行命令只靠用户确认** — 跑命令，贴输出，自己判断
3. **状态文件不更新** — gate pass 立刻 update JSON
4. **一个 phase 搞 3 小时不 commit** — Phase 3 每个模块做完就 commit
5. **Prompt 不按规范写** — 按 references/ai-patterns.md#4 来，过 8 项 checklist
6. **成本不追踪** — 有 LLM 调用就注 costTracker
7. **Embedding 没降级** — 一定要加 hashVector fallback
8. **console.log 残留** — Phase 2 gate 就卡这个，Phase 3 回来再卡一次
9. **🚫 emoji 当 UI 图标** — 前端必须用组件库图标（lucide-vue-next / @iconify / element-plus icons 等）。emoji 只能用在纯文本消息里（如 chat 对话的 error 提示），不能出现在按钮、导航、状态徽章等 UI 组件上
10. **ESLint 配旧格式** — ESLint v9+ 必须用 `eslint.config.mjs`（flat config），不能用 `.eslintrc.*`。需要配置 Vue parser + TS parser 嵌套 + Nuxt/Vue 全局自动导入
11. **🚫 允许 lint/typecheck error 提交** — 前端（ESLint 0 errors, vue-tsc --noEmit 0 errors）和后端（tsc --noEmit 0 errors）必须零 error。warning 可以有，但 error 必须在 commit 前清零。Phase 2 gate 强制校验，pre-commit hook（husky + lint-staged）自动拦截

---

## References

### Scripts（零依赖 Node.js，开箱即用）

| Script                  | 作用          | 常用命令                                                                                      |
| ----------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| `scripts/state.js`      | 状态管理      | `init` / `show` / `pass <slug>` / `check <slug>` / `set <key> <val>` / `goto <1-6>` / `reset` |
| `scripts/gate-check.js` | 自动验证 gate | `run`（当前 phase）/ `phase <1-6>` / `single <slug>` / `list`                                 |
| `scripts/scaffold.js`   | 生成项目骨架  | `run` / `dry-run` / `list`                                                                    |

**典型工作流**：

```bash
node scripts/state.js init my-app              # 启动
node scripts/state.js set projectProfile.size startup-mvp
node scripts/state.js set techStack.backend express
node scripts/scaffold.js dry-run               # 预览骨架
node scripts/scaffold.js run                   # 生成骨架
# ... 写代码 ...
node scripts/gate-check.js run                 # 自动检查当前 phase 所有 gate
node scripts/state.js pass phase2.typecheck    # 标记通过（自动推进 phase）
node scripts/state.js show                     # 随时看进度
```

### Code Patterns（可复制到任何项目）

| File                             | What's In It                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `references/backend-patterns.md` | Express + Zod routes, DB facade, cost tracker, logger, middleware, health check                                                                  |
| `references/ai-patterns.md`      | Embedding hash fallback, cosine similarity, SSE stream, **Prompt Design Specification** (rules + anti-patterns + 8-item checklist), RAG pipeline |
| `references/db-patterns.md`      | ai_usage_logs + RAG tables (SQLite + PG), 9 compatibility rules, multi-driver INSERT                                                             |

---

## Decision Reference（选型速查）

### LLM Provider

| Need                    | Pick                                               |
| ----------------------- | -------------------------------------------------- |
| Quick prototype, China  | Zhipu AI (glm-4-flash)                             |
| US market               | OpenAI (gpt-4o-mini for cheap, gpt-4o for quality) |
| Fully offline / private | Ollama + llama3                                    |
| Budget-conscious        | DeepSeek (deepseek-chat)                           |

### Vector Store

| Scale                   | Pick                               |
| ----------------------- | ---------------------------------- |
| < 100K docs, zero infra | SQLite + cosine similarity, DuckDB |
| 100K — 10M              | PostgreSQL + pgvector              |
| > 10M or hybrid search  | Pinecone, Qdrant, Weaviate         |

### Frontend

| Need            | Pick                                            |
| --------------- | ----------------------------------------------- |
| SSR + SEO       | Nuxt 3 (Vue) or Next.js (React)                 |
| SPA / dashboard | Vite + Vue + Pinia, Vite + React + Zustand      |
| Mobile          | React Native + Expo, Flutter                    |
| Desktop         | Electron (Node) or Tauri (Rust, smaller binary) |

### DB

| Need                  | Pick                                        |
| --------------------- | ------------------------------------------- |
| Local-first, embedded | SQLite                                      |
| Standard web app      | PostgreSQL                                  |
| Serverless            | DynamoDB, PlanetScale, Upstash              |
| Document-shaped data  | MongoDB (only if genuinely document-shaped) |
