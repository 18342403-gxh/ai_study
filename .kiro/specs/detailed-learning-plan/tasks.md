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

- [ ] 9. 模块 6：RAG 前端集成 (知识点 6.1-6.8) {depends_on: [8]}
  - [ ] 9.1. 创建 src/modules/06-rag/DocumentUpload.tsx（文件上传组件：拖拽 + 进度条 + 格式校验）
  - [ ] 9.2. 创建 src/modules/06-rag/DocumentList.tsx（文档列表 + 处理状态流展示）
  - [ ] 9.3. 创建 src/modules/06-rag/useRag.ts（RAG 问答 Hook：query + document_ids + citations）
  - [ ] 9.4. 创建 src/modules/06-rag/CitationCard.tsx（引用来源卡片：编号标记 + 展开原文 + 相关度）
  - [ ] 9.5. 创建 src/modules/06-rag/RagChat.tsx + RagPage.tsx（RAG 问答界面 + 主页面组装）
  - [ ] 9.6. 追加模块 6 面试题到 src/data/interview-questions.ts
- [ ] 10. 模块 7：AI Agent 交互 (知识点 7.1-7.8) {depends_on: [9]}
  - [ ] 10.1. 创建 src/modules/07-agent/types.ts（Agent 类型定义：AgentStep、状态枚举）
  - [ ] 10.2. 创建 src/modules/07-agent/useAgent.ts（Agent 执行 Hook：Think-Act-Observe 循环 + 暂停/继续 + 中断/回退）
  - [ ] 10.3. 创建 src/modules/07-agent/ThinkingBubble.tsx + StepCard.tsx（思考过程展示 + 步骤详情卡片）
  - [ ] 10.4. 创建 src/modules/07-agent/AgentTimeline.tsx（执行时间线组件：垂直时间线 + 实时追加）
  - [ ] 10.5. 创建 src/modules/07-agent/AgentPage.tsx（Agent 主页面：输入区 + 时间线 + 用户干预 UI）
  - [ ] 10.6. 追加模块 7 面试题到 src/data/interview-questions.ts
