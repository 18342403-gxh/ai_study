# 🧠 AI Study · AI 组件生成器平台

> 面向 AI 时代的前端工程实践平台 — 以「AI 组件生成器」为产品主线，配套 Node BFF + LangChain 编排层，支持 Vue 3 SSR（Nuxt 3）/ React / Vue SPA 三端对照。

---

## ✨ 产品与工程亮点

### 🎯 产品主线：AI 组件生成器 ⭐

用户输入自然语言需求（如「带防抖搜索框 + 下拉建议」）→ Agent 多轮细化 → RAG 检索组件库源码 → LangChain 生成代码 → Function Calling 工具链 → 流式输出 + 沙箱预览 + 迭代导出。

7 个核心技术环节在生成器中的角色：

| 环节 | 生成器角色 | 关键词 |
|------|-----------|--------|
| API 基础 | LLM 调用层基座 | fetch · AbortController · 错误分类 |
| 流式响应 | 代码流式逐行输出 | ReadableStream · SSE · 粘包处理 · 打字机光标 |
| Prompt 工程 | 代码生成 Prompt 模板 | System Prompt（前端架构师人设）· JSON Mode · 滑动窗口 |
| Chat UI | 需求对话界面 | 消息气泡 · Markdown 渲染 · 引用来源 · 长列表虚拟滚动 |
| Function Calling | 工具调用层（5 个工具） | create_file · run_preview · generate_props · generate_tests · validate_code |
| RAG 知识库 | 组件库源码检索 | PDF/MD/Text Loader · 中文友好切分 · Embeddings · 向量库可插拔 |
| AI Agent | 多轮迭代循环（5 节点） | clarify → retrieve → generate → preview → iterate + Human-in-the-loop |

### 🛠️ 工程亮点

- **Monorepo（pnpm workspace）** — 6 个子项目统一管理，`@ai-study/shared` 共享类型/常量
- **三端对照架构**：
  - 🥇 **Vue 3 SSR（Nuxt 3）** — 主端
  - 🥈 **React 18 SPA** — 对照端（完整实现）
  - 🥉 **Vue 3 SPA（Vite）** — 对照端（骨架）
- **Node BFF（Express）** — SSR 端与生成器共用，LangChain 100% 在此层运行，Nitro 仅透明转发
- **Electron 桌面端** — 方案预留（待 SSR 主线完成后启动）
- **安全约束** — API Key 只在 `apps/server` 读 `process.env`，工具 Schema/敏感逻辑 100% 放 BFF，前端仅传白名单
- **C 端体验优先** — 默认 375px 移动端视口，安全区适配/1px 细线/点击态三态齐全

---

## 📁 项目结构

```
ai_study/
├── apps/
│   ├── server/              # Node BFF（Express :3001）— LangChain 编排层（services/*）
│   │   ├── src/routes/      #   /api/chat · /api/documents · /api/kb · /api/tools · /api/rag · /api/agent
│   │   └── src/services/    #   chain/ · tools/ · rag/ · agent/ · generator/（生成器编排）
│   ├── web-vue-nuxt/        # Vue 3 SSR（Nuxt 3 :3002）— 主端
│   │   ├── pages/           #   约定式路由（m1.vue ~ m7.vue）
│   │   ├── layouts/         #   布局系统（头部 + 底部 TabBar）
│   │   └── composables/     #   useStreaming · useAiChat · useTokenCounter 等
│   ├── web-react/           # React 18 SPA（Vite :5173）— 对照端
│   ├── web-vue/             # Vue 3 SPA（Vite :5174）— 对照端
│   ├── generator/           # AI 生成器（Nuxt 3 SSR :3003）— 产品主线，支持组件 / Skill 双模式
│   └── desktop/             # Electron 桌面端（方案预留，当前不开发）
├── packages/
│   └── shared/              # @ai-study/shared — 公共类型/常量/DTO
│       ├── src/types/       #   ChatMessage · Document · KnowledgeBase · ToolWhiteListItem · AgentTimelineStep
│       └── src/constants/   #   API endpoints · Module IDs
├── scripts/                 # 项目脚本（pre-commit / setup-hooks / check-readme）
├── tsconfig.base.json       # TypeScript 基准配置（所有子项目 extends）
├── pnpm-workspace.yaml      # workspace：apps/* + packages/*
└── package.json             # 根脚本 + pnpm overrides（版本锁定）
```

---

## 🔌 端口规划

| 项目 | 端口 | 说明 |
|------|------|------|
| `apps/server`          | **:3001** | Node BFF（SSR 端 + 生成器端共用） |
| `apps/web-vue-nuxt`    | **:3002** | Nuxt 3 SSR 主端（默认 3002，:3000 常被占用） |
| `apps/generator`       | **:3003** | AI 生成器（Nuxt 3 SSR）— 组件 / Skill 双模式 |
| `apps/web-react`       | **:5173** | React SPA |
| `apps/web-vue`         | **:5174** | Vue 3 SPA |
| `apps/desktop`         | 开发期不占端口（loadURL → :3003） | Electron 预留 |

---

## 🚀 快速开始

### 环境要求

| 工具 | 版本要求 | 说明 |
|------|---------|------|
| **Node.js** | **>= 18.17 < 20.19**（推荐 18.20.x LTS） | 20.19+ 会触发 `unplugin@3.x` 的 `import.meta.dirname` 崩溃；Node 22+ 需自行升级 unplugin |
| **pnpm** | **9.15.x**（严格匹配 `packageManager` 字段） | 已通过 pnpm `overrides` 锁定 `nuxi=3.13.2` + `unplugin=1.16.1` |
| OS | Windows / macOS / Linux | — |

### 安装依赖

```bash
git clone https://github.com/18342403-gxh/ai_study.git
cd ai_study

# 【推荐】npx 临时调用 pnpm，无需全局安装，避免权限问题
npx pnpm@9.15.9 install --no-frozen-lockfile --store-dir=node_modules/.pnpm-store

# 或全局安装：
npm install -g pnpm@9.15.9
pnpm install --no-frozen-lockfile
```

> 🪟 Windows 出现 `ERR_PNPM_EPERM`：加 `--store-dir=node_modules/.pnpm-store`
>
> 🔒 必须 `--no-frozen-lockfile`：`pnpm.overrides` 修改后需更新 lockfile 签名，否则 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`

### 配置环境变量

本项目的 API Key **只在 BFF 服务端读取**（`apps/server/.env`），前端代码不含任何密钥。

```bash
# 1. 复制模板（不要直接改 .env.example）
copy apps\server\.env.example apps\server\.env      # Windows
# cp apps/server/.env.example apps/server/.env      # macOS / Linux

# 2. 编辑 apps/server/.env，填入你的 API Key：
#    AI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
#
#    可选：更换模型 / 接口地址（默认智谱 AI，兼容 OpenAI 协议的厂商均可）
#    AI_API_URL=https://api.openai.com/v1
#    AI_MODEL=gpt-4o-mini
#    EMBEDDING_MODEL=text-embedding-3-small
```

**`.env` 文件安全说明**：
- `.env` 已在 `.gitignore` 中被忽略，**绝对不会被提交到 git**
- 提交前运行 `git status`，确认 `.env` 不在 staged 列表里
- 如果之前误提交过密钥，立即到对应厂商控制台**重新生成新 Key**

### 一键启动

```bash
# BFF + SSR 主端 + React + Vue SPA（全量并行）
npx pnpm@9.15.9 run dev:all

# 仅 Nuxt 3 SSR 主端（推荐）
npx pnpm@9.15.9 run dev:ssr

# BFF + React（原项目模式）
npx pnpm@9.15.9 run dev
```

启动后访问：
- SSR 主端 → http://localhost:3002/
- React → http://localhost:5173/
- Vue → http://localhost:5174/
- BFF 健康检查 → http://localhost:3001/api/health

---

## 📜 命令速查

> 所有命令前缀：`npx pnpm@9.15.9`（或直接 `pnpm` 若已全局安装）

### 根目录脚本

| 命令 | 作用 | 涉及端口 |
|------|------|---------|
| `pnpm run dev` | 默认：BFF + React | `:3001` + `:5173` |
| `pnpm run dev:all` | 全量并行：BFF + SSR + React + Vue | `:3001` + `:3002` + `:5173` + `:5174` |
| `pnpm run dev:ssr` | 仅 Nuxt 3 SSR | `:3002` |
| `pnpm run dev:react` | 仅 React SPA | `:5173` |
| `pnpm run dev:vue` | 仅 Vue 3 SPA | `:5174` |
| `pnpm run dev:server` | 仅 Node BFF | `:3001` |
| `pnpm run build` | 生产构建：shared → BFF → 三端 | — |
| `pnpm run build:shared` | 仅构建 `@ai-study/shared`（改类型后先跑） | — |
| `pnpm run build:ssr` | 仅构建 Nuxt SSR（`.output/`） | — |
| `pnpm run typecheck` | 全量 TS 类型检查 | — |
| `pnpm run lint` | ESLint 检查 | — |
| `pnpm run format` | Prettier 格式化 | — |
| `pnpm run check:readme` | **检查 README 是否需要同步更新**（关键配置变更会提醒） | — |

### 子项目独立命令（`--filter` 精准命中）

```bash
# 只对 Nuxt SSR 执行 <cmd>
pnpm --filter @ai-study/web-vue-nuxt <cmd>

# 或进入目录执行
cd apps/web-vue-nuxt && pnpm <cmd>
```

| 包名 | 目录 | 独立命令 |
|------|------|---------|
| `@ai-study/server` | `apps/server` | `dev`（tsx watch）<br>`build`（tsc → dist/）<br>`start`（node dist/index.js，生产模式） |
| `@ai-study/web-vue-nuxt` | `apps/web-vue-nuxt` | `dev --port 3002`<br>`build`（Nitro → `.output/`）<br>`preview`（预览构建产物）<br>`typecheck`（nuxi typecheck） |
| `@ai-study/web-react` | `apps/web-react` | `dev`（Vite :5173）<br>`build` → `dist/`<br>`preview`（:4173） |
| `@ai-study/web-vue` | `apps/web-vue` | `dev`（Vite :5174）<br>`build` → `dist/`<br>`preview`（:4174） |
| `@ai-study/shared` | `packages/shared` | `dev`（tsup watch）<br>`build`（tsup → cjs/esm/d.ts） |

---

## 🔧 子项目开发指南

### BFF（apps/server · Express :3001）

**职责**：唯一触碰 API Key 的地方；LangChain 编排层 100% 在此运行；前端/Nitro 仅 HTTP 调用。

**目录**：
- `src/routes/*.ts` — 对外 HTTP 入口（m5/m6/m7 专用路由 + BFF 公共路由）
- `src/services/generator/` — 生成器编排（agent/codegen/rag/tools/*/sandbox）
- `src/db/index.ts` — Better-SQLite3 知识库
- `uploads/` — RAG 文档上传目录
- `data/knowledge.db*` — SQLite 向量库文件（随项目生成）

```bash
pnpm run dev:server
# 生产：pnpm run build:server && pnpm --filter @ai-study/server start
```

### Nuxt 3 SSR 主端（apps/web-vue-nuxt · :3002）

**职责**：C 端主阵地，默认 375px 视口。

**约定式路由**：

| 文件 | 路由 | 环节 |
|------|------|------|
| `pages/index.vue` | `/` | 首页 |
| `pages/m1.vue` | `/m1` | API 基础 |
| `pages/m2.vue` | `/m2` | 流式响应 |
| `pages/m3.vue` | `/m3` | Prompt 工程（待创建） |
| `pages/m4.vue` | `/m4` | Chat UI |
| `pages/m5.vue` | `/m5` | Function Calling（待创建） |
| `pages/m6.vue` | `/m6` | RAG 知识库（待创建） |
| `pages/m7.vue` | `/m7` | Agent |

**关键目录**：
- `layouts/default.vue` — 全局布局（Header + TabBar + 安全区）
- `composables/` — useStreaming / useAiChat / useTokenCounter / useConversationSwitcher
- `stores/` — Pinia（多会话历史 + Citation 映射）
- `assets/css/main.css` — Tailwind 入口 + 1px 细线 `.hairline-bottom`
- `app.vue` — 根入口：`<NuxtLayout><NuxtPage /></NuxtLayout>`

### React 对照端（apps/web-react · :5173）

**职责**：Vue 3 SSR 主端的代码对照参考。模块目录：`src/modules/01-api-basics/` ~ `src/modules/07-agent/`。

### 共享包（packages/shared）

**职责**：四端 + BFF 共同引用的类型/常量/DTO 唯一事实来源。

暴露：`ChatMessage / Document / KnowledgeBase / ToolWhiteListItem / AgentTimelineStep / API_ENDPOINTS / MODULE_IDS / ALLOWED_TOOL_WHITELIST`

改动流程：改 `src/**` → `pnpm run build:shared` → 各端 alias 自动拾取（alias 指向 `src/index.ts`，不需先构建）

---

## 🐛 常见问题与排错

### Q1: Nuxt 页面「Error while loading Nuxt」+ 网络 503
**根因 A（90% 情况）**：`unplugin@3.x` 需 Node 20.19+/22.12+（用了 `import.meta.dirname`），Node 18 下 SSR 初始化崩溃。
修复：本仓库根 `package.json` 已 override 锁定，重新生效：
```bash
pnpm install --no-frozen-lockfile --store-dir=node_modules/.pnpm-store
# 验证：node_modules/.pnpm/ 下存在 unplugin@1.16.1
```

**根因 B**：`nuxt.config.ts` 用了 CJS 独有的 `__dirname`。
修复：
```ts
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
```

### Q2: `pnpm install` 报 `ERR_PNPM_EPERM`
修复：`pnpm install --store-dir=node_modules/.pnpm-store`

### Q3: Nuxt 端口被占用（get-port 自动切端口）
```powershell
# Windows：杀占用 3000/3001/3002 的进程
Get-NetTCPConnection -LocalPort 3000,3001,3002 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
# 强制指定端口
cd apps/web-vue-nuxt && pnpm dev --port 3002
```

### Q4: BFF 返回 500 / `API Key missing`
检查：`apps/server/.env` 文件名正确（从 `.env.example` 复制），Key 真实存在。前端 env **不会**读取 Key，BFF 才读取 `process.env`。

### Q5: SSR 刷新后白屏 / Hydration Mismatch 常见场景
1. `onMounted` 修改 SSR 已有 DOM → 包 `<ClientOnly>`
2. `useState`/ref 初始化用 `Math.random()`/`Date.now()` → SSR/客户端值不一致
3. Pinia store 在 server 插件直接赋值未隔离 → 用 `useCookie` 或每请求 new store
4. `<div v-html>` SSR 与客户端内容不同 → 给容器加 `:key` 强制重建
5. `<script setup>` 顶层用 `window.location` 等浏览器 API → 包 `if (process.client)` 或 `onMounted`

### Q6: 改 shared 包类型后 IDE 仍报红
1. `pnpm run build:shared`
2. VS Code：命令面板 → `TypeScript: Restart TS Server`
3. Nuxt 端：`pnpm --filter @ai-study/web-vue-nuxt run typecheck`

---

## � README 同步规则（节省 token）

> 每次提交代码或改动关键配置前，先跑：
> ```bash
> pnpm run check:readme
> ```

**判断逻辑（由 `scripts/check-readme-needs-update.mjs` 实现）**：
对以下「影响 README 的关键信息」取 hash 指纹，与上次已同步指纹对比：
- `package.json`（scripts、pnpm.overrides、packageManager）
- `apps/*/package.json`（name、scripts.dev 默认端口、版本）
- `packages/*/package.json`（name、包列表变化）
- `pnpm-workspace.yaml`（workspace 定义）
- `apps/` 与 `packages/` 目录列表（新增/删除子项目）
- `README.md` 自身最后修改时间

**结果说明**：
- ✅ **「不需要更新」**：hash 一致 → 直接跳过，**不浪费任何 token** 在 README 重写/润色上
- ⚠️ **「需要更新」**：hash 变化 → 打印具体哪些关键项变了（端口/脚本/子项目/别名等），提示手动或让 AI 更新 README，完成后再跑 `pnpm run check:readme` 自动更新指纹。

脚本与指纹文件位置：
- `scripts/check-readme-needs-update.mjs`
- `.trae-configs/readme-sync-fingerprint.json`（自动生成，git 可提交）

---

## 📄 License

MIT
