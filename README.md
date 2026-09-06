# 🧠 AI Study · AI 组件生成器平台

> 以「AI 组件/Skill 生成器」为核心的全栈应用 — Node BFF + LangChain 编排层，PostgreSQL + pgvector / SQLite 双驱动数据库。

---

## ✨ 产品与工程亮点

### 🎯 产品主线：AI 组件/Skill 生成器 ⭐

用户输入自然语言需求（如「带防抖搜索框 + 下拉建议」）→ Agent 多轮细化 → RAG 检索组件库源码 → LangChain 生成代码 → Function Calling 工具链 → SSE 流式输出 + 迭代修改。

双模式支持：
- 🧩 **组件生成**：Vue 3 / React 18 前端组件
- 🤖 **Skill 生成**：Trae IDE Skill（TS / PY / 无脚本）

### 🛠️ 工程亮点

- **Monorepo（pnpm workspace）** — 6 个子项目统一管理，`@ai-study/shared` 共享类型/常量
- **PostgreSQL + pgvector / SQLite 双驱动** — 零配置切换，SQLite 零依赖开发，PG 生产级向量检索（HNSW 索引）
- **Drizzle ORM** — 类型安全 schema 管理 + 迁移
- **BFF 中间件管线（5 层）** — rateLimit → metrics → cache → circuitBreaker → requestLogger
- **统一日志体系** — `services/logger.ts` 零依赖门面 + 环形缓冲区 + SSE 实时推送，打开 `localhost:3001/api/logs-view` 即看全链路（DB/LLM/Generator/HTTP）
- **Node BFF（Express）** — LangChain 100% 在 BFF 层运行，前端仅 HTTP 调用，API Key 永不暴露
- **安全约束** — 所有 AI 调用（Generator/Agent/Chat）统一走 BFF，AI_API_KEY 只在 `apps/server/.env` 读取
- **SSE 流式通信** — 生成器/Agent/Chat 全链路 SSE 流式输出

---

## 📁 项目结构

```
ai_study/
├── apps/
│   ├── server/              # Node BFF（Express :3001）— LangChain 编排层 + 数据库
│   │   ├── src/
│   │   │   ├── routes/      #   9 个路由模块
│   │   │   │   ├── generator.ts   # /api/generator/* — 生成器 run + iterate
│   │   │   │   ├── agent.ts       # /api/agent/* — Agent 会话
│   │   │   │   ├── chat.ts        # /api/chat — 简单对话
│   │   │   │   ├── sessions.ts    # /api/sessions — 会话管理
│   │   │   │   ├── documents.ts   # /api/documents — RAG 文档上传
│   │   │   │   ├── kb.ts          # /api/kb — 知识库管理
│   │   │   │   ├── rag.ts         # /api/rag — 检索接口
│   │   │   │   ├── tools.ts       # /api/tools — 工具注册
│   │   │   │   └── logs.ts        # /api/logs — 日志查询 + SSE 实时流
│   │   │   ├── middleware/  #   rateLimit · metrics · cache · circuitBreaker · logger · errorHandler
│   │   │   ├── services/    #   chain/ · generator/ · rag/ · agent/ · tools/ · logger.ts · embedding.ts
│   │   │   ├── db/index.ts  #   DB 门面（SQLite / PG 双驱动 + SQL 自动转换）
│   │   │   └── drizzle/     #   Drizzle schema + migrations
│   │   ├── public/
│   │   │   └── logs-view.html  # 📋 浏览器日志查看器（单文件 HTML + EventSource）
│   │   └── .env.example     #   环境变量模板（数据库 + AI 接口配置）
│   ├── generator/           # AI 生成器前端（Nuxt 3 SSR :3003）— 产品主线
│   │   ├── pages/index.vue  #   主页面（双模式 Tab + 对话式迭代 + 浅色主题）
│   │   ├── layouts/         #   侧边栏导航
│   │   └── assets/css/      #   Tailwind + 自定义气泡/代码样式
│   ├── web-vue-nuxt/        # Vue 3 SSR（Nuxt 3 :3002）
│   │   └── pages/           #   m1.vue ~ m7.vue
│   ├── web-react/           # React 18 SPA（Vite :5173）
│   └── web-vue/             # Vue 3 SPA（Vite :5174）
├── packages/
│   └── shared/              # @ai-study/shared — 公共类型/常量/DTO
├── docs/                    # 📚 设计与技术文档
├── scripts/                 # 项目脚本
├── pnpm-workspace.yaml      # workspace：apps/* + packages/*
└── package.json             # 根脚本 + pnpm overrides（版本锁定）
```

---

## 🗄️ 数据库架构

### 双驱动切换

通过 `DATABASE_DRIVER` 环境变量零配置切换：

```env
# SQLite（默认，零依赖，适合本地快速跑通）
DATABASE_DRIVER=sqlite
DB_PATH=./data/knowledge.db

# PostgreSQL + pgvector（生产推荐，向量检索 HNSW 索引）
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://ai_study:123456@localhost:5432/ai_study
```

DB 门面（`src/db/index.ts`）自动处理 SQLite → PG 的差异：
- `?` 占位符 → `$1, $2, $3...`
- 裸表名 `sessions` → `app.sessions`（PG schema，带 SQL 关键字白名单防误匹配）
- 毫秒时间戳（> 1e12）→ ISO 字符串（TIMESTAMPTZ）

### PostgreSQL + pgvector 安装

```sql
-- 1. 安装 pgvector 扩展（PostgreSQL 17 + pgvector 0.8.x）
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 创建数据库（可选：ai_study 受限用户）
CREATE DATABASE ai_study;
CREATE USER ai_study WITH PASSWORD '123456';
GRANT ALL PRIVILEGES ON DATABASE ai_study TO ai_study;

-- 3. Schema 自动创建（BFF 启动时 `initDatabase()` 执行 Drizzle migrate）
--    app.documents · app.chunks · app.sessions · app.messages · app.agent_states
--    app.generator_sessions · app.generator_files · app.generator_states
```

### pgvector 向量索引

`app.chunks.embedding = vector(1536)` + HNSW 索引：

```sql
CREATE INDEX idx_chunks_embedding ON app.chunks
  USING hnsw (embedding vector_cosine_ops);
```

### 中间件管线 & 日志

```
请求进入 → rateLimit → metrics → cache → circuitBreaker → requestLogger → 业务路由
                                                                          ↓
                                                              services/logger.ts 门面
                                                                          ↓
                                              ┌───────────────────────────┼───────────────────────────┐
                                              ▼                           ▼                           ▼
                                         stdout（彩色）          环形缓冲区（2000条）          SSE 广播
                                                                                              ↓
                                                                                   /api/logs-view（浏览器）
```

9 个 DB 表、每次 SQL 执行、每次 LLM 调用、每个 Generator 节点——全部自动打点，requestId 通过 AsyncLocalStorage 贯穿整条请求链。

---

## 🔌 端口规划

| 项目 | 端口 | 说明 |
|------|------|------|
| `apps/server`          | **:3001** | Node BFF（LangChain + DB + 所有 API） |
| `apps/generator`       | **:3003** | AI 组件/Skill 生成器（Nuxt 3 SSR） |
| `apps/web-vue-nuxt`    | **:3002** | Vue 3 SSR |
| `apps/web-react`       | **:5173** | React 18 SPA |
| `apps/web-vue`         | **:5174** | Vue 3 SPA |

---

## 🚀 快速开始

### 环境要求

| 工具 | 版本要求 |
|------|---------|
| **Node.js** | **>= 18.17 < 20.19**（推荐 18.20.x LTS） |
| **pnpm** | **9.15.x**（严格匹配 `packageManager` 字段） |
| OS | Windows / macOS / Linux |

**可选**（生产模式）：
| 工具 | 版本要求 | 说明 |
|------|---------|------|
| **PostgreSQL** | **17.x** | `DATABASE_DRIVER=postgres` 时必需 |
| **pgvector** | **0.8.x** | `CREATE EXTENSION vector` 用于向量检索 HNSW |

### 安装依赖

```bash
git clone https://github.com/18342403-gxh/ai_study.git
cd ai_study

npx pnpm@9.15.9 install --no-frozen-lockfile --store-dir=node_modules/.pnpm-store
```

> 🪟 Windows 出现 `ERR_PNPM_EPERM`：加 `--store-dir=node_modules/.pnpm-store`

### 配置环境变量

```bash
copy apps\server\.env.example apps\server\.env      # Windows
```

编辑 `.env`，**至少修改 3 项**：

```env
# ① AI 接口（必须填）
AI_API_KEY=你的真实key
AI_MODEL=glm-4-flash           # 或 glm-4-plus / glm-4 / gpt-4o-mini 等
EMBEDDING_MODEL=embedding-3    # 用于 RAG 向量检索

# ② 数据库（可选，默认 SQLite 零配置可用）
DATABASE_DRIVER=sqlite         # 直接用，数据存在 ./data/knowledge.db
# DATABASE_DRIVER=postgres
# DATABASE_URL=postgresql://ai_study:123456@localhost:5432/ai_study
```

**多厂商兼容**（修改 `AI_API_URL` 即可）：
| 厂商 | AI_API_URL | 示例模型 |
|------|-----------|---------|
| 智谱 AI（默认） | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` / `glm-4-plus` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` / `gpt-4o` |
| 阿里通义 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` / `qwen-max` |
| 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | 你的 endpoint ID |

### 一键启动

```bash
# 生成器 + BFF（最常用）
npx pnpm@9.15.9 run dev:all
```

启动后 BFF 会自动在浏览器打开 **📋 实时日志**（`localhost:3001/api/logs-view`）。

访问地址：
| 服务 | URL |
|------|-----|
| 🧩 **AI 组件/Skill 生成器** | http://localhost:3003/ |
| 📋 **实时日志查看器** | http://localhost:3001/api/logs-view（BFF 启动自动打开） |
| BFF 健康检查 | http://localhost:3001/api/health |
| Vue 3 SSR | http://localhost:3002/ |
| React SPA | http://localhost:5173/ |
| Vue 3 SPA | http://localhost:5174/ |

> 💡 禁用 BFF 自动打开日志页：`NO_AUTO_OPEN=1 pnpm run dev:all`

---

## 📜 命令速查

| 命令 | 作用 |
|------|------|
| `pnpm run dev` | BFF + React |
| `pnpm run dev:all` | BFF + Generator(3003) + SSR(3002) + React + Vue（最全） |
| `pnpm run dev:server` | 仅 BFF :3001 |
| `pnpm run dev:generator` | 仅生成器 :3003 |
| `pnpm run dev:ssr` | 仅 Vue 3 SSR :3002 |
| `pnpm run build` | 生产构建 |
| `pnpm run typecheck` | 全量 TS 检查 |

### 单独运行某个子项目

```bash
pnpm --filter @ai-study/server dev        # tsx watch
pnpm --filter @ai-study/generator dev     # Nuxt 3 :3003
pnpm --filter @ai-study/web-vue-nuxt dev --port 3002
pnpm --filter @ai-study/shared build      # 改 shared 类型后先跑
```

---

## 🔧 核心模块开发指南

### BFF（apps/server · Express :3001）

**职责**：LangChain 100% 在此运行，API Key 唯一场所，前端通过 HTTP 调用。

**中间件管线**：
```
cors → json parser → rateLimit → metrics → cache → circuitBreaker → requestLogger → routes → 404 → errorHandler
```

**目录**：
- `src/services/logger.ts` — **统一日志门面**（零依赖 `AsyncLocalStorage`，所有模块 `import { logger } from '...'` 即可）
- `src/services/chain/model.ts` — LLM 调用层（invoke + stream 已接入完整日志）
- `src/services/generator/` — 生成器编排（agent.ts · codegen.ts · 5 节点 Agent Loop）
- `src/db/index.ts` — DB 门面（SQLite 同步 → Promise 包装 / PG 异步 + SQL 自动转换 + 每次执行自动日志）
- `public/logs-view.html` — 📋 日志查看器（EventSource SSE 实时流 + tag/level 过滤 + 搜索）

### AI 生成器（apps/generator · Nuxt 3 :3003）

**职责**：产品主线前端，对话式生成 + 迭代修改。

**核心交互**：
- 首次生成：输入需求 → SSE 流式接收 → 多文件代码产出
- 迭代修改：生成完成后主输入框自动切换为"💡 迭代模式" → 继续描述修改 → 后端 stateId 驱动多轮修改
- 提交后输入框自动清空

---

## 📚 技术文档（docs/）

| 编号 | 文档 | 难度 |
|------|------|------|
| 18 | Generator 技术拆解 | ⭐⭐⭐ |
| 20 | 日志体系 & 可观测性 | ⭐⭐ |

---

## 🐛 常见问题与排错

### Q1: 想换成 PostgreSQL
1. 安装 PostgreSQL 17 + pgvector 0.8.x 扩展
2. 改 `.env`：`DATABASE_DRIVER=postgres` + `DATABASE_URL=...`
3. BFF 启动时自动执行 Drizzle migrate 创建所有表
4. 报错 `syntax error at or near "app"` → DB 里**没有 `app` schema**，运行 `CREATE SCHEMA IF NOT EXISTS app;`

### Q2: pgvector `vector` type 不存在
`CREATE EXTENSION IF NOT EXISTS vector;` 然后重试。pgvector 是独立扩展，不是 PostgreSQL 核心。

### Q3: BFF 返回 500 / `API Key missing`
检查 `apps/server/.env` 是否从 `.env.example` 复制且 `AI_API_KEY` 真实填写。

### Q4: Nuxt 端口被占用
```powershell
Get-NetTCPConnection -LocalPort 3001,3002,3003 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### Q5: CircuitBreaker 把 SSE 流搞崩
错误 `ERR_HTTP_HEADERS_SENT`：SSE 流 headers 在第一条 `res.write()` 时已发出，circuitBreaker 拦截 `res.end()` 时不应再 `setHeader`。已修复：`checkResult()` 开头加 `if (res.headersSent) return`。

### Q6: qualifySchema 把 SQL 关键字当表名
`ON CONFLICT ... DO UPDATE SET ...` 里的 `SET` 被正则匹配成表名加了 `app.` 前缀。已修复：加 SQL 关键字白名单（SET/ON/WHERE/VALUES/CONFLICT/DO/EXCLUDED 等）。

### Q7: 看日志排查 Generator 问题
打开 `localhost:3001/api/logs-view` → tag 下拉选 `llm.stream` 看 AI 调用、选 `db` 看 SQL 执行、选 `generator.*` 看业务节点。**同一个 requestId 的日志会聚集在一起**，完整展示一条请求的 DB → LLM → Generator 调用链。

---

## 📄 License

MIT
