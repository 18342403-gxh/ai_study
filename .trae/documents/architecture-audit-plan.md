# 11 层架构补齐实施方案

> 目标：按依赖顺序补齐 **质量层 → CI/CD → 安全层 → 契约层 → 观测层 → 演化层 → 依赖层** 七层；
> 结构层/构建层/体验层/治理层/演化层已有基础，仅做轻量补强；治理层暂跳过（教学项目体量，commitlint 后续加）。

---

## Phase 0：前置依赖（先做，其他 Phase 依赖它们）

### 0.1 vitest.config.ts + 测试目录骨架

**现状**：只有 2 个测试文件（`services/rag/__tests__/bm25.test.ts`、`rrf.test.ts`），没有 vitest 配置，跑测试靠 `npx vitest run src/...` 临时指定。

**改动文件**：

- 新建 `apps/server/vitest.config.ts` — 配置 testMatch、coverage、globals
- 新建 `apps/server/src/services/generator/__tests__/agent.test.ts` — generator agent 输入验证
- 新建 `apps/server/src/services/tools/__tests__/engine.test.ts` — 工具执行引擎
- 新建 `apps/server/src/services/chain/__tests__/model.test.ts` — LLM 调用错误分类
- 新建 `apps/server/src/routes/__tests__/generator.integration.test.ts` — generator 路由集成测试（用 supertest）
- 根 `package.json` scripts 加 `test:server:vitest`、`test:all`

**关键点**：

- 测试文件命名统一 `*.test.ts` 或 `*.integration.test.ts`
- 使用 `vitest` + `@vitest/coverage-v8`
- 集成测试用 `supertest`（Express 生态标准）
- **mock LLM API 调用**（不能每次都花钱）

### 0.2 约定根 package.json 的测试/构建脚本

**现状**：根 `pnpm test` 不存在，每个 app 的 test 命令不统一。

**改动**：根 package.json 加：

```
"test": "pnpm -r test",
"test:coverage": "pnpm -r test:coverage",
"audit": "pnpm audit --audit-level=high",
"build:all": "pnpm --filter @ai-study/shared build && pnpm build"
```

---

## Phase 1：CI/CD 补齐（依赖 Phase 0）

**现状**：ci.yml 只有 lint + typecheck，不验证 build 和 test。

**改动文件**：`.github/workflows/ci.yml`

**新增步骤**（在现有 lint-and-typecheck job 之后）：

```yaml
jobs:
  lint-and-typecheck:
    # 现有内容不变

  build:
    needs: lint-and-typecheck
    runs-on: ubuntu-latest
    steps:
      # checkout + pnpm + node setup 同上
      - name: Build shared package first
        run: pnpm --filter @ai-study/shared build
      - name: Build all apps
        run: pnpm build

  test:
    needs: build
    runs-on: ubuntu-latest
    services:
      # SQLite 不需要 PG，直接跑
    steps:
      - name: Run unit + integration tests
        run: pnpm test
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        if: always()

  audit:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Dependency audit
        run: pnpm audit --audit-level=high
      - name: Report only, don't block
        if: failure()
        run: echo "Security audit has findings - review needed"
```

**新增 workflow**：`.github/workflows/dependency-upgrade.yml`（可选，Dependabot 或 Renovate 自动升级）

---

## Phase 2：安全层

### 2.1 CSP + Helmet

**现状**：Express `index.ts` 里只有 `cors()`，没有安全头。Nuxt generator 没有 securityHeaders。

**改动文件**：

- `apps/server/src/index.ts` — 加 `import helmet from 'helmet'`，在 `cors()` 之后、`app.use(express.json())` 之前插入 `app.use(helmet())`
- `apps/server/package.json` — 加 `helmet` 依赖
- `apps/generator/nuxt.config.ts` — 加 `@nuxtjs/security` module 配置 script-src/style-src 白名单（需要明确允许的 CDN、字体、inline script 等）

**风险**：CSP 如果配太严，会把 Nuxt 自动注入的 inline script 全拦了。需要**先开 report-only 模式**（CI 环境看报错），再逐步收紧。

### 2.2 Zod 全覆盖 routes

**现状**：后端审计报告标了 routes 层 Zod 覆盖不完全。

**操作**：逐个 routes 文件检查每个 endpoint 的 body/query/params 是否有 validate({ body/query/params: z.object({...}) })。

**涉及文件**（逐个检查补齐）：

- `routes/documents.ts`
- `routes/rag.ts`
- `routes/sessions.ts`
- `routes/tools.ts`
- `routes/agent.ts` — SSE 流式，body 也要校验
- `routes/chat.ts`
- `routes/cost.ts`
- `routes/logs.ts`
- `routes/kb.ts`

**每个 endpoint 必须有**：validate middleware + zod schema + asyncHandler 包装 + 错误返回统一格式。

### 2.3 安全头 + .gitignore 加固

**改动**：

- `.gitignore` 加 `.npmrc.local`（防止 NPM token 泄漏）
- `apps/server/.env.example` 注释明确：哪些值**必须**改、哪些是本地默认

---

## Phase 3：契约层 + 观测层

### 3.1 OpenAPI 自动生成

**现状**：API 文档全靠读 routes 源码，没有自动生成。

**改动**：

- 加 `@asteasolutions/zod-to-openapi` 依赖（Express + Zod 友好）
- 加 `swagger-ui-express` + `swagger-autogen` 或直接用 zod-to-openapi 的 schema
- Express `index.ts` 加 `/api/docs` 路由 → 渲染 Swagger UI
- 根加 `pnpm doc:api` 脚本 → 生成 OpenAPI JSON 到 `apps/server/public/openapi.json`
- GitHub Pages 自动发布（可选，后续）

**依赖**：Zod schema 必须完整（Phase 2.2 已补），否则 OpenAPI 是空壳。

### 3.2 观测层：requestId 贯穿 + JSON 日志

**现状**：

- `services/logger.ts` 已有 `requestId?: string` 字段（LogRecord 接口里）
- `middleware/requestLogger.ts` 已注入 requestId 到 AsyncLocalStorage
- **但 requestId 没透传到下游 services**

**改动文件**：

- `services/logger.ts` — info/warn/error/debug 方法自动从 AsyncLocalStorage 读 requestId
- 新增 `middleware/requestContext.ts` — 封装 AsyncLocalStorage，暴露 `getCurrentRequestId()`
- `middleware/metrics.ts` — metrics record 里加 requestId
- `services/agent/agent.ts` — agent timeline 里每条 step 记录 requestId
- `services/generator/agent.ts` — generator 运行过程 log 带 requestId

### 3.3 日志输出格式升级

**现状**：logger.ts 有 LogRecord 接口 + ring buffer，但 stdout 输出是 `console.log` 风格（带颜色但不是 JSON）。

**改动**：

- logger.info/warn/error/debug 输出到 stdout 时：**终端环境**保留彩色文本；**非终端/CI 环境**输出单行 JSON
- JSON 格式：`{ time: "ISO", level: "INFO", tag: "generator", requestId: "xxx", message: "...", data: {...} }`
- 加 `LOG_FORMAT=json|text` 环境变量（默认 dev=text，prod/CI=json）

---

## Phase 4：演化层 + 依赖层

### 4.1 Drizzle Migrations 补齐

**现状**：`drizzle/` 目录只有 schema.ts，没有 migrations/ 子目录。schema 改了没有版本化脚本。

**问题**：`drizzle.config.ts` 硬编码 `dialect: 'postgresql'`，但开发环境用 SQLite（DATABASE_DRIVER=sqlite）。

**改动方案**：

1. **先跑一次 PG 初始化**（用 postgres 超级用户账号）：
   ```
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
2. 切回 PG 模式（`.env` 改 `DATABASE_DRIVER=postgres`），跑：
   ```
   cd apps/server
   npx drizzle-kit generate  ← 生成初始迁移 SQL 到 drizzle/ 目录
   npx drizzle-kit migrate   ← 应用到 PG
   ```
3. 把生成的 `drizzle/0000_init.sql` 提交到 git（作为首次 schema 基线）
4. 改 `drizzle.config.ts` — dialect 根据 `DATABASE_DRIVER` 环境变量动态选择：
   ```typescript
   const DB_DRIVER = process.env.DATABASE_DRIVER || 'postgres'
   const dbCredentials =
     DB_DRIVER === 'sqlite'
       ? { url: './data/knowledge.db' }
       : { url: process.env.DATABASE_URL || '...' }
   export default defineConfig({
     out: './drizzle',
     dialect: DB_DRIVER as 'postgresql' | 'sqlite',
     dbCredentials,
     schema: './drizzle/schema.ts',
   })
   ```
5. `.env.example` 注释更新：说明首次 migration 怎么生成

### 4.2 Dependabot 自动升级

**现状**：没有任何自动升级策略，所有版本全靠手动 `pnpm add`。

**改动**：

- 新建 `.github/dependabot.yml` — pnpm 每周一更（安全更新最高频，版本更新低频）
- 配置只更新 apps/server 和根目录（generator/desktop 依赖太敏感，手动更）
- 配置 reviewers（自动 assign 给你自己）

### 4.3 Dependencies Audit 常态化

**现状**：`pnpm audit` 只在 CI 里（还没加），本地从不跑。

**改动**：

- 根 `package.json` scripts 加 `"audit": "pnpm audit --audit-level=high"`
- CI `audit` job 每次 push 都跑
- 每月手动 `pnpm outdated` + 升级计划

---

## Phase 5：轻量补强

### 5.1 结构层 ESLint 边界检查

**现状**：没有 lint 规则阻止 app 之间直接 import。

**方案**（渐进式，先 warn 再 error）：

- 在 eslint.config.mjs 加自定义 rule：`no-cross-app-import` — 禁止 `from '@ai-study/server/...'`（非 shared 的 import）
- 具体实现：检查 import 路径，如果匹配 `from '@ai-study/'` 且不是 `@ai-study/shared` 就 warn
- 或者直接用 `eslint-plugin-boundaries`

### 5.2 体验层：Electron 桌面打包（长期）

**现状**：只有 dev 模式，没有真正 .exe 打包。

**暂缓**：等 Phase 1-4 做完再说，打包是最后一环。加进方案但不本轮执行。

### 5.3 构建层：Server Docker 化（长期）

**暂缓**：教学项目暂时用本地 SQLite 跑，Docker 化要考虑 pgvector 扩展的 container 支持。

---

## 执行顺序 & 依赖图

```
Phase 0 (前置) ──────────────────────────────────────
  ├── vitest.config + 测试骨架
  └── 根 package.json scripts 统一

Phase 1 (CI/CD)  ◀── 依赖 Phase 0
  └── ci.yml 加 build + test + audit

Phase 2 (安全)   ◀── 不依赖 Phase 0，可并行
  ├── helmet + CSP
  └── Zod 全覆盖 routes

Phase 3 (契约/观测) ◀── Zod 覆盖后才能做 OpenAPI
  ├── OpenAPI 自动生成
  └── requestId 贯穿 + JSON 日志

Phase 4 (演化/依赖) ◀── 不依赖 Phase 0-3，可并行
  ├── Drizzle migrations
  └── Dependabot + Audit

Phase 5 (轻量补强) ◀── 最后，可选
  ├── ESLint 边界规则
  └── Docker / Electron 打包（长期）
```

**建议实际执行顺序**：0 → 1 → 2（并行）→ 3（并行）→ 4 → 5

---

## 每个 Phase 的验收标准

| Phase | 验收标准                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| 0     | `pnpm test:server:vitest` 跑通至少 6 个测试文件（generator、tools、model、rag×2、routes integration）；vitest.config.ts 存在    |
| 1     | GitHub Actions push 后 4 个 job 全部 green：lint-and-typecheck、build、test、audit                                              |
| 2     | `pnpm audit --audit-level=high` exit 0（或 CI 里 audit 步骤不 block）；每个 routes 文件的每个 endpoint 都有 validate middleware |
| 3     | `pnpm doc:api` 生成 OpenAPI JSON；logger 输出到文件是 JSON 格式；每个 LLM 调用日志带 requestId                                  |
| 4     | `drizzle/` 目录下有 migrations/ 子目录 + 至少 1 个 SQL 文件；Dependabot 首次 PR 进来                                            |
| 5     | ESLint 报错禁止 apps 之间直接 import                                                                                            |

---

## 风险点 & 处理

| 风险                                        | 影响                                   | 处理                                                                                   |
| ------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- | ---- | --- | ------ | ------------------------------------------- |
| Helmet CSP 太严把 Nuxt 页面拦白屏           | generator 打不开                       | CSP 先开 report-only 模式；allowed script-src/connect-src 先放全，再逐步收             |
| Zod 全覆盖 routes 改动量大                  | 可能漏掉 endpoint 或 schema 写错       | 用 grep 统计 `router\.(get                                                             | post | put | delete | patch)\(`数量 vs`validate\(` 数量，确保 1:1 |
| Drizzle migrations 在 SQLite ↔ PG 间切换乱 | schema 版本不一致                      | migration SQL 只在 PG 上生成，开发环境继续 `drizzle-kit push:sqlite`；CI 环境也用 push |
| RequestId 贯穿 AsyncLocalStorage 不稳定     | 某些异步边界丢失 requestId             | 每个 middleware 都从同一个 AsyncLocalStorage 实例读；测试里手动 set                    |
| CI 跑 PG migration 需要 PG                  | GitHub Actions ubuntu-latest 没预装 PG | CI 用 SQLite，只跑 lint + typecheck + test；PG 相关的 migration 本地手动跑             |

---

## 不做什么（本期范围外）

- ❌ Docker / docker-compose（构建层）
- ❌ Electron electron-builder 打包（构建层）
- ❌ electron-updater 自动更新
- ❌ Commitlint + commit 插件（治理层，太费维护）
- ❌ Sentry / Error tracking（观测层，下期）
- ❌ Grafana / Prometheus dashboard（观测层，下期）
- ❌ OpenTelemetry SDK（太重，先手写 requestId）
- ❌ ADR 架构决策记录（治理层，教学项目体量暂不需要）
