# 详细学习计划 - 技术设计

## 整体架构

```
ai-frontend-lab/
├── index.html                    # viewport meta 移动端配置
├── src/
│   ├── main.tsx                  # 入口 + Router
│   ├── App.tsx                   # 路由配置 + 底部 Tab 导航
│   ├── components/               # 公共组件
│   │   ├── Layout.tsx            # 移动端全屏布局壳
│   │   ├── TabBar.tsx            # 底部导航栏
│   │   └── InterviewCard.tsx     # 面试题卡片组件
│   ├── services/
│   │   └── ai.ts                 # AI API 统一封装
│   ├── modules/
│   │   ├── 01-api-basics/        # 模块1
│   │   ├── 02-streaming/         # 模块2
│   │   ├── 03-prompt/            # 模块3
│   │   ├── 04-chat-ui/           # 模块4
│   │   ├── 05-function-calling/  # 模块5
│   │   ├── 06-rag/               # 模块6
│   │   └── 07-agent/             # 模块7
│   └── data/
│       └── interview-questions.ts # 面试题数据（按模块/知识点组织）
```

## 移动端适配方案

### viewport 配置

```html
<!-- index.html -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
```

### 布局策略

- 全屏布局：`h-screen` + `flex flex-col`
- 底部导航固定：`fixed bottom-0`，高度 56px
- 内容区域：`flex-1 overflow-y-auto pb-14`（预留底部导航空间）
- 安全区域：`pb-[env(safe-area-inset-bottom)]`

### 触摸交互规范

- 可点击元素最小尺寸：44px × 44px
- 按钮间距 ≥ 8px
- 列表项高度 ≥ 48px
- 输入框高度 ≥ 44px

## 面试题系统设计

### 数据结构

```typescript
// src/data/interview-questions.ts

interface InterviewQuestion {
  id: string                          // 唯一标识，如 "1.3-q1"
  moduleId: number                    // 所属模块 1-7
  knowledgePointId: string            // 关联知识点，如 "1.3"
  difficulty: 'junior' | 'mid' | 'senior'  // 难度
  category: 'principle' | 'coding' | 'design'  // 类型：原理/编码/设计
  question: string                    // 题目
  answerPoints: string[]              // 答案要点（数组）
  relatedCode?: string                // 关联的代码文件路径
}
```

### 面试题与知识点的关联方式

每个知识点完成后，页面底部展示关联的面试题卡片：
- 默认折叠，只显示题目和难度标签
- 点击展开查看答案要点
- 可标记「已掌握」状态（localStorage 持久化）

### 面试题卡片 UI

```
┌─────────────────────────────────┐
│ 🎯 中级 | 原理理解               │
│                                 │
│ Q: SSE 和 WebSocket 有什么区别？  │
│    各自适用什么场景？             │
│                                 │
│         [ 查看答案 ▼ ]           │
└─────────────────────────────────┘

展开后：
┌─────────────────────────────────┐
│ 🎯 中级 | 原理理解               │
│                                 │
│ Q: SSE 和 WebSocket 有什么区别？  │
│                                 │
│ 答案要点：                       │
│ • SSE 单向（服务端→客户端）       │
│ • WebSocket 双向通信             │
│ • SSE 基于 HTTP，自动重连        │
│ • AI 流式输出适合 SSE            │
│                                 │
│   [ ✅ 已掌握 ]  [ 查看答案 ▲ ]  │
└─────────────────────────────────┘
```

## 各模块页面设计

### 通用页面结构（移动端）

```
┌──────────────────────────┐
│  ← 模块 1: AI API 基础   │  ← 顶部标题栏 (44px)
├──────────────────────────┤
│                          │
│  [知识点内容区域]         │  ← 可滚动内容区
│  - 说明文字              │
│  - 代码展示              │
│  - 运行效果              │
│                          │
│  ─── 面试题 ───          │
│  [面试题卡片1]           │
│  [面试题卡片2]           │
│                          │
├──────────────────────────┤
│  📖  💬  🔧  📚  🤖    │  ← 底部 Tab 导航 (56px)
│  API 流式 Prompt 聊天 更多│
└──────────────────────────┘
```

### 模块 1 页面设计（示例）

```
ApiBasics.tsx 页面结构：
┌──────────────────────────┐
│  AI API 基础调用          │
├──────────────────────────┤
│                          │
│  输入你的问题：           │
│  ┌────────────────────┐  │
│  │                    │  │
│  └────────────────────┘  │
│                          │
│  [ 发送请求 ]            │
│                          │
│  ── 响应结果 ──          │
│  ┌────────────────────┐  │
│  │ AI 回复内容...      │  │
│  └────────────────────┘  │
│                          │
│  ── 学习面试题 ──        │
│  [面试题卡片]            │
│                          │
└──────────────────────────┘
```

### 模块 4 聊天界面设计（移动端全屏）

```
┌──────────────────────────┐
│  ← AI 聊天    [清空] [⋮] │  ← 顶部栏
├──────────────────────────┤
│                          │
│        用户消息 ──┐      │
│                   │气泡│ │
│                   └───┘  │
│  ┌───┐                   │
│  │AI │── AI 回复消息      │
│  └───┘   (Markdown渲染)  │
│                          │
│        用户消息 ──┐      │
│                   └───┘  │
│  ┌───┐                   │
│  │AI │── 流式生成中...▌   │
│  └───┘                   │
│                          │
├──────────────────────────┤
│ ┌──────────────────┐ [➤] │  ← 底部输入栏 (固定)
│ │ 输入消息...       │     │
│ └──────────────────┘     │
└──────────────────────────┘
```

## 路由设计

```typescript
// src/App.tsx
const routes = [
  { path: '/', element: <Home /> },           // 首页（模块列表）
  { path: '/m1', element: <ApiBasics /> },    // 模块1
  { path: '/m2', element: <Streaming /> },    // 模块2
  { path: '/m3', element: <PromptLab /> },    // 模块3
  { path: '/m4', element: <ChatPage /> },     // 模块4
  { path: '/m5', element: <FunctionCalling /> }, // 模块5
  { path: '/m6', element: <RagPage /> },      // 模块6
  { path: '/m7', element: <AgentPage /> },    // 模块7
]
```

## 面试题数据示例

```typescript
// src/data/interview-questions.ts（部分示例）

export const interviewQuestions: InterviewQuestion[] = [
  // 模块 1
  {
    id: '1.1-q1',
    moduleId: 1,
    knowledgePointId: '1.1',
    difficulty: 'junior',
    category: 'principle',
    question: '大模型 API 中 temperature 参数的作用是什么？设为 0 和 2 分别有什么效果？',
    answerPoints: [
      'temperature 控制输出的随机性/创造性',
      '0 = 确定性输出，每次结果几乎相同',
      '2 = 高随机性，输出更多样但可能不连贯',
      '一般推荐 0.7-1.0 平衡创造性和准确性',
    ],
  },
  {
    id: '1.3-q1',
    moduleId: 1,
    knowledgePointId: '1.3',
    difficulty: 'mid',
    category: 'coding',
    question: '如何在前端安全地管理 AI API Key？直接写在前端代码中有什么风险？',
    answerPoints: [
      '前端代码会被用户看到，API Key 会泄露',
      '推荐方案：BFF 代理层，前端只请求自己的后端',
      '开发阶段可用 .env.local + VITE_ 前缀',
      '生产环境必须通过后端转发，前端不持有 Key',
    ],
  },
  {
    id: '1.7-q1',
    moduleId: 1,
    knowledgePointId: '1.7',
    difficulty: 'mid',
    category: 'coding',
    question: '请解释 AbortController 的工作原理，如何用它实现请求超时？',
    answerPoints: [
      'AbortController 创建一个 signal 对象',
      'signal 传给 fetch 的 options',
      '调用 controller.abort() 会中断请求',
      '超时实现：setTimeout + abort()',
      '组件卸载时也应 abort 防止内存泄漏',
    ],
  },
  // 模块 2
  {
    id: '2.1-q1',
    moduleId: 2,
    knowledgePointId: '2.1',
    difficulty: 'mid',
    category: 'principle',
    question: 'SSE 和 WebSocket 有什么区别？AI 流式输出为什么选择 SSE？',
    answerPoints: [
      'SSE 单向（服务端→客户端），WebSocket 双向',
      'SSE 基于 HTTP，天然支持重连和事件类型',
      'WebSocket 需要额外的握手协议',
      'AI 输出是单向流，SSE 更轻量合适',
      'SSE 兼容性好，不需要额外服务器配置',
    ],
  },
  {
    id: '2.2-q1',
    moduleId: 2,
    knowledgePointId: '2.2',
    difficulty: 'senior',
    category: 'coding',
    question: '请手写一个 ReadableStream 的消费逻辑，处理流式 AI 响应',
    answerPoints: [
      'response.body.getReader() 获取 reader',
      'new TextDecoder() 解码二进制为文本',
      'while 循环 + reader.read() 逐块读取',
      '判断 done 为 true 时退出循环',
      '处理 chunk 可能包含多行或不完整行的情况',
    ],
  },
]
```

## 技术选型

| 用途 | 选择 | 理由（🎯 AI + C 端双侧重动机） |
|------|------|------|
| 框架（主学习端 ⭐） | **Nuxt 3（Vue 3 SSR）+ TypeScript** | **C 端**：SSR 3G 弱网下 FCP<1.2s / LCP<2.5s，历史聊天首屏不转圈；SEO 收录 AI 学习路径页面；**AI**：Nitro server route 承载工具 Schema 执行 / RAG 上传 / Agent 循环，前端不含 API Key 或敏感逻辑 |
| 框架（对照端） | React 18 + TypeScript（SPA） | 项目已有，作为「同一 AI 需求」的 Vue↔React 代码对照（面试常用） |
| 框架（对照端） | Vue 3 + Vite（SPA） | 项目已有，作为「CSR vs SSR」C 端首屏体感对照（375px 秒表计时对比 TTFB/FCP/LCP） |
| 构建 | Vite（Nuxt 内置 Vite，React/Vue SPA 直用 Vite） | 统一构建工具；**C 端**：单页 JS gzip < 150KB 可测，代码分割 + Tree Shaking 成熟 |
| 样式 | Tailwind CSS v3 | **C 端**：移动端优先（375px 一等公民）、`md:` 前缀适配大屏、原子类避免首屏 CSS 体积膨胀；三端复用同一视觉规范（AI 产品主题色） |
| 路由（Nuxt） | **文件系统约定路由**（pages/ 目录） | **C 端**：AI 7 模块落地时 pages/m1~m7.vue 零配置、动态路由 `[id].vue` 用于单会话详情；无需手写路由表 → 少 bug |
| 路由（React） | React Router v6 | 轻量、支持懒加载；对照端 Vue Router ↔ React Router 路由表映射对比 |
| 路由（Vue SPA） | Vue Router v4 | Vue 官方；对照端学习导航守卫（C 端登录态/会话态拦截） |
| 状态（Nuxt / Vue） | **Pinia**（@pinia/nuxt 模块，SSR 安全） | **AI**：多会话历史 / Token 计数 / Agent 时间线的复杂状态管理；**C 端**：SSR 下用 cookie storage 持久化，彻底避免 Hydration Mismatch |
| 状态（React） | Redux Toolkit | 企业级标准；对照端 Pinia ↔ Redux Toolkit 状态拆分模式对照 |
| Markdown 安全（所有端必加） | **DOMPurify**（markdown-it/react-markdown 渲染前强制过一遍） | **C 端安全底线**：AI 生成内容里可能有用户注入的 `<script>`/`<img onerror>`，**任何端渲染 Markdown 都必须 DOMPurify 过滤**，否则 XSS 直接拿 Cookie/调用 API |
| Markdown（Vue 端） | markdown-it + Shiki / @vueup/vue-quill | **AI**：流式逐字增量渲染、代码块一键复制、数学公式（可选）；Vue 生态成熟 |
| Markdown（React 端） | react-markdown + rehype-highlight | **AI**：同上，React 生态成熟方案；对照 Vue/React 渲染差异 |
| 代码高亮 | Shiki（推荐）/ highlight.js | Shiki 逐 token 配色更准确；**C 端**：代码高亮 CSS 首屏内联，避免代码块渲染后闪一下变样式（CLS > 0.1） |
| 可观测性 & C 端性能基线 | **@nuxtjs/web-vitals + Lighthouse CI** | **C 端上线门槛**：每次 CI Lighthouse 移动端 375px + 3G Fast 跑一次，FCP<1.2s / LCP<2.5s / CLS<0.1 / INP<200ms 不达标禁止合并；Web Vitals 真实用户数据上报 BFF |
| 桌面端（方案 A · 🔒 预留） | **Electron + TypeScript（方案 A）** | 最通用、改动最小：Electron = 桌面壳 + 系统能力，UI 直接复用 Nuxt/Vue 产物（零分叉）；**AI 方案 B 升级路径**：内置本地 BFF（better-sqlite3 向量检索全本地，用户数据永不离机 = 企业 AI 知识库合规） |
| AI 编排 SDK（BFF 端 ⭐） | **@langchain/core + @langchain/openai** | **AI 侧动机**：m5/m6/m7 全部基于 LangChain 生态实现，不手写裸 fetch 拼 messages → 避免 90% 的 API 兼容坑（tool_calls 格式、stream_events、结构化输出、token 计数、重试/限流）；统一的 Runnable/LCEL 接口，后续换通义/DeepSeek/Azure OpenAI 只改 1 行；**C 端侧动机**：stream_events SSE 协议和前端 useStreaming 粘包规则一致，打字机体验稳定（光标不闪） |
| Function Calling 工具抽象（BFF · m5） | **LangChain StructuredTool + Zod Schema + RunnableSequence** | **AI 侧动机**：所有工具（计算器/时间/天气/知识库检索/网页浏览）统一走 StructuredTool 声明（名字 + description + Zod 输入 schema + 同步/异步实现），LangChain 自动把 Schema 注入 system prompt + 解析 tool_calls；**C 端安全底线**：前端只传用户问题 + 工具白名单 ID，工具执行 **只在 BFF**，工具 Schema **不暴露到前端**，避免 XSS 注入伪造 tool_call 攻击 |
| RAG 文档流水线（BFF · m6） | **@langchain/community（Loader + RecursiveCharacterTextSplitter）+ 可插拔 VectorStore** | **AI 侧动机**：不手写 split('\n\n') 切片；标准 Loader（PDF 用 pdf-parse/Unstructured、Markdown/Text）+ RecursiveCharacterTextSplitter（重叠 chunk、按 120/256/512 可调）+ LangChain Embeddings 接口；**C 端侧动机**：大文件分片上传 + LangChain 流式索引进度（Nitro → BFF → 前端 SSE）= 上传界面百分比真实可看，不是假进度；**默认可插拔**：先上 `MemoryVectorStore(@langchain/core)` 教学，持久化用 SQLite-vec 或 Qdrant（一行替换代码，不影响 UI） |
| RAG 向量检索（默认可插拔） | **MemoryVectorStore（@langchain/core / 教学用）→ SQLite-vec（桌面端本地 / 生产）→ Qdrant（远程 / 生产）** | **AI 侧动机**：RetrievalQAChain 标准流程（query → embedding → topK 检索 → 拼接上下文 → LLM 回答 + citation），和主流教程对齐；**C 端侧动机**：topK 命中片段直接通过 shared 类型传到前端 CitationCard，点击跳原文 = RAG 引用来源可视化一步到位 |
| Agent 状态机编排（BFF · m7） | **@langchain/langgraph（StateGraph + MemorySaver Checkpointer + Human-in-the-loop 中断）** | **AI 侧动机**：不手写 Think-Act-Observe while 循环状态机（容易漏「回滚/暂停/重试第 N 步」）；LangGraph StateGraph 声明式节点（think / call_tool / observe / answer） + 边 + 条件边，天然支持多轮；**C 端侧动机**：Checkpointer 持久化（MemorySaver 或 SQLiteSaver）= Agent 任务跑一半关闭浏览器，下次进来还能从第 3 步继续；前端 AgentTimeline 直接吃 graph.streamEvents 的事件流（node_start / node_end / tool_start / tool_output）= 时间线 5 色进度条一步到位 |
| LangGraph 检查点持久化（BFF 可选） | better-sqlite3（@langchain/langgraph-checkpoint-sqlite） | **AI 侧动机**：Agent 会话跑几十步不丢状态；**C 端侧动机**：用户刷新（Hydration 后）用 conversationId 直接拉 langgraph.getState() → 前端恢复时间线到第几步 = 多端同步基础 |
| 代码编辑器（生成器前端 ⭐） | **Monaco Editor（@guolao/vue-monaco-editor）** | **AI 侧动机**：AI 流式生成代码时 Monaco 提供增量 Diff 视图 + 语法高亮 + 智能提示；**C 端侧动机**：375px 下 Monaco 支持移动端只读模式（关掉小地图 + 缩小字体），桌面端全功能编辑 |
| 沙箱预览（生成器核心 ⭐） | **iframe + esbuild（浏览器端编译）/ Vite dev server（BFF 端编译）** | **AI 侧动机**：AI 生成组件后立即在沙箱里渲染预览，用户看到效果才迭代；**C 端安全底线**：iframe sandbox 属性隔离（allow-scripts 但禁 allow-same-origin），防止生成的代码访问父页面 Cookie/DOM |
| 代码 AST 解析（生成器 BFF） | **@vue/compiler-sfc（Vue SFC）+ @babel/parser（TSX/JSX）** | **AI 侧动机**：generate_props 工具需要解析 SFC 的 defineProps / TSX 的 interface Props → 自动生成组件文档；**C 端侧动机**：validate_code 工具用 AST 做静态检查（未使用变量 / 缺少 props 类型）比正则更准 |
| ZIP 打包下载（生成器前端） | **jszip + file-saver** | **AI 侧动机**：生成的组件 + 文档 + 测试用例打包下载；**C 端侧动机**：375px 移动端也支持下载到本地文件系统（File System Access API / fallback download attribute） |

## 开发顺序（⚠️ **优先级重新调整：生成器产品主线为先**）

1. **Phase 0**：项目基础设施（路由、布局、Tab 导航、面试题组件）
2. **Phase 1**：模块 1 + 模块 2（API 基础 + 流式）
3. **Phase 2**：模块 3 + 模块 4（Prompt + 聊天界面）
4. **Phase 3**：模块 5（Function Calling）
5. **Phase 4**：模块 6 + 模块 7（RAG + Agent）
6. **Phase 5**：面试题数据填充 + 整体联调
7. **Phase 6**：Monorepo 工程化改造 ✅
8. **Phase 7**：Node.js BFF 服务端开发（含 LangChain 编排层）
9. **Phase 8**：packages/shared 公共包抽离 + 三端联调
10. **Phase 9 🔝**：**Vue3 SSR（Nuxt 3）端初始化** → 7 个 AI 学习模块在 SSR 端逐模块落地
11. **Phase 10 🚀（产品主线 ⭐）**：**AI 组件生成器**（apps/generator）——7 模块技术集大成毕业项目，独立 Nuxt SSR 应用 + BFF services/generator 编排层 + Monaco 编辑器 + 沙箱预览 + ZIP 下载
12. **Phase 11（对照补全）**：React 端 + Vue SPA 端与 Nuxt SSR 端功能对齐（选做）
13. **Phase 12（教学附加）**：全部知识点按 JS/浏览器/Node 三类「基础补充」标注讲解完成
14. **Phase 13（🔒 预留，当前不开发）**：Electron 桌面端（方案 A）初始化 + 打包分发（在 Phase 10 生成器主线完成后启动；Electron 版生成器 = 本地 AI 组件生成器，数据永不离机）

---

## Monorepo 架构（Phase 6）

### 目录结构

```
ai_study/
├── apps/
│   ├── web-react/            # React 端（原项目，7 个学习模块）
│   │   ├── package.json      # name: "@ai-study/web-react"
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── tsconfig.json
│   │   ├── index.html
│   │   └── src/              # 原 src 完整迁移至此
│   ├── web-vue/              # Vue3 网页端（新建）
│   │   ├── package.json      # name: "@ai-study/web-vue"
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── tsconfig.json
│   │   ├── index.html
│   │   └── src/
│   ├── server/               # Node.js BFF 服务端（新建）
│   │   ├── package.json      # name: "@ai-study/server"
│   │   ├── tsconfig.json
│   │   ├── .env.example
│   │   └── src/
│   └── desktop/              # Electron 桌面端（方案 A · 🔒 预留，暂不创建）
│       ├── package.json      # name: "@ai-study/desktop"；依赖 electron、electron-builder、tsx；workspace 依赖 @ai-study/shared、@ai-study/server
│       ├── electron.vite.config.ts  # 主进程/preload 打包（🔒 预留）
│       ├── electron/
│       │   ├── main.ts       # BrowserWindow + Tray + Menu + IPC 主入口 + 内置 BFF 启动（预留）
│       │   └── preload.ts    # contextBridge 白名单暴露（预留）
│       ├── electron-builder.yml     # 打包配置（nsis/dmg/AppImage，预留）
│       └── build/            # 图标/安装资源（预留）
├── packages/
│   └── shared/               # 公共类型/常量/工具
│       ├── package.json      # name: "@ai-study/shared"
│       ├── tsconfig.json
│       └── src/
│           ├── types/        # ChatRequest 等类型
│           ├── constants/    # 模型白名单等
│           └── utils/        # Token 估算、SSE 解析
├── pnpm-workspace.yaml       # pnpm workspace 配置
├── tsconfig.base.json        # 共享 TS 配置
├── package.json              # 根 package.json（scripts + workspace deps）
├── .editorconfig
├── .prettierrc
├── .eslintrc.js
├── tailwind.config.js        # 根 Tailwind 预设（可选）
└── .gitignore                # 统一忽略
```

### 技术选型更新

| 用途 | 选择 | 说明 |
|------|------|------|
| 包管理器 | **pnpm** | Workspace 原生支持、硬链接节省磁盘、严格幽灵依赖防护 |
| Node 服务端框架 | **Express** + TypeScript | 生态成熟、上手快、配合 SSE 流式非常成熟 |
| 服务端运行时 | **tsx** + nodemon(可选) | tsx 比 ts-node 快，开发友好；生产用 `tsc && node dist` |
| Vue3 路由 | **Vue Router v4** | Vue 官方路由 |
| Vue3 状态 | **Pinia** | Vue 官方推荐，替代 Vuex |
| Vue3 构建 | **Vite** + `@vitejs/plugin-vue` | 与 React 端统一构建工具 |
| 跨端通信 | **HTTP + SSE** | Web-React 和 Web-Vue 都请求 Server BFF，BFF 再调 AI 服务 |
| 包构建（shared） | 直接源码引用（初期），后续可选 `tsup` | 工作区 symlink 直接引用 TS 源文件即可 |

### 端口规划（更新：SSR 主学习端占对外端口）

| 项目 | 端口 | 说明 |
|------|------|------|
| apps/web-react       | 5173 | React SPA（对照端） |
| apps/web-vue         | 5174 | Vue 3 SPA（对照端） |
| **apps/web-vue-nuxt** | **3000** | **Nuxt 3 SSR 主学习端 ⭐（C 端对外入口，浏览器访问它）** |
| apps/server          | 3001 | Node Express BFF（SSR 端内部请求，不直接暴露给浏览器） |
| **apps/desktop**     | **开发期不占端口（Electron BrowserWindow 直接 loadURL → :3000）；内置 BFF 模式使用 49152+ 随机端口** | **🔒 Electron 方案 A 预留，当前不创建；启动时会自动拉起 Nuxt :3000 + BFF :3001 或独立内置 BFF** |

### 根 package.json 统一脚本示例

```json
{
  "scripts": {
    "dev":        "pnpm --parallel --filter @ai-study/web-vue-nuxt --filter @ai-study/server dev",
    "dev:ssr":    "pnpm --filter @ai-study/web-vue-nuxt dev",
    "dev:react":  "pnpm --filter @ai-study/web-react dev",
    "dev:vue":    "pnpm --filter @ai-study/web-vue dev",
    "dev:server":  "pnpm --filter @ai-study/server dev",
    "dev:all":     "pnpm --parallel --filter @ai-study/web-vue-nuxt --filter @ai-study/web-react --filter @ai-study/web-vue --filter @ai-study/server dev",
    "dev:desktop": "pnpm --filter @ai-study/desktop dev",
    "build":       "pnpm -r --filter @ai-study/shared --filter @ai-study/web-vue-nuxt --filter @ai-study/web-react --filter @ai-study/web-vue --filter @ai-study/server build",
    "build:ssr":   "pnpm --filter @ai-study/web-vue-nuxt build",
    "build:shared":"pnpm --filter @ai-study/shared build",
    "build:desktop":"pnpm --filter @ai-study/desktop build",
    "typecheck":  "pnpm -r typecheck",
    "lint":       "eslint \"{apps,packages}/**/*.{ts,tsx,vue}\"",
    "format":     "prettier --write \"{apps,packages}/**/*.{ts,tsx,vue,md,json}\""
  }
}
```

> ⚠️ `dev` 默认脚本只启动 **SSR 主学习端 + BFF**（:3000 + :3001），对照端用 `dev:react` / `dev:vue` 按需启动。需要 4 端齐开再用 `dev:all`。

---

## apps/web-vue-nuxt（Nuxt 3 SSR）架构设计（Phase 9 · 主学习端）

### 目录结构

```
apps/web-vue-nuxt/
├── package.json          # name: "@ai-study/web-vue-nuxt"
├── nuxt.config.ts        # modules(@pinia/nuxt, @nuxt/image, @nuxtjs/tailwindcss) + alias + tsconfig
├── tsconfig.json         # extends 根 tsconfig.base.json，references 子项目
├── app.vue               # 根组件（<NuxtLayout> + <NuxtPage />）
├── layouts/
│   └── default.vue       # 移动端全屏布局：顶部标题栏 + 内容区 + 底部 Tab
├── pages/                # ⭐ 文件系统约定路由
│   ├── index.vue         # /  首页（学习模块入口）
│   ├── m1.vue            # /m1
│   ├── m2.vue            # /m2
│   ├── m3.vue            # /m3
│   ├── m4.vue            # /m4
│   ├── m5.vue            # /m5
│   ├── m6.vue            # /m6
│   └── m7.vue            # /m7
├── components/           # 自动导入
│   ├── TabBar.vue
│   ├── ModuleCard.vue
│   ├── InterviewCard.vue
│   └── message/
├── composables/          # 自动导入（=React Hooks）
│   ├── useChat.ts
│   ├── useStreaming.ts
│   └── useConversation.ts
├── stores/               # Pinia（@pinia/nuxt）
│   └── chat.ts
├── middleware/           # 路由守卫 / SSR 鉴权
│   └── auth.ts
├── plugins/              # Nuxt 插件（仅客户端 web-vitals.client.ts 等）
│   └── web-vitals.client.ts
├── server/               # ⭐ Nitro 内置 HTTP Server（/api/*）
│   ├── api/
│   │   ├── chat.post.ts          # 非流式聊天 → 转发 BFF :3001
│   │   ├── chat/
│   │   │   └── stream.get.ts     # SSE 流式聊天
│   │   ├── documents/
│   │   │   ├── index.get.ts
│   │   │   └── upload.post.ts
│   │   ├── tools/
│   │   │   └── execute.post.ts   # Function Calling 执行（SSR 安全，工具参数不进浏览器）
│   │   └── agent/
│   │       └── run.post.ts       # Agent 执行循环
│   └── middleware.ts             # Nitro 层 CORS / Logger（BFF 在同一台时可直接关 CORS）
├── public/
│   └── favicon.ico
└── .env.example           # NUXT_PUBLIC_API_BASE=http://localhost:3001 等
```

### SSR 请求流（C 端生产模式）

```
   用户浏览器（手机）
        │
        ▼ HTTP GET http://<domain>:3000/m4
 apps/web-vue-nuxt  (Nuxt 3, :3000)
   ├─ Node SSR 阶段：
   │    ├─ useAsyncData('chat_history', ()=>$fetch('/api/chat/history'))
   │    │                              ▲ Nitro 内部直接调 /server/api/*（不走网络）
   │    │                                  │
   │    │                                  ▼ 内部转发 http://127.0.0.1:3001/api/...
   │    │                            apps/server (Express BFF, :3001)
   │    │                                  │
   │    │                                  ▼ 调真实 AI Provider / SQLite
   │    └─ 渲染完整 HTML（含历史消息列表）+ <script> 序列化 payload
   │
   ├─ 返回 HTML + JS 给浏览器
   │
   ▼
 客户端 Hydration：
   - Nuxt 把 payload 注入，和 SSR 渲染结果核对（mismatch = console 报错）
   - 用户点击发送 → 浏览器 fetch('/api/chat/stream') → Nitro → BFF → SSE 返回 → 打字机渲染
```

> 💡 关键点：工具调用 / API Key 等敏感逻辑 **全部进 Nitro + BFF 的服务端执行**，前端只拿 `delta` 和最终结果。C 端不会泄露 API Schema 或第三方工具地址。

### 关键技术选型（Nuxt 生态）

| 用途 | 选择 | 说明 |
|---|---|---|
| 路由 | 约定路由 `pages/` | 手写路由表 0 成本，动态路由 `[id].vue` |
| 数据预取 | `useFetch` / `useAsyncData` + `$fetch` | 自动去重、自动 SSR/CSR 双端一致、自动 cache key |
| 状态管理 | `@pinia/nuxt` + `@pinia-plugin-persistedstate/nuxt`（cookie storage） | localStorage 持久化在 SSR 阶段会 Hydration 报错，必须用 Cookie |
| Tailwind | `@nuxtjs/tailwindcss` v6+ | 零配置开箱，自动扫 `.vue` 内容 |
| SEO | `@vueuse/head`（内置 useSeoMeta / useServerSeoMeta） | 类型安全的 `<meta>`，OG 图/标题 动态变 |
| 内置 HTTP | Nitro `/server/api/*` | 替代 BFF 的边缘功能，内部转发到 apps/server:3001 |
| 图片优化 | `@nuxt/image` | `<NuxtImg>` 自动格式、懒加载、尺寸适配 |
| 部署预设 | `NITRO_PRESET=node-server` / vercel / cloudflare | pnpm build 一次，多种部署 |
| 可观测性 | `@nuxtjs/web-vitals` | LCP/CLS/INP 上报到 BFF |

---

## apps/generator（AI 组件生成器 · 产品主线 ⭐）架构设计（Phase 10）

> 🚀 **产品定位**：AI 组件生成器是项目的**产品主线**，7 个 AI 模块的技术集大成毕业项目。用户输入自然语言需求 → Agent 多轮细化 → RAG 检索组件库源码 → LangChain 生成 Vue/React 组件代码 → 沙箱实时预览 → 迭代/下载。
>
> ⚠️ **启动条件**：Phase 9（Nuxt SSR 7 模块教学落地）完成后启动。apps/generator 复用 apps/web-vue-nuxt 的 Nuxt 3 经验 + apps/server 的 LangChain 编排层，但**独立应用、独立端口（3002）、独立路由**。

### 目录结构

```
apps/generator/
├── package.json               # name: "@ai-study/generator"；依赖 nuxt@3、@pinia/nuxt、@nuxtjs/tailwindcss、@guolao/vue-monaco-editor、jszip、file-saver
├── nuxt.config.ts             # port=3002、alias 指向 @ai-study/shared、modules 注册 Pinia/Tailwind/Monaco
├── tsconfig.json              # extends ../../tsconfig.base.json
├── app.vue                    # 根组件
├── layouts/
│   └── default.vue            # 三栏布局壳（对话区 | 代码编辑器 | 预览区），375px 下变为 Tab 切换
├── pages/
│   ├── index.vue              # 生成器主页（需求输入 + Agent 对话 + 代码流式输出）
│   ├── history.vue            # 历史生成组件列表（Pinia 多会话 + 搜索 + 标签筛选）
│   └── [id].vue               # 单个生成组件详情（代码 + 预览 + 文档 + 测试 + 下载）
├── components/
│   ├── RequirementInput.vue   # 需求输入区（支持语音输入 / 上传设计稿截图）
│   ├── AgentDialog.vue        # Agent 对话区（复用 Chat UI 的 MessageBubble + 流式打字机）
│   ├── CodeEditor.vue         # Monaco Editor 封装（Vue SFC / React TSX 语法 + Diff 视图 + 只读/编辑切换）
│   ├── SandboxPreview.vue     # iframe 沙箱预览（sandbox="allow-scripts" + 实时热更新 + 预览设备切换 375px/768px/1024px）
│   ├── PropsDocPanel.vue      # 自动生成的 Props/Emits/Slots 文档面板
│   ├── TestPanel.vue          # 自动生成的测试用例 + 运行结果
│   ├── DownloadBar.vue        # 下载操作栏（ZIP 打包 / 复制代码 / 导出 Gist / 复制到剪贴板）
│   └── ComponentCard.vue      # 历史组件卡片（缩略图 + 标签 + 状态）
├── composables/
│   ├── useGenerator.ts        # 生成器核心：吃 BFF streamEvents → 代码增量更新 + 预览刷新 + Agent 状态管理
│   ├── useCodeEditor.ts       # Monaco 生命周期 + 内容双向绑定 + diff 视图 + 375px 只读模式
│   ├── useSandbox.ts          # iframe 沙箱管理（编译触发 + 热更新 + 设备尺寸切换 + 错误捕获）
│   └── useComponentHistory.ts # Pinia 多会话历史 + 草稿自动保存 + 标签管理
├── stores/
│   └── generator.ts           # 生成器全局状态（当前会话 / 代码内容 / 预览状态 / Agent 步骤 / 历史列表）
├── server/api/                # Nitro 透明转发层（→ BFF :3001，不做 AI 逻辑）
│   ├── generator/
│   │   ├── run.post.ts        # 转发 → BFF /api/generator/run（SSE streamEvents）
│   │   ├── preview.post.ts    # 转发 → BFF /api/generator/preview（触发沙箱编译）
│   │   ├── download.get.ts    # 转发 → BFF /api/generator/download（ZIP 流）
│   │   └── history.get.ts     # 转发 → BFF /api/generator/history
│   └── healthz.get.ts
└── assets/
    └── prompts/               # 前端可见的 Prompt 模板片段（非敏感，仅展示用；真正的 System Prompt 在 BFF）
```

### 请求流（生成器 = 前端 → Nitro 转发 → BFF LangGraph 编排 → AI Provider）

```
apps/generator (Nuxt SSR, :3002)
     │
     ▼  /api/generator/run (POST SSE)  /api/generator/preview  /api/generator/download  /api/generator/history
 Nitro server/api/generator/* (透明转发层，不做 AI 逻辑)
     │
     ▼
 apps/server (Express, :3001)
     │  ├─ routes/generator.ts
     │  └─ services/generator/
     │       ├─ agent.ts          ← LangGraph StateGraph 5 节点（clarify → retrieve → generate → preview → iterate）
     │       ├─ codegen.ts        ← LangChain LCEL：Prompt 模板（资深前端架构师角色 + 组件规范约束）+ ChatOpenAI + output parser
     │       ├─ rag.ts            ← RAG over 组件库源码（复用 services/rag/ 的 VectorStore，额外灌入 Element Plus / Naive UI 组件代码）
     │       ├─ tools/
     │       │    ├─ create_file.tool.ts      ← 在沙箱临时目录创建 .vue/.tsx 文件
     │       │    ├─ run_preview.tool.ts      ← 触发沙箱编译（esbuild 浏览器端 / Vite dev BFF 端）→ 返回预览 URL
     │       │    ├─ generate_props.tool.ts   ← @vue/compiler-sfc / @babel/parser 解析 AST → 生成 Props/Emits/Slots 文档
     │       │    ├─ generate_tests.tool.ts   ← 生成 Vitest 测试用例（基于 Props 边界值 + 交互场景）
     │       │    └─ validate_code.tool.ts    ← ESLint + TypeScript 类型检查（AST 级别，比正则准）
     │       └─ sandbox.ts         ← 沙箱管理（临时目录 + 编译进程隔离 + 预览 URL 生成 + 超时清理）
     ▼
  AI Provider (LangChain ChatOpenAI / @langchain/openai)
```

### BFF 生成器专用路由

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/generator/run` | 启动生成器 Agent（LangGraph streamEvents v2）→ SSE 输出：需求细化问题 / 检索到的参考组件 / 生成的代码 / 预览 URL / 验证结果 |
| POST | `/api/generator/preview` | 触发沙箱编译 → 返回预览 URL（iframe src） |
| GET | `/api/generator/download` | ZIP 打包下载（组件 + 文档 + 测试 + package.json） |
| GET | `/api/generator/history` | 用户历史生成组件列表（checkpointer 按 thread_id 拉取） |
| GET | `/api/generator/history/:id` | 单个生成组件详情（代码 + Agent 步骤回放 + 文档 + 测试） |

### LangGraph 生成器 Agent 状态图

```
                    ┌─────────────────────────────────────────────────┐
                    │           GeneratorAgent StateGraph              │
                    │                                                 │
  用户输入需求 ───→  clarify（需求细化）──→  retrieve（RAG 检索组件库源码）
                    │       │                        │                 │
                    │  需要追问？                   topK 命中            │
                    │       │                        │                 │
                    │  是←──┘    否─────────────────→│                 │
                    │                                     ▼             │
                    │                              generate（LCEL 生成代码）
                    │                                     │             │
                    │                                     ▼             │
                    │                              preview（FC: create_file → run_preview）
                    │                                     │             │
                    │                                     ▼             │
                    │                              validate（FC: validate_code + generate_props + generate_tests）
                    │                                     │             │
                    │                              ┌──────┴──────┐      │
                    │                              │  用户满意？  │      │
                    │                              └──────┬──────┘      │
                    │                                  是 │ 否           │
                    │                                     │ │           │
                    │                              answer  iterate←────┘
                    │                                 │
                    └─────────────────────────────────┘
                                                      ▼
                                              返回最终组件 + 文档 + 测试 + 下载链接
```

### 关键 DTO（@ai-study/shared 新增）

```typescript
// packages/shared/src/types/generator.ts
export interface ComponentSpec {
  framework: 'vue' | 'react';
  uiLibrary?: 'element-plus' | 'naive-ui' | 'shadcn' | 'none';
  description: string;               // 用户需求描述
  propsRequirements?: string[];      // Agent 细化后的 Props 需求
  emitRequirements?: string[];       // Emits 需求
  slotRequirements?: string[];       // Slots 需求
  typescript: boolean;
}

export interface GeneratedComponent {
  id: string;
  spec: ComponentSpec;
  code: string;                      // 生成的组件代码（SFC 或 TSX）
  language: 'vue' | 'tsx';
  previewUrl?: string;               // 沙箱预览 URL
  propsDoc?: PropDoc[];
  testCode?: string;                 // 生成的测试代码
  validationIssues?: ValidationIssue[];
  status: 'generating' | 'previewing' | 'validating' | 'done' | 'error';
}

export interface PropDoc {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  description: string;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  line: number;
  message: string;
  rule: string;
}

export interface GeneratorTimelineStep extends AgentTimelineStep {
  // 复用 AgentTimelineStep + 生成器专属字段
  codeDelta?: string;                // 本步骤新增的代码片段（流式增量）
  previewUrl?: string;               // 本步骤产出的预览 URL
  retrievedComponents?: CitationFragment[];  // RAG 检索到的参考组件
}
```

### C 端体验必查（生成器专属，对照 design.md 7 大类）

| 大类 | 生成器验收项 |
|---|---|
| 首屏性能 | 375px + 3G 下生成器首页 FCP<1.5s（Monaco 懒加载，首屏只渲染对话区）；Monaco Editor 用动态 import + loading 骨架屏 |
| 交互三态 | 生成按钮三态（idle / generating + spinner / done）；Agent 细化追问时有「跳过追问」按钮；代码编辑器有「编辑 / 只读 / Diff」三态切换 |
| 输入体验 | 需求输入支持回车发送；生成中可 AbortController 取消；草稿自动保存；支持上传设计稿截图（多模态预留） |
| 安全 | iframe sandbox="allow-scripts"（禁 allow-same-origin）；生成的代码在沙箱里执行，不能访问父页面 Cookie/DOM；BFF 侧 create_file 工具只写临时目录，不碰项目源码 |
| 移动端 | 375px 下三栏变 Tab 切换（对话 | 代码 | 预览）；Monaco 只读模式（关小地图 + 缩小字体）；预览默认 375px 设备框 |
| 长列表 | 历史组件列表虚拟滚动（≥20 个组件）；代码编辑器长代码折叠（>500 行自动折叠 import / template） |
| a11y | Monaco 编辑器加 aria-label；预览 iframe 加 title；Tab 键顺序：需求输入 → 生成 → 代码 → 预览 → 下载 |

---

## apps/desktop（Electron 方案 A 预留 · 🔒 当前不开发）架构设计

> 🔒 **预留声明**：本章节只记录架构设计，当前阶段**不创建目录、不安装依赖、不写入代码**。触发启动条件：Phase 9 模块 12 的 7 个 AI 学习模块在 Nuxt SSR 端全部落地完成。
>
> 📌 **采用方案 A（最通用、零分叉 UI）**：Electron = 桌面外壳（Node 主进程）+ preload 安全桥 + 「直接复用 Nuxt/Vue 页面」。不做方案 C（独立 electron-vite 渲染层），避免 UI 代码分叉。

### 目录结构（预留，不创建）

```
apps/desktop/
├── package.json              # name: "@ai-study/desktop"；private: true；type: module
│   │                         # 依赖：electron@latest、electron-builder、electron-updater、electron-rebuild（better-sqlite3 需要）
│   │                         # devDependencies：typescript、tsx、@types/node
│   │                         # workspace deps：@ai-study/shared、@ai-study/server（内置 BFF 模式复用）
│   ├── scripts.postinstall  # electron-rebuild -f -w better-sqlite3（预留，better-sqlite3 ABI 重编）
│   └── scripts: { "dev": "tsx electron/main.ts dev" , "build": "pnpm build:renderer && electron-builder --publish never" }
├── electron.vite.config.ts  # （预留）主进程/preload 打包（ESM→CJS 互操作，可不用直接 tsx 跑）
├── electron/
│   ├── main.ts              # 🔒 主入口：app.whenReady() → createWindow() → 注册 IPC / Tray / Menu / globalShortcut
│   │                        #    开发期：win.loadURL('http://localhost:3000')
│   │                        #    生产期：win.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
│   │                        #    内置 BFF 模式（方案 B 预留）：启动 apps/server Express 实例（127.0.0.1:随机端口），退出时 server.close()
│   └── preload.ts           # 🔒 安全桥：contextBridge.exposeInMainWorld('electronAPI', {...})
│                            #    只暴露白名单：selectFile / saveFile / showMessageBox / writeUserData / readUserData / onUpdateDownloaded ...
├── renderer/                # （预留）生产期 Nuxt generate 的纯静态产物，由 build:renderer 脚本从 apps/web-vue-nuxt/.output/public 复制过来
├── electron-builder.yml     # 🔒 打包配置：appId / productName / asar: true / nsis / dmg / AppImage / fileAssociations / publish provider
├── build/                   # 图标资源：icon.ico（Win）、icon.png（Linux tray）、icon.icns（macOS）
├── resources/               # license.rtf、安装界面欢迎图（NSIS 自定义）
└── tsconfig.json            # extends ../../tsconfig.base.json；include electron/**/*.ts；compilerOptions.types: node/electron
```

### 请求流（两种模式 · 按需切换）

#### 模式 1：方案 A 在线版（默认，当前记录的方案）= 最轻量
```
        ┌──────────────────────────── Electron App ────────────────────────────┐
        │                                                                      │
 用户点击 ▼                                                                    │
   ┌────┴────────────┐       HTTP / SSE           HTTP / SSE          LLM API │
   │ 渲染进程（Chromium │◀─────── :3000 ───────▶ apps/web-vue-nuxt :3000 ──┐   │
   │  跑 Nuxt 页面）  │                                     │              │   │
   └────────┬─────────┘              preload exposeInMainWorld             │   │
            │ IPC invoke ─────────────┐                                     │   │
            ▼                         ▼                                     ▼   │
   contextBridge.                  electron/          IPC → fetch → apps/server   │
   electronAPI.selectFile()         main.ts               (本地对话框/托盘) :3001 │
   (只允许桌面能力，                     │
   不暴露 ipcRenderer)                └─▶ 系统对话框 / Tray / 原生通知 / 快捷键
        └──────────────────────────────────────────────────────────────────────┘
```
- 适合：联网使用、BFF 部署在云端/本机、UI 想和浏览器版 100% 一致的场景
- 优点：Electron 代码只有几百行，零 UI 维护成本；HMR 开发体验 = 直接刷新 Nuxt

#### 模式 2：方案 B 内置 BFF 离线版（方案 A 的升级路径，预留）
```
        ┌──────────────────────────── Electron App ─────────────────────────────┐
        │                                                                        │
 用户点击 ▼                                                                      │
   ┌────┴────────────┐                                                           │
   │ 渲染进程（Chromium│◀── loadFile 加载 Nuxt 静态产物（本地文件，不依赖端口）──┐ │
   │  跑 Nuxt 页面）  │                                                     │   │ │
   └────────┬─────────┘                                                     │   │ │
            │ HTTP 127.0.0.1:<随机端口>/api/*                                │   │ │
            ▼                                                               │   │ │
   ┌──────────────────────────────────────────┐                              │   │ │
   │ Electron 主进程内直接启动的 Express BFF    │                              │   │ │
   │ ( apps/server 的 TS 源码，用 tsx/打包跑 ) │ ← 100% 业务逻辑复用现有 server   │ │
   │ 端口 127.0.0.1:49152+（随机，不对外）      │                              │   │ │
   └────────┬─────────────────────────────────┘                              │   │ │
            │ better-sqlite3 读本地 DB，不联网                                │   │ │
            ▼                                                                ▼   │ │
   app.getPath('userData')/ai-study/rag.db      preload → IPC → 主进程系统对话框   │ │
        └────────────────────────────────────────────────────────────────────────┘
```
- 适合：完全离线、单机 RAG、隐私敏感、用户本地知识库的纯桌面独立版本
- 优点：零外网依赖；可以直接读用户本地任意文件路径、读写用户数据目录、安装包双击即用
- 升级成本：加一个「主进程 createServer()」步骤，不改动任何业务代码

### 关键技术选型（Electron 生态 · 预留）

| 用途 | 选择 | 说明 |
|---|---|---|
| 主进程入口 | `electron` + TypeScript + `tsx` 开发期直接跑 | 不用 electron-vite 也能开发，后续需要打包再引入 electron-vite |
| 安全三件套 | `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` | **硬规则必须开**，见 requirements.md 13.2 |
| 安全桥接 | `contextBridge.exposeInMainWorld('electronAPI', {...})` | 只暴露有限白名单，不把 ipcRenderer/fs 整体丢给前端 |
| 打包工具 | `electron-builder`（不是 electron-forge） | 生态最成熟，多平台、NSIS 自定义安装、增量更新、签名一体 |
| 自动更新 | `electron-updater`（electron-builder 内置） | blockmap 增量差量（通常几十 KB），不用全量重装 |
| 原生依赖 rebuild | `electron-rebuild`（postinstall 钩子） | better-sqlite3 ABI 匹配 Electron 内置 Node 版本 |
| 内置 BFF（方案 B） | 直接 `import { createApp } from '@ai-study/server/src/app'` | 100% 复用 BFF 业务代码，端口 `server.listen(0)` 随机 |
| 本地数据库路径 | `app.getPath('userData') + '/ai-study/'` | Electron 官方用户数据目录，跨平台一致，卸载时按需保留 |
| 跨端产物 | Windows：NSIS `.exe`；macOS：`.dmg`（arm64 + x64 / universal）；Linux：`.AppImage` 单文件 | 一次 `pnpm build:desktop` 出当前平台产物，跨平台用 CI 矩阵 |

---

## 🎯 C 端体验必查清单 7 大类（AI 产品上线验收 · 强制执行）

> 说明：本清单是**所有端（Nuxt SSR / React SPA / Vue SPA / Electron 预留）的 UI/交互/安全/性能类任务完成后，必须手动勾选的验收标准**。7 大类不达标不能算「知识点完成」。默认开发视口 = **移动端 375px（iPhone 12/13/14 逻辑宽度）**，桌面端仅做适配。

| 大类 | 编号 | 验收项（AI 产品 C 端特有） | 通过标准 / 量化指标 |
|---|---|---|---|
| **① 首屏 & 性能指标（C 端生命线）** | 1.1 | Lighthouse 移动端 375px + 3G Fast 跑 10 次取中位数 | **FCP < 1.2s / LCP < 2.5s / CLS < 0.1 / INP < 200ms / TBT < 200ms**；不达标禁止上线合并 |
| | 1.2 | 单页 JS Bundle（gzip）大小 | `< 150KB`；超过必须做代码分割（definePageMeta({ middleware: ... }) + 路由懒加载） |
| | 1.3 | SSR Hydration Mismatch 5 场景排查 | 控制台搜索「Hydration」输出 0 条红色警告；随机刷新 10 次无内容抖动 |
| | 1.4 | 图片优化率（RAG 知识库插图 / 首页模块图） | 所有 `<img>` 用 `<NuxtImg>` / 等价方案，format=avif/webp，懒加载开启，sizes=响应式尺寸 |
| **② 交互反馈三态（一等公民）** | 2.1 | 所有可点击元素（按钮/卡片/链接/icon）三态齐全 | 375px 下点一下：有 `:active` 点击态高亮；禁用态灰度 + `cursor: not-allowed`；loading 态 spinner 或骨架屏，不允许「点了没反应」 |
| | 2.2 | 错误提示用户可读（AI 场景分层） | 401（密钥错/未登录）/ 429（限流）/ 500（模型维护）/ 断网 → 各有一条中文 Toast，不统一显示「请求失败」；Toast 375px 顶部居中，4s 自动消失 |
| | 2.3 | 空状态引导（AI 常用场景） | 无会话 / 无知识库文档 / 流式无回答 / 搜索无结果 → 均有插图 + 一行说明 + 快捷按钮（「新建会话」「上传第一份 PDF」） |
| | 2.4 | 长按态（移动端交互） | 消息气泡 / Citation 来源卡片 / Agent 步骤卡片，长按弹出 ActionSheet（复制/重生成/删除/转发），长按反馈 = 轻微触觉震动（navigator.vibrate） |
| **③ 聊天/表单输入体验（AI 产品核心）** | 3.1 | iOS 键盘避让（iOS Safari 专属坑） | 输入框键盘弹起时，输入框不被键盘遮挡，最新消息仍可见；用 `visualViewport.resize` + 节流实现 |
| | 3.2 | 发送交互细节 | 软键盘「Return（发送）」键 = 点击发送按钮；发送中按钮禁用 + 显示 loading + 右边出现「■ 停止」按钮（AbortController）可手动取消 |
| | 3.3 | 草稿自动保存 | 输入了一半刷新页面 / 切会话 / 切后台，草稿仍在（`useCookie` 或 localStorage 按 sessionId 存）；超过 200 字 3s 自动保存一次 |
| | 3.4 | 粘贴体验（AI 知识库） | 粘贴板有图片/文件 → 输入框上方显示缩略图预览 + 叉号移除 + 一键上传；单文件 > 50MB 提示「请用分片上传」 |
| **④ 安全（C 端上线底线 · AI 专属风险）** | 4.1 | 前端产物 API Key 零出现 | 打包后 dist/.output 所有 JS 用正则搜索 `sk-[A-Za-z0-9]{20,}` → 结果 = 0；前端只能请求 BFF/Nitro，API Key 只在 Node 环境 |
| | 4.2 | Markdown 渲染 DOMPurify 全覆盖 | 所有 AI 生成回答的 Markdown 渲染前强制 `DOMPurify.sanitize()`；白名单不允许 `<script>`/`<iframe>`/`onerror`/`javascript:`；AI 产品 XSS = P0 |
| | 4.3 | CSRF / Cookie 安全 | 会话 Cookie SameSite=Lax + HttpOnly=true + Secure=https；BFF 所有写操作（上传/删除/重发）校验 CSRF Token 双重防跨站 |
| | 4.4 | Function Calling 工具执行位置 | 工具 Schema + 实际执行 100% 在 Nitro server route 或 BFF；前端只传「问题 + 白名单工具名」，绝对不在前端 `axios.post(工具接口)` |
| **⑤ 移动端细节（一眼像真 App）** | 5.1 | 安全区适配（iPhone 刘海 + 底部横条） | viewport meta 有 `viewport-fit=cover`；布局壳：顶部 `padding-top: env(safe-area-inset-top)`；输入栏/底部 TabBar `padding-bottom: env(safe-area-inset-bottom)`；横屏 4 边都不出界 |
| | 5.2 | 1px 细线（移动端高分屏通病） | 分割线 / 消息气泡边框 1px 用 `transform: scaleY(0.5)` + `transform-origin` 实现（或 border 1px + `@media (-webkit-min-device-pixel-ratio: 2)`），在 iPhone 上看不粗 |
| | 5.3 | 防止误触 & 点击感 | `-webkit-tap-highlight-color: transparent` 关闭 iOS 蓝色点击高亮；可点击区域 ≥ 44×44px（WCAG 标准）；`user-select: none` 给图标按钮避免长按弹「复制」；禁止双指缩放 + 双击放大 |
| | 5.4 | 横屏 / 折叠屏适配 | 旋转屏幕或展开折叠屏 → 聊天列表自动滚动到底 + 输入栏重新定位；不出现水平滚动条；Tailwind `sm:`/`md:` 断点平滑过渡 |
| **⑥ 长列表 & 资源优化（AI 大列表场景）** | 6.1 | 长聊天列表虚拟滚动 | 消息 ≥50 条必须启用虚拟滚动（`@tanstack/vue-virtual` 或等价实现）；DOM 节点数 ≤ 20；INP < 200ms 维持 |
| | 6.2 | 知识库文档列表无限加载 | IntersectionObserver 监听「加载更多触发器」；前 20 条 SSR 预取，往下每 20 条一页；失败显示「重试」按钮，不卡 Loading |
| | 6.3 | 骨架屏 shimmer（AI 常见 loading） | 流式还没第一个字 / 列表还没回来 / 图片还没加载 → 统一使用渐变骨架屏 shimmer，不使用转圈 spinner；骨架屏尺寸 = 最终占位尺寸，避免 CLS > 0.1 |
| **⑦ 可访问性（a11y 基础 · C 端合规）** | 7.1 | 语义化 HTML | 聊天区域用 `<main>`，导航用 `<nav>`，消息气泡用 `<article role="listitem">`，发送按钮用 `<button>` 不用 `<div onClick>` |
| | 7.2 | 图标按钮可访问 | 纯图标按钮（发送 / 停止 / 附件）有 `aria-label="发送消息"` / `title`；颜色对比度 ≥ 4.5:1（WCAG AA），用浏览器 DevTools Color Picker 验证 |
| | 7.3 | 键盘 / TalkBack 完整走查 | Tab 键顺序：顶部标题 → 消息列表（上下方向键读每条）→ 输入框 → 发送按钮 / 附件；TalkBack（Android）/ VoiceOver（iOS）按顺序播报，不出现「未标注的按钮」 |

---

## apps/server BFF 架构设计（Phase 7）

### 请求流（加入 LangChain 编排层 · m5/m6/m7 核心实现）

```
Web (React/Vue)  /  Nitro (Nuxt SSR 转发层)
     │
     ▼  /api/chat / /api/chat/stream / /api/tools/* / /api/rag/* / /api/agent/*
 apps/server (Express, :3001)
     │  ├─ cors middleware
     │  ├─ logger/trace-id middleware
     │  ├─ auth middleware（API Key 白名单校验 / 可选）
     │  ├─ routes/ai.ts            ← 模块 1/2：非流式 + SSE 流式聊天
     │  ├─ routes/tools.ts         ← 模块 5：工具注册列表 / 工具执行（LangChain StructuredTool）
     │  ├─ routes/rag.ts           ← 模块 6：文档上传 / 列表 / 检索 / 问答（LangChain Loader+Splitter+VectorStore）
     │  ├─ routes/agent.ts         ← 模块 7：Agent 启动 / 暂停 / 回滚 / 继续（LangGraph StateGraph + Checkpointer）
     │  │
     │  └─ services/
     │       ├─ chain.ts           ← LangChain LCEL：base chat model + prompt template + output parser
     │       ├─ tools/             ← m5：StructuredTool 注册中心（calc/time/weather/rag_retriever/...）
     │       │    ├─ calculator.tool.ts
     │       │    ├─ now.tool.ts
     │       │    └─ rag_retriever.tool.ts（→ services/vectorstore）
     │       ├─ rag/               ← m6：LangChain 文档流水线
     │       │    ├─ loaders.ts    ← PDF/Markdown/Text → Document
     │       │    ├─ splitter.ts   ← RecursiveCharacterTextSplitter(chunkSize=256, overlap=32)
     │       │    ├─ embeddings.ts ← OpenAIEmbeddings / DashScopeEmbeddings（接口统一）
     │       │    └─ vectorstore.ts ← MemoryVectorStore → SQLite-vec/Qdrant（一行替换）
     │       └─ agent/             ← m7：LangGraph 状态图
     │            ├─ state.ts      ← AgentState = messages + step_count + tool_results[]
     │            ├─ graph.ts      ← StateGraph(AgentState)：nodes=think/call_tool/observe/answer + 条件边
     │            └─ checkpointer.ts ← MemorySaver / SQLiteSaver（langgraph checkpoint）
     ▼
  AI Provider (OpenAI / Azure / DashScope / DeepSeek ← @langchain/openai + 对应包，只改 1 行)
```

> **分层说明（AI 编排层绝不泄露到前端，C 端安全第一）**：
> - 前端 / Nitro 路由：只看到「用户问题 + 工具白名单 ID 列表 + 会话 ID」，**看不到** StructuredTool 里的 Zod Schema、工具执行代码、LLM 原始 system prompt
> - BFF services/ 层：LangChain 编排层（本架构新增的核心），承担 99% 的 AI 逻辑；对外暴露统一 SSE `stream_events`（@langchain/core 的 stream() / streamEvents() 输出），前端 useStreaming 粘包规则统一处理
> - shared 类型：LangChain 内部类型 **不直接透出到前端**，只透出 `SSEChunk`、`CitationFragment`、`AgentTimelineStep` 等前端渲染用的 DTO

### 服务端路由（追加 m5/m6/m7 LangChain 专用路由）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/healthz` | 健康检查，返回 { ok: true } |
| POST | `/api/chat` | 非流式聊天接口（模块 1/2）→ BFF 调 LangChain `ChatOpenAI.invoke()` |
| POST/GET | `/api/chat/stream` | SSE 流式聊天接口 → BFF 调 LangChain `ChatOpenAI.stream()`，SSE chunk=delta token |
| GET | `/api/conversation/:id` | 获取会话历史（BFF 维护 / LangGraph Checkpointer 持久化读） |
| DELETE | `/api/conversation/:id` | 删除会话 |
| **GET** | **`/api/tools/list`** | **模块 5（FC）**：返回「工具白名单 id+name+display_icon 」→ 前端只用来渲染用户可选工具按钮，**不返回 Zod Schema** |
| **POST** | **`/api/tools/execute`** | **模块 5（FC）**：接收 { question, conversationId, allowedToolIds: string[] } → BFF 内部拿 StructuredTool 调 LangChain `createToolCallingAgent` / `createStructuredChatAgent`，SSE 输出中间态 |
| **POST** | **`/api/rag/documents`** | **模块 6（RAG）**：multipart 上传 → LangChain Loader → Splitter → addDocuments 到 VectorStore，SSE 返回 `(chunk_uploaded / chunk_total) %` 进度 |
| **GET** | **`/api/rag/documents`** | 文档列表（元数据：name/pageCount/chunkCount/status） |
| **DELETE** | **`/api/rag/documents/:id`** | 删除文档 + VectorStore 里的 chunk |
| **POST** | **`/api/rag/qa`** | RAG 问答 → LangChain `createRetrievalChain` 回答 + citations |
| **POST** | **`/api/agent/run`** | **模块 7（Agent）**：启动 LangGraph graph.streamEvents，SSE 输出每个 node_start/tool_start/tool_output |
| **POST** | **`/api/agent/:threadId/pause`** | Human-in-the-loop：中断当前 graph step（等用户确认） |
| **POST** | **`/api/agent/:threadId/resume`** | 从中断点继续 |
| **POST** | **`/api/agent/:threadId/rollback?step=N`** | 回滚到第 N 步（用 checkpointer.getStateHistory 切到指定 checkpoint） |

### BFF apps/server 目录结构（追加 LangChain 编排层）

```
apps/server/
├── package.json               # 新增依赖：@langchain/core, @langchain/openai, @langchain/community, @langchain/langgraph, zod, pdf-parse, better-sqlite3(可选)
├── src/
│   ├── index.ts
│   ├── routes/
│   │   ├── ai.ts              # 原有的 chat/stream
│   │   ├── tools.ts           # m5 新增
│   │   ├── rag.ts             # m6 新增
│   │   └── agent.ts           # m7 新增
│   ├── services/
│   │   ├── chain.ts           # LangChain base chain（所有模块共用的 ChatOpenAI）
│   │   ├── tools/             # m5：每个 StructuredTool 单独一个文件，services/tools/index.ts 统一注册中心
│   │   │    ├─ index.ts       # registerTools(): Record<string, StructuredTool>
│   │   │    ├─ calculator.tool.ts
│   │   │    ├─ now.tool.ts
│   │   │    └─ rag_retriever.tool.ts
│   │   ├── rag/
│   │   │    ├─ loaders.ts
│   │   │    ├─ splitter.ts
│   │   │    ├─ embeddings.ts
│   │   │    └─ vectorstore.ts # 默认 MemoryVectorStore，SQLite-vec 启用改这 1 行
│   │   └── agent/
│   │        ├─ state.ts       # interface AgentState extends BaseChannel { messages: BaseMessage[]; step: number; }
│   │        ├─ graph.ts       # StateGraph 声明式节点 + 条件边
│   │        └─ checkpointer.ts
│   └── utils/sse.ts           # LangChain stream / streamEvents → 前端 SSEChunk 转换
```

### 关键类型（@ai-study/shared 共享 · 新增 LangChain 透出的 DTO）

```typescript
// packages/shared/src/types/chat.ts（已有，LangChain 内部类型不出现在这里）
export type Role = 'system' | 'user' | 'assistant' | 'tool';
export interface ChatMessage { role: Role; content: string; tool_calls?: any[]; tool_call_id?: string; }
export interface ChatRequest { model: string; messages: ChatMessage[]; temperature?: number; stream?: boolean; }
export interface ChatResponse { id: string; content: string; usage?: { prompt_tokens: number; completion_tokens: number }; }
export interface SSEChunk { delta?: string; done: boolean; error?: string; }

// 👇 新增（m5/m6/m7 LangChain 透到前端的 DTO）
export interface ToolWhiteListItem { id: string; name: string; icon: string; displayDesc: string; }
export interface CitationFragment {
  docId: string; docName: string; page?: number; chunkIndex: number;
  snippet: string;                     // 片段原文（渲染到 CitationCard）
  score: number;                       // 相似度分（0-1）
}
export type AgentStepKind = 'think' | 'tool_call' | 'tool_output' | 'observe' | 'answer';
export interface AgentTimelineStep {
  stepNo: number;                      // 第几步（1 开始，回滚用）
  kind: AgentStepKind;                 // 渲染 5 色进度条用
  label: string;                       // 节点标题
  content?: string;                    // 思考内容 / tool 输出内容
  status: 'running' | 'done' | 'error' | 'paused';
}
export interface AgentRunState {
  threadId: string;
  currentStep: number;
  totalSteps: number;
  timeline: AgentTimelineStep[];
  answerContent?: string;
  citations?: CitationFragment[];
}
```

---

## apps/web-vue 设计（Phase 8）

### 目录结构

```
apps/web-vue/src/
├── main.ts                # 入口：createApp + Pinia + Router
├── App.vue                # 根组件
├── router/index.ts        # Vue Router 配置
├── stores/                # Pinia stores
│   └── chat.ts            # 聊天状态示例
├── composables/           # Vue composables = React Hooks
│   ├── useChat.ts         # 非流式调用
│   └── useStreaming.ts    # SSE 流式调用
├── views/                 # 页面组件
│   ├── Home.vue
│   ├── M1ApiBasics.vue
│   ├── M2Streaming.vue
│   └── M4Chat.vue
├── components/            # 子组件
│   ├── ModuleCard.vue
│   └── MessageBubble.vue
└── style.css              # Tailwind 入口
```

### 路由表

```typescript
const routes = [
  { path: '/', component: () => import('../views/Home.vue') },
  { path: '/m1', component: () => import('../views/M1ApiBasics.vue') },
  { path: '/m2', component: () => import('../views/M2Streaming.vue') },
  { path: '/m4', component: () => import('../views/M4Chat.vue') },
];
```

---

## packages/shared 设计（Phase 9）

### 导出结构

```typescript
// packages/shared/src/index.ts
export * from './types/chat';
export * from './types/rag';
export * from './types/agent';
export * from './constants/models';
export * from './constants/prompts';
export * from './utils/token';
export * from './utils/sse';
export * from './utils/id';
```

### 依赖方式

在 apps/* 中引用：
```json
// apps/web-react/package.json
"dependencies": { "@ai-study/shared": "workspace:*" }
```
```typescript
import type { ChatMessage } from '@ai-study/shared';
import { estimateTokenCount } from '@ai-study/shared';
```
