# 移除 SQLite、统一 PostgreSQL + pgvector 实施方案

## 一、目标与范围

将本地开发、测试、CI、Electron 和生产运行环境统一为 **PostgreSQL + pgvector**，移除运行时的 SQLite 双方言分支，并迁移当前 `apps/server/data/knowledge.db` 中的业务数据。

完成后应满足：

- 不再存在 `DATABASE_DRIVER` 切换；所有环境只使用 `DATABASE_URL`。
- 文档分块与个人条目向量均使用真正的 `vector(1536)`、cosine KNN 和 HNSW 索引，不再把向量当 JSON 文本全表扫描。
- 当前 SQLite 中的 documents、chunks、sessions、messages、entries、entry_embeddings、ai_usage_logs、plans 完整迁移并校验。
- 本地与 CI 测试均连接真实 PostgreSQL；不使用 SQLite，也不以 mock 数据库代替集成测试。
- 支持多个 BFF 实例共享同一个 PostgreSQL，连接与检查点资源可正确关闭。
- SQLite 仅允许存在于一次性旧数据迁移工具和保留的备份文件中，不参与任何运行、测试或打包路径。

不改动现有长期规划、聊天、知识库等业务功能和前端交互。

## 二、现状与主要问题

1. `apps/server/src/db/index.ts` 同时维护 SQLite/PG 两套初始化、schema 和原生连接；编译期 `AppDb` 仍以 SQLite schema 为基准。
2. PG 初始化存在未等待的 DDL 和空 `catch`，可能在表尚未就绪时报告成功；`src/index.ts` 也未等待数据库初始化。
3. `apps/server/scripts/init-pg.sql` 未启用 vector 扩展，`chunks.embedding` 与 `entry_embeddings.embedding` 仍为 `TEXT`，且缺少部分 SQLite 已有的向量血缘列。
4. `apps/server/src/services/rag/vectorStore.ts` 使用 JSON 文本、`sqlite-vec` 或 JS 全表余弦；`apps/server/src/services/search/entrySearch.ts` 也会读取条目向量并在 JS 中逐条计算。
5. `apps/server/src/services/graph/checkpointer.ts` 同时包含 `SqliteSaver` 和 `PostgresSaver`，PG 检查点使用独立连接池。
6. 大量测试显式设置 `DATABASE_DRIVER=sqlite` 和临时 `DB_PATH`；CI 也明确使用 SQLite。
7. `apps/desktop/src/main/spawnServer.ts` 强制注入 SQLite；`.env.example`、README、Drizzle 配置、评测脚本和依赖清单均保留双方言逻辑。

## 三、已确定的实现决策

1. **唯一数据库**：运行时只支持 PostgreSQL，`DATABASE_URL` 必填，不再提供硬编码账号密码回退；连接或结构校验失败时服务拒绝启动。
2. **结构初始化方式**：沿用并收敛现有幂等 `init-pg.sql`，增加跨平台 `db:init` 命令；初始化由开发/部署/测试流程显式执行，应用启动只做 awaited 探针，不在多个实例启动时并发执行 DDL。本任务不额外引入新的 migration 框架。
3. **连接池**：业务层继续使用 postgres.js + Drizzle；`PostgresSaver` 按其 API 要求保留独立 `pg.Pool`。不为合并池而更换 Drizzle 驱动，但统一初始化和关闭顺序，禁止泄露任一池。
4. **业务数据迁移**：迁移上述八张业务表，保留 UUID、关联关系、时间、JSON 和向量血缘。目标业务表默认必须为空，避免覆盖已有 PG 数据；源 SQLite 文件只读并先备份，绝不删除。
5. **检查点草稿**：不直接转换 `SqliteSaver` 与 `PostgresSaver` 的私有二进制/表结构。切换前报告旧检查点数量，未确认草稿应先在旧版本确认或丢弃；原 SQLite 备份继续保留。已确认的会话、消息、条目和规划均在业务表中正常迁移，新检查点表由 `PostgresSaver.setup()` 幂等创建。
6. **迁移期依赖**：`better-sqlite3` 与 `@types/better-sqlite3` 仅作为 devDependency 供一次性迁移脚本使用；从生产 dependencies、测试路径和 Electron 产物中排除。`sqlite-vec`、`@langchain/langgraph-checkpoint-sqlite` 和 SQLite schema 完全删除。
7. **测试隔离**：使用独立 `ai_study_test` 数据库，DB 测试串行执行并在测试间清理数据；禁止对开发库执行 TRUNCATE。

## 四、实施步骤

### 阶段 1：统一 PG schema、pgvector 与可靠初始化

#### 1. `apps/server/drizzle/schema.ts`

- 引入 Drizzle 的 `vector` 列类型，将两个 embedding 字段改为 `vector('embedding', { dimensions: 1536 })`。
- 保留现有 camelCase 属性名，确保业务层不再依赖 SQLite 类型强转。
- 保持 documents/chunks/sessions/messages/entries/entry_embeddings/ai_usage_logs/plans 的现有约束、JSONB、TIMESTAMPTZ 和向量血缘字段一致。

#### 2. `apps/server/scripts/init-pg.sql`

重写为唯一、幂等的 PG 结构初始化脚本：

- 首步执行 `CREATE EXTENSION IF NOT EXISTS vector`，创建 `app` schema。
- 新库直接将两个 embedding 建为 `vector(1536)`。
- 对已有 PG 库补齐 `chunks.embedding_type`、`chunks.embedding_model`、`entry_embeddings.embedding_type` 及其他缺失列。
- 对仍为 TEXT 的 embedding 使用条件式 `ALTER COLUMN ... TYPE vector(1536) USING ...`；非法向量应让初始化明确失败，不静默清空。
- 保留现有 `ai_usage_logs.feature` 旧值归一化，再恢复 CHECK 约束。
- 为 `chunks.embedding` 和 `entry_embeddings.embedding` 创建 `USING hnsw ... vector_cosine_ops` 索引；chunks 索引仅覆盖 embedding 非 NULL 的行。
- 移除硬编码 `GRANT ... TO ai_study`，避免使用其他连接账号时初始化失败；对象权限由实际部署账号/owner 管理。
- 所有语句失败均返回非零，不再吞错。

#### 3. 新增 `apps/server/scripts/init-pg.mts`，修改 `apps/server/package.json`

- 增加 `db:init`：读取 `DATABASE_URL` 和 `init-pg.sql`，使用 postgres.js await 执行完整脚本，成功后关闭连接。
- 增加 `migrate:sqlite` 作为一次性数据迁移入口。
- `DATABASE_URL` 缺失、扩展无权限或 SQL 失败时打印明确错误并以非零退出。

#### 4. `apps/server/drizzle.config.ts`

- 删除 SQLite dialect、`DATABASE_DRIVER` 和 `DATABASE_SQLITE_PATH` 分支。
- 仅保留 PostgreSQL、`app` schema 与 `DATABASE_URL` 配置；文档命令不再推荐用 `push` 绕过统一初始化脚本。

### 阶段 2：删除运行时双方言门面并补齐生命周期

#### 1. `apps/server/src/db/index.ts`

- 删除 better-sqlite3、sqlite-vec、sqliteSchema、SQLite 建表/对齐、`getDriver()`、`getSqliteRaw()` 和 `isVecExtensionLoaded()`。
- `AppDb` 改为 `PostgresJsDatabase<typeof pgSchema>`，`tables` 直接导出 PG schema，不再强转。
- `initDatabase()` 改为 async：创建业务连接池后 await `SELECT 1`，并验证 vector 扩展、必要表和 vector 列类型；不执行 DDL。
- `getPgRaw()` 在尚未初始化时直接抛出清晰错误，不再返回可混淆的 null。
- `closeDatabase()` 只负责业务 postgres.js 池，并保证重复调用安全。

#### 2. `apps/server/src/index.ts`

- 在注册路由和监听端口前 `await initDatabase()`；初始化失败则不监听端口。
- 更新架构注释为 Express + PostgreSQL + pgvector。
- 优雅关闭时先停止接收请求，再依次 `closeCheckpointer()`、`closeDatabase()`，完成后退出；关闭失败记录并返回非零。

#### 3. `apps/server/src/services/graph/checkpointer.ts`

- 删除 `SqliteSaver`、驱动判断和 SQLite 原生连接逻辑；`GraphCheckpointer` 仅保留 PostgresSaver 类型。
- 始终从 `DATABASE_URL` 创建 saver，并 await `setup()`。
- `closeCheckpointer()` 始终关闭缓存的 PG saver，同时清空 cached/pending，支持测试与进程重启。

#### 4. `apps/server/src/services/costTracker.ts`

- 删除 `getDriver()` 与 SQLite 日期表达式，统计统一使用 `TIMESTAMPTZ` 的 `date(created_at)`。

### 阶段 3：检索真正切换到 pgvector

#### 1. `apps/server/src/services/rag/vectorStore.ts`

- 将 `createSqliteVectorStore`/`SqliteVectorStore` 更名为 PG 语义的 `createPgVectorStore`/`PgVectorStore`，同步修改：
  - `apps/server/src/services/rag/index.ts`
  - `apps/server/src/routes/documents.ts`
- 写入时直接把 `number[]` 映射到 vector 列，不再 `JSON.stringify`，删除 chunks_vec 双写。
- 相似度查询使用 `embedding <=> query_vector` 的 cosine distance，`score = 1 - distance`。
- `docId` 过滤必须放进 SQL 的 WHERE，再执行 ORDER BY/LIMIT，避免先取全局候选后过滤导致数量不足。
- 删除操作只处理 chunks 表，不再维护虚拟表；保留现有返回结构和批量插入行为。

#### 2. `apps/server/src/services/search/entrySearch.ts`

- 删除 `loadEmbeddings()`、JSON.parse 和 JS 全量 `cosineSimilarity`。
- 真实 embedding 模式下，在 PG 中联查 entries/entry_embeddings，保留 active、libraryId 过滤，以 `<=>` 排序并用 `1 - distance >= minScore` 筛选，取 `k * 3` 个向量候选。
- 将向量候选与原有最近条目 BM25 候选按 id 合并，再执行现有 RRF，确保向量命中的旧条目不会因 `MAX_ENTRY_ROWS` 候选窗口而丢失。
- mock/hash 降级时维持现行为：跳过条目向量路，只走 BM25。

### 阶段 4：迁移当前 SQLite 业务数据

新增 `apps/server/scripts/migrate-sqlite-to-pg.mts`，命令示例：

`pnpm --filter @ai-study/server migrate:sqlite -- --from ./data/knowledge.db`

迁移流程：

1. 暂停旧 BFF 写入；复制源文件为带时间戳的备份，迁移过程只读源库。
2. 检查源文件、目标 `DATABASE_URL`、vector 扩展及八张目标表；目标业务表非空时默认中止，不覆盖、不合并、不重复插入。
3. 在单个 PG 事务中按依赖顺序导入：
   - documents → chunks
   - sessions → messages
   - entries → entry_embeddings
   - plans、ai_usage_logs
4. 类型转换规则：
   - SQLite 毫秒整数时间戳转 Date/TIMESTAMPTZ，NULL 保持 NULL。
   - metadata、citations、recurrence、exceptions、stages 等 JSON 文本解析一次后写 JSONB，避免双重编码。
   - UUID 与外键先校验；发现非 UUID 或孤儿记录时列出表/id 并中止，不静默改 id 或丢行。
   - embedding JSON 转为 number[]，校验有限数值和 1536 维；chunks 允许 NULL，其他非法非空向量中止迁移。
   - `embedding_type`、`embedding_model`/model、confidence、progress 等血缘与数值字段原样保留。
5. 使用参数化批量写入；任一批次失败则整个事务回滚，修复后可对空目标安全重跑。
6. 成功后输出逐表 SQLite/PG 行数、NULL/非 NULL embedding 数和旧检查点数量；行数不一致时命令失败。
7. 迁移后再做抽样校验：文档与分块关联、会话与消息关联、条目与规划时间/JSON、一次 chunks KNN 和一次 entries KNN。

### 阶段 5：本地 PostgreSQL、真实 PG 测试与 CI

#### 1. 新增根目录 `docker-compose.yml`

- 使用 `pgvector/pgvector:pg17`。
- 配置本地开发库 `ai_study`、持久化 volume、5432 端口和 pg_isready 健康检查。
- 明确该文件中的账号仅用于本地开发，生产使用独立密钥。

#### 2. `apps/server/vitest.config.ts` 与新增测试辅助文件

- 默认 `DATABASE_URL` 指向 `postgresql://ai_study:123456@localhost:5432/ai_study_test`，允许通过 `TEST_DATABASE_URL` 覆盖。
- 新增 `apps/server/tests/globalSetup.ts`：通过管理连接确保测试库存在，执行同一份 `init-pg.sql`，并验证库名带 `_test` 后才允许清理。
- 新增 `apps/server/tests/helpers/db.ts`：统一 awaited 初始化、按外键顺序清库、关闭 checkpointer 和业务池。
- DB 测试文件串行运行，避免共享测试库相互污染；纯函数单测保持纯单测，不强行建立数据库连接。

#### 3. 改造现有测试与脚本

- 删除所有测试中的 `DATABASE_DRIVER='sqlite'`、临时 `DB_PATH`、better-sqlite3 和 SqliteSaver 引用，统一使用上述 PG helper。
- `src/services/graph/__tests__/checkpointer.test.ts` 改为验证 PostgresSaver 的 setup、写入、重开恢复与连接关闭。
- 所有 `initDatabase()` 调用改为 await；afterAll/afterEach 同时关闭 checkpointer，避免悬挂句柄。
- `apps/server/tests/eval/run.ts` 改用独立测试库，不再创建临时 SQLite 文件。
- `apps/server/scripts/test-db-wrap.mjs` 改为真实 PG 的 CRUD、Date/JSONB、级联删除和 pgvector 冒烟测试，删除 SQLite :memory: 部分。

#### 4. `.github/workflows/ci.yml`

- Unit Tests job 添加 `pgvector/pgvector:pg17` service、健康检查和测试库连接环境变量。
- 测试前由 globalSetup/`db:init` 完成结构初始化；移除 `DATABASE_DRIVER: sqlite`。
- lint、typecheck、build 继续复用现有矩阵和流程。

### 阶段 6：Electron、配置、依赖与文档清理

#### 1. `apps/desktop/src/main/spawnServer.ts`

- 删除 userData/knowledge.db、`DB_PATH` 和强制 `DATABASE_DRIVER: 'sqlite'`。
- 从开发 server/.env、生产 userData/.env 或显式 `SERVER_ENV_FILE` 透传 `DATABASE_URL`。
- 未配置 PostgreSQL 时由服务端 fail fast，桌面端保留现有日志转发，不自动降级 SQLite。

#### 2. `apps/desktop/package.json`

- 调整 server 生产资源过滤，确保一次性迁移工具及 `better-sqlite3` 原生模块不进入 Electron 产物。
- 保留现有 dist/server 与 Nuxt 输出打包结构，不顺带修改无关桌面行为。

#### 3. `apps/server/package.json` 与 `pnpm-lock.yaml`

- 从 dependencies 删除：`better-sqlite3`、`sqlite-vec`、`@langchain/langgraph-checkpoint-sqlite`。
- `better-sqlite3` 与 `@types/better-sqlite3` 仅放在 devDependencies，供迁移脚本使用。
- 删除 `apps/server/drizzle/schema.sqlite.ts`。
- 更新 lockfile 并检查生产依赖树中不存在 SQLite 运行时包。

#### 4. 配置与文档

- `apps/server/.env.example`：删除 DATABASE_DRIVER/DB_PATH，保留并明确必填 DATABASE_URL；补充本地 docker-compose、`db:init` 和旧数据迁移命令。
- 本地 `apps/server/.env`：仅调整数据库配置并保留现有 AI Key/模型等敏感配置，不提交该文件。
- `README.md`：架构说明、快速开始、测试和部署统一为 PostgreSQL + pgvector；说明多实例部署前先执行一次 `db:init`，再启动各实例。
- `docs/17-electron-desktop.md`：说明桌面端现在依赖外部 PostgreSQL 和 DATABASE_URL，不再内嵌 SQLite。

## 五、验证清单

### 1. 静态与构建验证

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- Prettier 检查通过。
- 全局搜索运行时代码、测试、CI、Electron 和文档：`DATABASE_DRIVER`、`DB_PATH`、`SqliteSaver`、`sqlite-vec`、`createSqliteVectorStore`、`schema.sqlite` 均无残留。
- 生产依赖/Electron 产物不含 better-sqlite3、sqlite-vec 和 checkpoint-sqlite。

### 2. PG 初始化与自动化测试

- Docker 首次启动后 `db:init` 成功；重复执行第二次仍成功，扩展、八张表、列和 HNSW 索引保持一致。
- 使用缺少扩展或错误 DATABASE_URL 的环境验证服务不会假装启动成功。
- `pnpm --filter @ai-study/server test`：全部现有及新增测试在真实 ai_study_test 上通过，无 SQLite 临时文件和悬挂连接。
- `pnpm --filter @ai-study/server test:db-wrap` 通过。
- CI service 配置与本地执行同一套初始化和测试路径。

### 3. 数据迁移验收

- 迁移前备份存在且源 knowledge.db 未被修改。
- 八张业务表逐表行数一致，外键无孤儿，UUID、时间戳、JSONB、向量血缘抽查一致。
- chunks 与 entry_embeddings 的非空向量均为 1536 维，能使用 cosine KNN 返回结果。
- 对同一迁移命令重复执行时因目标非空安全中止，不产生重复或覆盖。
- 旧检查点数量已报告；未确认草稿处理方式和 SQLite 备份位置明确。

### 4. 运行与多实例验收

- 使用 PG 重启现有开发服务，验证健康检查、知识库文档/检索、会话聊天、个人条目、长期规划和费用统计关键 API。
- 进程重启后，已迁移数据和新写入的 PG 检查点可恢复。
- 启动两个使用同一 DATABASE_URL、不同端口的 BFF 实例：实例 A 写入规划/会话，实例 B 可读取；关闭两个实例后连接均释放。
- 删除文档后 chunks 级联删除，删除条目后 entry_embeddings 级联删除，检索结果同步更新。

## 六、回滚与数据安全

- 迁移前保留带时间戳的 SQLite 备份；源文件不覆盖、不删除。
- 数据迁移在单事务中执行，失败不会留下半导入目标库。
- 代码切换与数据迁移验证分开进行；若应用回归失败，可在保留原备份和未提交改动的前提下恢复旧代码继续使用 SQLite。
- 不主动提交 git，不覆盖当前工作区中与本任务无关的未提交修改。
