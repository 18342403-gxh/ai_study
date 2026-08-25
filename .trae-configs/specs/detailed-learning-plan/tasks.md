# Tasks - 详细学习计划

## Phase 0: 项目基础设施

- [x] 1. 项目初始化与路由配置 (知识点 0.1)
  - [x] 1.1. 安装依赖：react-router-dom、tailwindcss、zustand、react-markdown、rehype-highlight
  - [x] 1.2. 配置 Tailwind CSS（tailwind.config.js + postcss.config.js + 全局样式引入）
  - [x] 1.3. 配置 index.html viewport meta 标签（移动端适配）
  - [x] 1.4. 创建 src/main.tsx 入口文件（BrowserRouter 包裹）
  - [x] 1.5. 创建 src/App.tsx 路由配置（React.lazy 懒加载 + Suspense + 路由表）
  - [x] 1.6. 创建首页 Home 组件（模块列表导航卡片）
- [x] 2. 公共组件与移动端样式 (知识点 0.2)
  - [x] 2.1. 创建 src/components/Layout.tsx（移动端全屏布局壳：顶部标题栏 + 内容区 + 底部导航预留）
  - [x] 2.2. 创建 src/components/TabBar.tsx（底部 Tab 导航栏：固定定位、5 个 Tab 图标 + 文字）
  - [x] 2.3. 创建 src/components/InterviewCard.tsx（面试题卡片：折叠/展开、难度标签、答案要点）
- [x] 3. API 服务层封装 (知识点 0.3)
  - [x] 3.1. 创建 .env.local 模板文件和 .env.example（VITE_AI_API_URL、VITE_AI_API_KEY）
  - [x] 3.2. 创建 src/services/ai.ts（统一 fetch 封装：请求头、错误处理、类型定义）
  - [x] 3.3. 创建 src/data/interview-questions.ts（面试题数据文件初始结构 + 类型定义）

## Phase 1: AI API 基础 + 流式响应

- [x] 4. 模块 1：AI API 基础调用 (知识点 1.1-1.8) {depends_on: [1, 2, 3]}
  - [x] 4.1. 创建 src/modules/01-api-basics/types.ts（ChatRequest、Message、ChatResponse 类型定义）
  - [x] 4.2. 创建 src/modules/01-api-basics/api.ts（封装 Chat Completions API 调用函数）
  - [x] 4.3. 创建 src/modules/01-api-basics/useChat.ts（自定义 Hook：loading/error/data 状态 + AbortController 超时 + 错误处理 + 重试）
  - [x] 4.4. 创建 src/modules/01-api-basics/ApiBasics.tsx（页面组件：输入框 + 发送按钮 + 结果展示 + Loading 状态 + 面试题卡片）
  - [x] 4.5. 追加模块 1 面试题到 src/data/interview-questions.ts
- [x] 5. 模块 2：流式响应 (知识点 2.1-2.8) {depends_on: [4]}
  - [x] 5.1. 创建 src/modules/02-streaming/parseSSE.ts（SSE 数据解析器：按行分割、JSON.parse delta.content、处理粘包）
  - [x] 5.2. 创建 src/modules/02-streaming/useStreaming.ts（流式 Hook：ReadableStream 读取 + 状态机 + AbortController 中断）
  - [x] 5.3. 创建 src/modules/02-streaming/Cursor.tsx（光标闪烁动画组件）
  - [x] 5.4. 创建 src/modules/02-streaming/Streaming.tsx（流式页面：逐字渲染 + 自动滚动 + 停止按钮 + 面试题卡片）
  - [x] 5.5. 追加模块 2 面试题到 src/data/interview-questions.ts

## Phase 2: Prompt 工程 + 聊天界面

- [x] 6. 模块 3：Prompt 工程 (知识点 3.1-3.8) {depends_on: [5]}
  - [x] 6.1. 创建 src/modules/03-prompt/types.ts + presets.ts（消息角色类型 + System Prompt 预设模板）
  - [x] 6.2. 创建 src/modules/03-prompt/tokenCounter.ts（Token 估算工具函数）
  - [x] 6.3. 创建 src/modules/03-prompt/useConversation.ts（多轮对话 Hook：消息维护 + 滑动窗口策略）
  - [x] 6.4. 创建 src/modules/03-prompt/JsonRenderer.tsx（JSON 结构化输出渲染组件）
  - [x] 6.5. 创建 src/modules/03-prompt/PromptLab.tsx（Prompt 实验室页面：模板切换 + 自定义编辑器 + 对话区 + Token 计数）
  - [x] 6.6. 追加模块 3 面试题到 src/data/interview-questions.ts
- [x] 7. 模块 4：聊天界面 (知识点 4.1-4.9) {depends_on: [6]}
  - [x] 7.1. 创建 src/modules/04-chat-ui/useChatStore.ts（zustand store：消息列表 + 多会话 + localStorage 持久化）
  - [x] 7.2. 创建 src/modules/04-chat-ui/MarkdownRenderer.tsx + CodeBlock.tsx（Markdown 渲染 + 代码高亮 + 复制功能）
  - [x] 7.3. 创建 src/modules/04-chat-ui/MessageBubble.tsx + MessageList.tsx（消息气泡 + 消息列表 + 自动滚动 + 滚动锁定）
  - [x] 7.4. 创建 src/modules/04-chat-ui/ChatInput.tsx（移动端输入组件：多行 + 自适应高度 + 发送按钮）
  - [x] 7.5. 创建 src/modules/04-chat-ui/ChatPage.tsx（聊天主页面：全屏对话布局 + 集成流式输出 + 会话管理）
  - [x] 7.6. 追加模块 4 面试题到 src/data/interview-questions.ts

## Phase 3: Function Calling

- [x] 8. 模块 5：Function Calling (知识点 5.1-5.8) {depends_on: [7]}
  - [x] 8.1. 创建 src/modules/05-function-calling/tools/definitions.ts（工具 Schema 定义：天气/计算器等）
  - [x] 8.2. 创建 src/modules/05-function-calling/tools/weather.ts + executor.ts（工具实现 + 执行器映射）
  - [x] 8.3. 创建 src/modules/05-function-calling/useToolChat.ts（工具调用流程编排 Hook：检测 tool_calls → 执行 → 递归调用 + 多步链 + 失败处理）
  - [x] 8.4. 创建 src/modules/05-function-calling/ToolCallCard.tsx（工具调用状态展示 + 多工具结果可视化）
  - [x] 8.5. 创建 src/modules/05-function-calling/FunctionCalling.tsx（Function Calling 主页面）
  - [x] 8.6. 追加模块 5 面试题到 src/data/interview-questions.ts

## Phase 4: RAG + Agent

- [x] 9. 模块 6：RAG 前端集成 (知识点 6.1-6.8) {depends_on: [8]}
  - [x] 9.1. 创建 src/modules/06-rag/DocumentUpload.tsx（文件上传组件：拖拽 + 进度条 + 格式校验）
  - [x] 9.2. 创建 src/modules/06-rag/DocumentList.tsx（文档列表 + 处理状态流展示）
  - [x] 9.3. 创建 src/modules/06-rag/useRag.ts（RAG 问答 Hook：query + document_ids + citations）
  - [x] 9.4. 创建 src/modules/06-rag/CitationCard.tsx（引用来源卡片：编号标记 + 展开原文 + 相关度）
  - [x] 9.5. 创建 src/modules/06-rag/RagChat.tsx + RagPage.tsx（RAG 问答界面 + 主页面组装）
  - [x] 9.6. 追加模块 6 面试题到 src/data/interview-questions.ts
- [x] 10. 模块 7：AI Agent 交互 (知识点 7.1-7.8) {depends_on: [9]}
  - [x] 10.1. 创建 src/modules/07-agent/types.ts（Agent 类型定义：AgentStep、状态枚举）
  - [x] 10.2. 创建 src/modules/07-agent/useAgent.ts（Agent 执行 Hook：Think-Act-Observe 循环 + 暂停/继续 + 中断/回退）
  - [x] 10.3. 创建 src/modules/07-agent/ThinkingBubble.tsx + StepCard.tsx（思考过程展示 + 步骤详情卡片）
  - [x] 10.4. 创建 src/modules/07-agent/AgentTimeline.tsx（执行时间线组件：垂直时间线 + 实时追加）
  - [x] 10.5. 创建 src/modules/07-agent/AgentPage.tsx（Agent 主页面：输入区 + 时间线 + 用户干预 UI）
  - [x] 10.6. 追加模块 7 面试题到 src/data/interview-questions.ts

## Phase 6: Monorepo 工程化改造

- [ ] 11. pnpm workspace 初始化（知识点 8.1-8.7）
  - [ ] 11.1. 安装 pnpm（全局），创建 `pnpm-workspace.yaml`（apps/*、packages/* 两个目录）
  - [ ] 11.2. 创建根 `tsconfig.base.json`（通用 TS 选项、路径别名 @ai-study/shared）
  - [ ] 11.3. 重构根 `package.json`：name 改为根包名、private:true、scripts 增加 dev/build 统一入口、dependencies 只留公共开发依赖
  - [ ] 11.4. 创建 apps/web-react 目录并迁移原项目所有文件（src/、index.html、vite.config.ts、tailwind.config.js、postcss.config.js、package.json→name=@ai-study/web-react）
  - [ ] 11.5. 更新 apps/web-react 的 tsconfig.json：extends `../../tsconfig.base.json`，composite:true，vite.config.ts 的 root 和别名适配
  - [ ] 11.6. 更新根 `.gitignore`：`apps/*/dist`、`apps/*/node_modules`、`apps/*/.env`、`packages/*/dist` 统一忽略
  - [ ] 11.7. 删除旧的根 node_modules 和 package-lock.json，在根目录执行 `pnpm install`，验证 pnpm workspace symlink 生效
  - [ ] 11.8. 配置根 `.editorconfig` 和 `.prettierrc`（知识点 8.6 简化版）

## Phase 7: Node.js BFF 服务端

- [ ] 12. BFF 服务端初始化与基础功能（知识点 9.1-9.9）
  - [ ] 12.1. 创建 apps/server/package.json：name=@ai-study/server、scripts( dev: "tsx watch src/index.ts"、build: "tsc -p tsconfig.json" )、依赖 express、dotenv、cors、tsx、@types/express、@types/cors
  - [ ] 12.2. 创建 apps/server/tsconfig.json：extends ../../tsconfig.base.json、rootDir=src、outDir=dist、commonjs 模块
  - [ ] 12.3. 创建 apps/server/.env.example：PORT=3001、AI_API_URL=xxx、AI_API_KEY=xxx、WEB_ORIGIN=http://localhost:5173,http://localhost:5174,http://localhost:3000
  - [ ] 12.4. 创建 apps/server/src/config.ts（dotenv 加载 + 类型化导出）
  - [ ] 12.5. 创建 apps/server/src/middleware/cors.ts（cors 白名单中间件）和 logger.ts（请求日志 + 耗时）
  - [ ] 12.6. 创建 apps/server/src/app.ts：express() + middleware 注册 + routes 挂载 + 404 + 错误处理
  - [ ] 12.7. 创建 apps/server/src/routes/health.ts：GET /healthz → { ok: true, time: Date.now() }
  - [ ] 12.8. 创建 apps/server/src/routes/ai.ts：POST /api/chat 透传 AI 非流式 + POST /api/chat/stream 透传 SSE 流式
  - [ ] 12.9. 创建 apps/server/src/services/conversation.ts：Map 维护会话历史
  - [ ] 12.10. 创建 apps/server/src/index.ts：app.listen 启动 + SIGINT/SIGTERM 优雅关闭 + /healthz 验证

- [ ] 13. 🔗 LangChain.js / LangGraph 编排层集成（BFF 侧，知识点 9.10-9.18 · m5/m6/m7 的核心实现）
  - **🤖 AI 主例必用（任务 13 侧）**：m5 StructuredTool 白名单执行 / m6 RAG 4 步流水线 / m7 LangGraph Agent 循环，三条都不允许手写裸 fetch + while 循环
  - **📱 C 端体验验收（任务 13 侧）**：所有 BFF 路由统一 SSE streamEvents v2 协议 → 前端 useStreaming 粘包规则 1 套全吃；API Key 只在 apps/server 读 env，Nitro / 前端 env 里绝对没有
  - [ ] 13.1. 依赖追加：`@langchain/core`、`@langchain/openai`、`@langchain/community`、`@langchain/langgraph`、`zod`、`pdf-parse`（PDF 解析）、`better-sqlite3` + `@langchain/langgraph-checkpoint-sqlite`（LangGraph 检查点持久化，可选）
  - [ ] 13.2. `services/chain.ts`：统一 ChatOpenAI（baseURL/apiKey/model 从 config 读，换通义/DeepSeek 只改 1 行）+ 通用 prompt template + output parser
  - **—— 模块 5（FC）LangChain StructuredTool 落地 ——**
  - [ ] 13.3. `services/tools/calculator.tool.ts` + `services/tools/now.tool.ts`：2 个基础 StructuredTool 4 件套（name/description/Zod schema/_call）模板
  - [ ] 13.4. `services/tools/index.ts`：`registerTools(): Record<string, StructuredTool>` 统一注册中心，BFF 路由传白名单 id 从这里取对应 Tool
  - [ ] 13.5. `routes/tools.ts`：GET `/api/tools/list` → `ToolWhiteListItem[]`（**只返回 id+name+icon**，Zod/执行代码绝不透出）；POST `/api/tools/execute` → AgentExecutor.streamEvents 输出 SSE 中间态
  - **—— 模块 6（RAG）LangChain 4 步流水线落地 ——**
  - [ ] 13.6. `services/rag/loaders.ts`：PDF (PDFLoader/pdf-parse) / Markdown / Text → LangChain Document[]
  - [ ] 13.7. `services/rag/splitter.ts`：`RecursiveCharacterTextSplitter({ chunkSize:256, chunkOverlap:32, separators:['\n\n','\n','。','',' '] })`（中文友好切分，禁止手写 split）
  - [ ] 13.8. `services/rag/embeddings.ts`：统一 OpenAIEmbeddings（LangChain Embeddings 接口，一行换 DashScopeEmbeddings）
  - [ ] 13.9. `services/rag/vectorstore.ts`：默认 `MemoryVectorStore.fromDocuments`；预留一行代码切换到 SQLite-vec / Qdrant；封装 `addDocsWithProgress()` 带切片进度事件
  - [ ] 13.10. `routes/rag.ts`：POST `/api/rag/documents` multipart → 分片进度 SSE；GET `/api/rag/documents` 列表；POST `/api/rag/qa` RetrievalChain → {answer, citations: CitationFragment[]}
  - **—— 模块 7（Agent）LangGraph 落地 ——**
  - [ ] 13.11. `services/agent/state.ts`：`AgentState` 类型（messages/step/tool_results/answer）+ reducer：messages 用 `addMessages`（LangGraph 自动合并）
  - [ ] 13.12. `services/agent/graph.ts`：StateGraph 4 节点（think → 条件边 → call_tools / answer）+ AgentExecutor 执行；`call_tools` 节点支持 `interruptBefore`（Human-in-the-loop 中断确认）
  - [ ] 13.13. `services/agent/checkpointer.ts`：默认 `MemorySaver.fromConnString()`；可选 `SqliteSaver.fromConnString('better-sqlite3://...')` 持久化，thread_id 做会话维度
  - [ ] 13.14. `routes/agent.ts`：POST `/api/agent/run` streamEvents v2 → 映射事件表（on_chat_model_start→think / on_tool_start→tool_call ...）输出 `AgentTimelineStep[]`；POST `/:threadId/{pause,resume,rollback}`（rollback=checkpointer 切历史 checkpoint 并补 thread_id-v3 分支）

## Phase 8: Vue3 网页端

- [ ] 14. Vue3 端初始化（知识点 10.1-10.8）
  - [ ] 14.1. 创建 apps/web-vue/package.json：name=@ai-study/web-vue、依赖 vue、vue-router、pinia、@vitejs/plugin-vue
  - [ ] 14.2. 创建 apps/web-vue/vite.config.ts：port=5174、@vitejs/plugin-vue
  - [ ] 14.3. 创建 apps/web-vue/tsconfig.json + vue-tsc 类型配置（含 vue 文件类型声明）
  - [ ] 14.4. 创建 apps/web-vue/index.html + src/main.ts + src/App.vue（根入口）
  - [ ] 14.5. 创建 apps/web-vue/src/router/index.ts（路由表：/、/m1、/m2、/m4）
  - [ ] 14.6. 创建 apps/web-vue/src/stores/ 目录示例 chat.ts（Pinia）
  - [ ] 14.7. 集成 Tailwind：apps/web-vue/tailwind.config.js、postcss.config.js、src/style.css（@tailwind）
  - [ ] 14.8. 实现 Home.vue + ModuleCard.vue + 简单的 M1/M2/M4 占位页面

## Phase 9: packages/shared + 三端联调

- [ ] 15. packages/shared 公共包（知识点 11.1-11.4）
  - [ ] 15.1. 创建 packages/shared/package.json：name=@ai-study/shared、main/module/types 字段
  - [ ] 15.2. 创建 packages/shared/src/types/chat.ts（Role、ChatMessage、ChatRequest、ChatResponse、SSEChunk） + 新增 LangChain DTO（ToolWhiteListItem、CitationFragment、AgentTimelineStep、AgentRunState）
  - [ ] 15.3. 创建 packages/shared/src/constants/models.ts（模型白名单、默认温度） + prompts.ts（默认 System Prompt）
  - [ ] 15.4. 创建 packages/shared/src/utils/token.ts（Token 估算） + sse.ts（SSE 解析辅助 + streamEvents v2 事件映射表） + id.ts（nanoid 封装）
  - [ ] 15.5. 创建 packages/shared/src/index.ts 汇总导出
- [ ] 16. 三端联调
  - [ ] 16.1. apps/web-react 依赖 @ai-study/shared（workspace:*），把 types/constants 引用替换为 shared 来源
  - [ ] 16.2. apps/web-vue 依赖 @ai-study/shared（workspace:*）
  - [ ] 16.3. apps/server 依赖 @ai-study/shared（workspace:*）
  - [ ] 16.4. `pnpm dev:all` 四端（SSR+React+Vue+Server）互相请求验证通过

## Phase 9 🔝：Vue3 SSR（Nuxt 3）主学习端

> ⚠️ 优先级高于 React / Vue SPA。新功能一律先在本端实现，再同步回对照端。
>
> 📚 **Vue3 / Nuxt 3 教学定位（中高级 · 跳过基础语法）**：本 Phase 所有讲解**不再写 Vue 3 基础语法教程**（SFC 结构、`ref(0)` 声明响应式、`v-if`/`v-for`/`v-model` 指令、`defineProps`/`defineEmits` 基本声明、`<script setup>` import 语法等均默认已掌握）。直接讲解「Composition API 工程化抽取 + Vue3+TS 实战 + Nuxt 约定式系统 + SSR 数据预取/Hydration 排错 + 真实 AI 业务组件设计」等中高级内容。每个知识点仍遵守三类基础补充（JS/浏览器/Node）+ 🤝 与 React 对照 的硬规则。

- [ ] 16. Nuxt 3 项目初始化 + Monorepo 接入（知识点 12.1 / 12.2 / 12.3）
  - [ ] 16.1. `npx pnpm@9 --filter @ai-study/web-vue-nuxt dlx nuxi@latest init apps/web-vue-nuxt` 或复制模板，创建 package.json：name=@ai-study/web-vue-nuxt，依赖 nuxt@3、@pinia/nuxt、@pinia-plugin-persistedstate/nuxt、@nuxtjs/tailwindcss、@nuxt/image、@nuxtjs/web-vitals
  - [ ] 16.2. 写 `nuxt.config.ts`：alias 指向 `@ai-study/shared`、typescript.tsConfig.extends 引用根 base、modules 数组注册 Pinia/Tailwind/Image/web-vitals、devtools.enabled、port=3000
  - [ ] 16.3. 写 `apps/web-vue-nuxt/tsconfig.json`：extends 根、include 覆盖 `nuxt.config.ts` / `.nuxt/tsconfig.json` 产物、与根 tsconfig references 接入
  - [ ] 16.4. 写 app.vue + layouts/default.vue（移动端布局壳：顶部标题栏 + <NuxtPage /> + 底部 TabBar）
  - [ ] 16.5. 写 pages/index.vue（首页 8 模块卡片 + 面试题入口），约定路由自动生效 `/`；7 个占位 pages/m1.vue~m7.vue
  - [ ] 16.6. 写 components/TabBar.vue + ModuleCard.vue + InterviewCard.vue（自动导入，无需 import）
  - [ ] 16.7. 根 package.json 新增 `dev:ssr` / `build:ssr` 脚本；`dev` 默认改为启动 SSR+BFF（见 design.md）
  - [ ] 16.8. typecheck：`pnpm --filter @ai-study/web-vue-nuxt typecheck` 或 `nuxi typecheck` 通过；启动 `nuxi dev` 端口 3000 首页渲染无 Hydration mismatch
  - **🤖 AI 场景主例必用（任务 16 侧）**：
    - [ ] 16.9. 首页 8 模块卡片（ModuleCard.vue）默认用 AI 主例池的 8 条真实业务命名（API 基础 / 流式 / Prompt 工程 / Chat UI / Function Calling / RAG / Agent / 面试题联动），卡片点击直接跳转对应 pages/m1~m7.vue，不允许出现「个人博客/商品列表」等非 AI Demo
  - **📱 C 端体验验收必查（任务 16 侧，对照 design.md 7 大类）**：
    - [ ] 16.10. 375px 下布局壳验证：顶部标题栏 `padding-top: env(safe-area-inset-top)` + 底部 TabBar `padding-bottom: env(safe-area-inset-bottom)`；横屏 4 边不出界；按钮点击态三态齐全；空状态页插图 + 引导
    - [ ] 16.11. 安全底线 2 条：① 前端产物（dev 模式 + build 后 .output/public）用正则搜索 `sk-[A-Za-z0-9]{20,}` → 结果 = 0；② 全局添加 DOMPurify 到 Markdown 渲染管道（后续模块直接调用，不重复配）

- [ ] 17. Nuxt 3 核心能力落地（知识点 12.4 ~ 12.8）
  - [ ] 17.1. composables/useAiChat.ts：基于 `useAsyncData` + `$fetch`（SSR 安全）实现非流式问答；💡附加 Node 基础：Node 端 fetch 与浏览器 fetch 差异
  - [ ] 17.2. composables/useStreaming.ts：onMounted 后才 new EventSource（防止 SSR 没 window）、逐字累加 ref + close 清理；**支持 LangChain streamEvents v2 事件格式**（统一吃 SSEChunk 映射，打字机+工具+Agent 3 套事件 1 个 composable 全处理）
  - [ ] 17.3. stores/chat.ts：Pinia 多会话 + persistedstate 用 cookie storage（SSR 安全，避免 Hydration 报错）；💡附加 JS 基础：闭包 = Pinia 插件原理
  - [ ] 17.4. middleware/trace-id.ts（示例中间件）：SSR 和浏览器内跳都执行，写入 useCookie('trace_id')；💡附加 Node 基础：HTTP 302/307 Location 头 = SSR 重定向机制
  - [ ] 17.5. server/api/healthz.get.ts（Nitro 健康检查）；**server/api/chat.post.ts / server/api/chat/stream.get.ts 全部改为「Nitro = 透明转发层」** → 只转发请求到 BFF :3001，不做任何 AI 逻辑（AI 逻辑全在 apps/server LangChain 层，Nitro 不碰 API Key 不碰工具执行代码）；💡附加 Node 基础：SSE pipeline 转发（Nitro ReadableStream 接 BFF Response）
  - [ ] 17.6. SEO：每页 `definePageMeta` + `useSeoMeta` 注入 title/description/og:image；💡附加浏览器基础：Googlebot 抓取模型 + 为什么 SSR 对 SEO 意义更大
  - [ ] 17.7. Hydration 错误修复清单整理：时间戳 / 随机数 / typeof window / CSS 客户端差异 / 异步数据 5 个常见场景的解决模板
  - **🤖 AI 场景主例必用（任务 17 侧）**：
    - [ ] 17.8. composables/useStreaming 粘包处理、打字机光标、停止按钮 AbortController = 主例（非通用 fetch Demo）；composables/useTokenCounter（1K=750 字/中文 1≈1.3）+ composables/useConversationSwitcher 草稿自动保存 = 主例
  - **📱 C 端体验验收必查（任务 17 侧，对照 design.md 7 大类）**：
    - [ ] 17.9. 键盘避让：375px iOS Safari 下 composables/useKeyboardAvoidance（visualViewport.resize + rAF 节流）→ 输入框不被键盘挡；发送中按钮三态 + 停止按钮高亮；草稿自动保存刷新不丢
    - [ ] 17.10. Hydration Mismatch 5 场景清单文档落地（附 17.7 的修复模板），刷新 10 次页面控制台搜索 Hydration = 0 条红色警告

- [ ] 18. Nuxt 3 逐模块对齐 7 个 AI 学习模块（知识点 12.9 ~ 12.16）
  - [ ] 18.1. pages/m1.vue（API 基础）：历史消息 useAsyncData SSR 预取 + 发送按钮 useAiChat + loading/error 状态 + 面试题卡片
  - [ ] 18.2. pages/m2.vue（流式）：打字机 + 光标组件 + useStreaming（吃 LangChain stream_events） + 停止按钮（AbortController）+ 面试题卡片
  - [ ] 18.3. pages/m3.vue（Prompt 工程）：预设模板切换 + useConversation composable + Token 计数实时显示 + JSON 结构化渲染组件
  - [ ] 18.4. pages/m4.vue（Chat UI）：移动端全屏聊天布局（顶部标题栏 + 消息区滚动锁定 + 底部输入）+ MessageBubble/MessageList 组件 + Pinia 会话列表
  - [ ] 18.5. pages/m5.vue（Function Calling）：**Nitro server/api/tools/* 只做 BFF 转发（不是执行层）** → `server/api/tools/list.get.ts`（GET /api/tools/list）拿到白名单渲染按钮；`server/api/tools/execute.post.ts`（POST 到 BFF :3001）→ SSE 吃 AgentExecutor.streamEvents，前端只显示 ToolCallCard 三态（loading/参数摘要/结果）；**禁止任何 Zod/StructuredTool/执行逻辑出现在 Nitro + 前端**；💡附加浏览器安全：XSS / 工具 Schema 前端暴露 = C 端风险
  - [ ] 18.6. pages/m6.vue（RAG）：Nitro server/api/rag/* → 全量转发 BFF :3001（apps/server/services/rag/ LangChain 流水线）；文档上传进度条吃 SSE 切片进度事件；文档列表 SSR 前 20 条 useFetch lazy；CitationCard 直接用 shared 的 CitationFragment 渲染（回答气泡点编号 → 展开原文 200 字 → 跳转文档详情页）；💡附加 Node 基础：fs createReadStream + multipart form data 背压处理
  - [ ] 18.7. pages/m7.vue（Agent）：Nitro server/api/agent/* → 转发 BFF :3001（apps/server/services/agent/ LangGraph 状态图）；`graph.streamEvents v2` 事件流 → AgentTimeline 5 色进度条（think/call_tools/tool_output/observe/answer 对应浅灰/蓝加载/绿/灰/紫）；用户干预（暂停/继续/回滚到第 N 步）走 BFF 路由 + checkpointer 恢复；**不手写 while(true) Think-Act-Observe**
  - [ ] 18.8. 部署与性能：NITRO_PRESET=node-server build 产物验证（.output/server/index.mjs）；plugins/web-vitals.client.ts 上报；<NuxtImg> 懒加载 + format=avif/webp
  - **🤖 AI 场景主例必用（任务 18 侧 · 7 模块一条不落下）**：
    - [ ] 18.9. m1：历史消息拼接 + 429 限流错误分层提示；m2：粘包 + 光标 + 指数退避重连；m3：Token 计数滑动窗口 + System Prompt 拼接顺序；m4：多会话切换 + 长按消息菜单；m5：前端白名单 → Nitro 执行工具；m6：Citation 引用卡片 + 分片上传进度；m7：Agent 时间线 5 色进度条 + 暂停/回滚到第 N 步 = 全部用 AI 主例池真实业务当 Demo，不得换通用 Todo/商城
  - **📱 C 端体验验收必查（任务 18 侧 · 7 大类全查 · 真上线门槛）**：
    - [ ] 18.10. ① 性能：Lighthouse 移动端 375px + 3G Fast 跑 10 次中位数达标（FCP<1.2/LCP<2.5/CLS<0.1/INP<200）；单页 JS gzip<150KB ② 交互三态 + 错误分层 + 空状态齐全 ③ 聊天输入键盘避让 + 草稿自动保存 ④ 安全：前端 API Key 正则 =0 / DOMPurify 全覆盖 / 工具执行不在前端 ⑤ 移动端细节：安全区适配 + 1px 细线 + 禁止点击高亮 ⑥ 长聊天列表 ≥50 条虚拟滚动（DOM≤20）+ 骨架屏 shimmer ⑦ a11y：语义化 + aria-label + Tab 顺序走一遍
    - [ ] 18.11. 面试题 AI 场景占比 ≥ 80%：7 个模块所有面试题用 requirements.md 每个模块的「🧠 AI + C 端专属面试题」当底稿，不出现纯前端通用题（套进 AI 场景才能保留）

## Phase 10 🚀：AI 组件生成器（产品主线 ⭐ · 7 模块毕业项目）

> 🚀 **启动条件**：Phase 9（Nuxt SSR 7 模块教学落地）完成后启动。apps/generator 是独立 Nuxt 3 SSR 应用（:3002），复用 BFF apps/server 的 LangChain 编排层（新增 services/generator/）。
>
> ⚠️ **产品定位**：7 个 AI 模块的技术集大成毕业项目。每完成一个子任务，必须挂「🔗 复用了 mX 的什么能力」映射，不做脱离 AI 主线的通用 Demo。

- [ ] 24. apps/generator 项目初始化（知识点 8.1 · 对应 design.md apps/generator 架构）
  - [ ] 24.1. `npx pnpm@9 dlx nuxi@latest init apps/generator`，创建 package.json：name=@ai-study/generator，依赖 nuxt@3、@pinia/nuxt、@nuxtjs/tailwindcss、@guolao/vue-monaco-editor、jszip、file-saver、dompurify
  - [ ] 24.2. 写 `nuxt.config.ts`：port=3002、alias 指向 @ai-study/shared、modules 注册 Pinia/Tailwind/Monaco、devtools.enabled
  - [ ] 24.3. 写 `tsconfig.json`：extends 根 base、include 覆盖 `.nuxt/tsconfig.json`
  - [ ] 24.4. 写 `app.vue` + `layouts/default.vue`：三栏布局壳（对话区 | 代码编辑器 | 预览区），375px 下变 Tab 切换
  - [ ] 24.5. 写 `pages/index.vue`（生成器主页占位）+ `pages/history.vue`（历史列表占位）+ `pages/[id].vue`（详情占位）
  - [ ] 24.6. 写 `server/api/generator/{run,preview,download,history}.ts`（Nitro 透明转发层 → BFF :3001，不做 AI 逻辑）
  - [ ] 24.7. 根 package.json 新增 `dev:generator` / `build:generator` 脚本
  - **📱 C 端验收**：375px 下三栏变 Tab 切换可用；首页 FCP<1.5s（Monaco 懒加载，首屏只渲染对话区）；前端产物正则搜 `sk-[A-Za-z0-9]{20,}` = 0

- [ ] 25. 生成器前端核心组件（知识点 8.1~8.3）
  - **🔗 复用映射**：m4 Chat UI（需求对话）+ m2 流式（代码流式输出）+ 新增 Monaco + 沙箱预览
  - [ ] 25.1. `components/RequirementInput.vue`：需求输入区（回车发送 + 草稿保存 + AbortController 取消）
  - [ ] 25.2. `components/AgentDialog.vue`：Agent 对话区（复用 MessageBubble + 流式打字机，吃 streamEvents v2）
  - [ ] 25.3. `components/CodeEditor.vue` + `composables/useCodeEditor.ts`：Monaco 封装（动态 import 懒加载 + `executeEdits()` 增量插入 + Diff 视图 + 375px 只读模式）
  - [ ] 25.4. `components/SandboxPreview.vue` + `composables/useSandbox.ts`：iframe `sandbox="allow-scripts"` 隔离渲染 + 热更新 + 设备尺寸切换（375px/768px/1024px）
  - [ ] 25.5. `composables/useGenerator.ts`：生成器核心 composable（吃 BFF streamEvents → 代码增量更新 + 预览刷新 + Agent 状态管理）
  - **📱 C 端验收**：Monaco 移动端只读模式（关小地图 + 缩小字体）；iframe sandbox 禁 allow-same-origin；生成中按钮三态 + 可取消

- [ ] 26. 生成器 BFF 编排层（知识点 8.9 · 对应 design.md BFF services/generator）
  - **🔗 复用映射**：m7 LangGraph Agent（5 节点 StateGraph）+ m6 RAG（组件库源码检索）+ m5 FC（5 个工具）+ m3 Prompt 工程（代码生成模板）
  - [ ] 26.1. `services/generator/codegen.ts`：LangChain LCEL 代码生成 chain（Prompt 模板 = 资深前端架构师角色 + 组件规范约束 + 检索到的参考组件注入）
  - [ ] 26.2. `services/generator/rag.ts`：RAG over 组件库源码（复用 services/rag/ 的 VectorStore + Embeddings，额外灌入 Element Plus / Naive UI 组件代码）
  - [ ] 26.3. `services/generator/tools/create_file.tool.ts`：StructuredTool 在沙箱临时目录创建 .vue/.tsx 文件（Zod schema: {filename, content}）
  - [ ] 26.4. `services/generator/tools/run_preview.tool.ts`：触发沙箱编译（esbuild 浏览器端 / Vite dev BFF 端）→ 返回预览 URL
  - [ ] 26.5. `services/generator/tools/generate_props.tool.ts`：`@vue/compiler-sfc` / `@babel/parser` 解析 AST → 生成 PropDoc[]
  - [ ] 26.6. `services/generator/tools/generate_tests.tool.ts`：基于 Props 边界值 + 交互场景生成 Vitest 测试代码
  - [ ] 26.7. `services/generator/tools/validate_code.tool.ts`：ESLint + TypeScript 类型检查（AST 级别）→ ValidationIssue[]
  - [ ] 26.8. `services/generator/sandbox.ts`：沙箱管理（临时目录 + 编译进程隔离 + 预览 URL 生成 + 超时清理 30s）
  - [ ] 26.9. `services/generator/agent.ts`：LangGraph StateGraph 5 节点（clarify → retrieve → generate → preview → validate）+ 条件边（`clarify → if need_clarify then clarify else retrieve` / `validate → if user_satisfied then answer else iterate`）+ checkpointer
  - [ ] 26.10. `routes/generator.ts`：POST `/api/generator/run`（streamEvents v2 SSE）+ POST `/preview` + GET `/download`（ZIP 流）+ GET `/history` + GET `/history/:id`
  - **📱 C 端验收**：create_file 只写临时目录不碰项目源码；API Key 只在 apps/server 读 env；5 个工具的 Zod schema 不暴露到前端

- [ ] 27. 生成器辅助面板与历史管理（知识点 8.4~8.8）
  - [ ] 27.1. `components/PropsDocPanel.vue`：Props/Emits/Slots 文档面板（表格渲染 PropDoc[]）
  - [ ] 27.2. `components/TestPanel.vue`：测试用例展示 + 运行结果 + 失败用例高亮
  - [ ] 27.3. `components/DownloadBar.vue`：ZIP 打包（jszip + file-saver）+ 复制代码 + 导出 Gist（预留）
  - [ ] 27.4. `composables/useComponentHistory.ts` + `stores/generator.ts`：Pinia 多会话 + checkpointer 按 thread_id 拉取历史 + 草稿持久化
  - [ ] 27.5. `pages/history.vue` + `pages/[id].vue`：历史列表虚拟滚动（≥20 个）+ 详情回放（Agent 步骤 + 代码 + 文档 + 测试 + 下载）
  - **📱 C 端验收**：历史列表虚拟滚动（DOM≤15）；ZIP 下载移动端 File System Access API / fallback download；文档面板表格 375px 可横向滚动

- [ ] 28. 生成器整体联调 + C 端验收
  - **🤖 AI 主例必用（生成器全链路）**：端到端跑 3 个真实场景（① 带防抖搜索框 ② 可拖拽排序的 TodoList ③ 带分页的数据表格），每个场景必须走完 clarify→retrieve→generate→preview→validate→download 全流程
  - **📱 C 端验收必查（对照 design.md 生成器专属 7 大类）**：
    - [ ] 28.1. ① 性能：Lighthouse 375px + 3G FCP<1.5s（Monaco 懒加载）；单页 JS gzip<200KB（Monaco 按需加载）② 交互三态：生成按钮 + Agent 追问跳过 + 代码编辑三态切换 ③ 输入：回车发送 + AbortController 取消 + 草稿保存 ④ 安全：iframe sandbox 禁 same-origin + create_file 只写临时目录 + API Key=0 ⑤ 移动端：三栏 Tab 切换 + Monaco 只读 + 预览 375px 设备框 ⑥ 长列表：历史虚拟滚动 + 代码 >500 行折叠 ⑦ a11y：Monaco aria-label + iframe title + Tab 顺序
    - [ ] 28.2. 面试题：用 requirements.md 模块 8 的「🧠 AI + C 端专属面试题」（沙箱安全 + 流式代码渲染）当底稿，AI 场景占比 ≥ 80%

## Phase 11：React / Vue SPA 对照端功能对齐（可选，并行维护）

- [ ] 19. React 端（apps/web-react）功能对照回补
  - [ ] 19.1. 用表格整理「Nuxt 页面/组件/Composable ↔ React 页面/组件/Hook」对照关系（附 Vue↔React API 映射速查：ref↔useState、computed↔useMemo、watch/watchEffect↔useEffect、Pinia↔Redux Toolkit、Composables↔Hooks、SFC↔FC、defineProps↔props 参数、defineEmits↔onXxx props）
  - [ ] 19.2. 补齐 modules/* 缺失的面试题联动 + 基础补充卡片
- [ ] 20. Vue SPA 端（apps/web-vue）功能对照回补
  - [ ] 20.1. 按 Nuxt 端实现复制 + Vue Router 手动路由映射
  - [ ] 20.2. 同一页面对比 CSR vs SSR 首屏（TTFB / FCP / LCP 量化）

## Phase 12：教学附加 —— 全知识点「JS / 浏览器 / Node」基础补充落地

> ⚠️ **教学硬规则**：后续讲解每一个知识点时，必须从 requirements.md 附录 A/B/C 挑选 1~3 条强关联基础补充，按下面的格式写在知识点学习要点之后。**不得跳过或混在主线里，必须显式分节**。

- [ ] 21. 基础补充「格式规范」模板统一（已写入 project_memory Pedagogy Conventions 最新章节）
  - [ ] 21.1. **讲解顺序强制执行 7 段式（缺一不可）**：① 💡 三类基础补充（至少 1 类）② 🤖 AI 场景价值（说明这个知识点在 7 个 AI 模块里解决什么真实问题，不用 Todo/商城 Demo）③ 📚 主线知识点原理解析 ④ 💻 代码实现（AI 主例池里的真实业务当例子）⑤ 📱 C 端生产化改造（从 design.md 7 大类清单选适用的 3~5 条）⑥ 🤝 与 React 对照（Vue 知识点时必做）⑦ 🧠 面试题 / 常见坑（AI 产品场景题 ≥ 80%，纯前端通用题必须套进 AI 业务后才能保留）
  - [ ] 21.2. 标题符号固定：「💡 JS 基础补充 / 💡 浏览器基础补充 / 💡 Node 基础补充 / 🤖 AI 场景价值 / 📱 C 端生产化改造 / 🤝 与 React 对照 / 🧠 AI + C 端专属面试题」—— 7 个 emoji 缺一不可，肉眼可扫
  - [ ] 21.3. 每条补充必须包含：(1) 关联的主线知识点编号 (2) 用生活类比的概念讲解 (3) 代码或时序示意图（可选）(4) 面试提问角度
  - [ ] 21.4. 反例检查：若讲解里出现「Counter 计数器」「TodoList」「用户管理系统 CRUD」「电商购物车」等非 AI 业务作为主例，直接判定为不符合格式要求；必须使用 project_memory 里的 AI 主例池（useStreaming / useAiChat / Token 计数 / 多会话切换 / Pinia 聊天 / Function Calling 白名单 / RAG 引用 / Agent 时间线 8 条）之一作为主例
- [ ] 22. 模块 1~7 + 工程化 + BFF + SSR 的文档，全部按模板附加基础补充
  - [ ] 22.1. 所有涉及 Promise / async-await 的知识点，必须附加 A.5 事件循环 + A.6 Promise 状态机 / A.7 async-await 编译产物
  - [ ] 22.2. 所有涉及前端 UI / 动画 / 滚动的知识点，必须附加 B.1 渲染流水线 + B.2 重绘回流 / B.10 rAF 定时器
  - [ ] 22.3. 所有涉及 SSE / 流式 / 上传下载的知识点，必须附加 C.8 Node Stream + pipeline + B.6 HTTP 多路复用
  - [ ] 22.4. 所有涉及 BFF / SSR / Nitro 的知识点，必须附加 C.7 Express 中间件原理 + C.1 Node 事件循环 6 阶段 + C.4 Node ESM 模式
  - [ ] 22.5. 所有涉及 TS 类型 / 工具参数校验的知识点，必须附加 A.8 typeof/toString 类型判断 + A.10 TS 类型收窄 6 种方式
  - [ ] 22.6. 所有涉及 SSR 数据预取 / Hydration 的知识点，必须附加 B.5 跨域 + B.12 History API + C.2 process 对象 / 信号监听
  - [ ] 22.7. 所有涉及 Pinia / Redux / 闭包插件的知识点，必须附加 A.2 闭包 4 类场景 + A.13 Proxy&Reflect 响应式原理
  - [ ] 22.8. 所有涉及会话 / Cookie / 持久化的知识点，必须附加 B.4 存储体系安全（HttpOnly/Secure/SameSite）+ B.14 XSS / CSRF 防护
- [ ] 23. 生成「JS 基础 18 条」「浏览器 14 条」「Node 基础 16 条」的思维导图式速查图（后续按需）
  - [ ] 23.1. A 类 JS：按「执行模型 → 类型系统 → 模块化 → 标准内置 → 错误处理」5 条主线梳理
  - [ ] 23.2. B 类浏览器：按「渲染 → 事件 → 存储 → 网络 → DOM/BOM → 安全」6 条主线梳理
  - [ ] 23.3. C 类 Node：按「运行时模型 → 模块 → 内置模块 → 进程线程 → 生产部署」5 条主线梳理

---

## Phase 13 🔒：Electron 桌面端（方案 A · **预留，当前不开发**）

> **🔒 触发启动条件**：必须先完成 Phase 10（AI 组件生成器产品主线）全部落地（任务 24~28 全部打勾），再按本 Phase 执行。任何情况下不得提前创建 `apps/desktop` 目录或安装 electron 依赖。
>
> 📌 **采用方案 A（最通用、改动最小）**：Electron = 桌面壳 + 系统能力，UI 直接复用 apps/generator（AI 组件生成器）的 Nuxt 3 产物（开发期 loadURL → :3002，生产期 loadFile 静态产物），Electron 只写主进程/preload/IPC，不重写 UI 代码。Electron 版生成器 = **本地 AI 组件生成器**（内置 BFF + 本地向量库，用户代码永不离机）。
>
> 💡 **预留说明**：下列任务全部按 requirements.md 模块 13 的知识点 13.1~13.10 规划，当前仅记录，不打勾、不执行。

- [ ] 29. Electron 项目骨架初始化（方案 A，🔒 暂不执行，对应知识点 13.1~13.3）
  - [ ] 29.1. 创建 apps/desktop 目录 + package.json（name=@ai-study/desktop，private=true，type=module）
  - [ ] 29.2. 安装依赖：electron@latest、electron-builder、electron-updater、electron-rebuild；devDependencies：@types/node、tsx、typescript
  - [ ] 29.3. 创建 electron/main.ts：BrowserWindow + 安全三件套（contextIsolation/nodeIntegration/sandbox），开发期 `loadURL('http://localhost:3002')`（生成器端口），生产期 `loadFile(...)`
  - [ ] 29.4. 创建 electron/preload.ts：`contextBridge.exposeInMainWorld('electronAPI', {})` 空白名单桥
  - [ ] 29.5. 写 apps/desktop/tsconfig.json（extends 根，include electron/**/*.ts，types node/electron）
  - [ ] 29.6. 写脚本 dev / build，根 package.json 追加 dev:desktop / build:desktop
  - [ ] 29.7. 开发期启动验证：`pnpm dev:desktop` → Electron 窗口正确加载生成器 :3002 首页，Console 无安全告警（Electron Security Warnings）
- [ ] 30. 安全三件套 + IPC 白名单系统能力落地（🔒 暂不执行，对应知识点 13.2 / 13.4 / 13.5 / 13.6）
  - [ ] 30.1. IPC：ipcMain.handle ↔ ipcRenderer.invoke 的请求-响应封装，对应 selectFile/saveFile/messageBox
  - [ ] 30.2. 托盘（Tray）+ 应用菜单 + 全局快捷键 + 原生通知（跨平台 macOS/Windows/Linux 差异处理）
  - [ ] 30.3. 生成器端封装 composables/useDesktopApi.ts：自动判断环境 → Electron 用 IPC / Web 回退到 <input type="file"> + Notification API（业务层无分叉）
- [ ] 31. 原生依赖 rebuild + 内置 BFF 模式（方案 B 升级，🔒 暂不执行，对应知识点 13.7 / 13.8）
  - [ ] 31.1. better-sqlite3 与 Electron ABI 匹配：postinstall 钩子 `electron-rebuild -f -w better-sqlite3` 验证
  - [ ] 31.2. 内置 BFF：main.ts 里 import apps/server 的 createApp，监听 `127.0.0.1:0` 随机端口，app.getPath('userData')/generator/ 存 rag.db + 生成器沙箱临时目录
  - [ ] 31.3. 退出生命周期优雅关闭：before-quit / will-quit / quit 三阶段里 server.close() + 托盘销毁 + 全局快捷键注销 + 沙箱临时目录清理
- [ ] 32. 自动更新 + 打包分发（🔒 暂不执行，对应知识点 13.9 / 13.10）
  - [ ] 32.1. electron-builder.yml 配置（appId / asar / nsis / dmg / AppImage / 打包图标）
  - [ ] 32.2. 自动更新：autoUpdater.checkForUpdatesAndNotify() + 事件监听（download-progress / update-downloaded）
  - [ ] 32.3. Monorepo 打包产物验证：确保 `@ai-study/shared` 与 `@ai-study/server` workspace 依赖正确复制到 asar 内
  - [ ] 32.4. 多平台构建策略（当前平台一次 + GitHub Actions 矩阵跨平台的说明文档）
