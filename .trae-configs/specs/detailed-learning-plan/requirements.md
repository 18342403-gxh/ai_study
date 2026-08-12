# 详细学习计划 - 需求文档

## 概述

将现有 7 个学习模块的内容细化为精确到每个小知识点的学习计划，每个知识点对应具体的代码实现，形成可逐步对照学习的结构化路径。

## 核心需求

- 每个模块拆分为细粒度的知识点（每个知识点是一个可独立学习的最小单元）
- 每个知识点有明确的：学习目标、涉及的代码文件、关键代码片段说明
- 知识点之间有清晰的依赖关系和学习顺序
- 学习者可以按顺序逐个完成，每完成一个知识点就能看到对应的代码效果

## 面试结合需求

- 每个知识点关联 1-3 道相关的前端面试题
- 面试题覆盖：原理理解类、代码实现类、场景设计类
- 面试题在学习完对应知识点后展示，用于自测和巩固
- 面试题包含参考答案要点，方便自我检验
- 面试题难度标注（初级/中级/高级），对应不同面试场景

## UI 呈现约束

- **以移动端 Web 为主要呈现形式**（视口宽度 375px - 430px）
- 所有页面和组件优先适配移动端布局
- 使用 viewport meta 标签配置移动端适配
- 交互设计考虑触摸操作（点击区域 ≥ 44px、滑动手势等）
- 字体大小、间距等遵循移动端可读性标准
- 聊天界面采用全屏对话模式（类似微信/ChatGPT 移动端）
- 导航使用底部 Tab 栏或汉堡菜单，而非桌面端侧边栏

---

## 模块 1：AI API 基础调用

### 1.1 TypeScript 类型定义
- **知识点**：定义 ChatRequest、Message、ChatResponse 等核心类型
- **对应文件**：`src/modules/01-api-basics/types.ts`
- **学习要点**：理解大模型 API 的数据结构，role 的三种类型，temperature/max_tokens 参数含义

### 1.2 环境变量配置
- **知识点**：使用 Vite 环境变量管理 API Key
- **对应文件**：`.env.local`、`vite.config.ts`
- **学习要点**：`import.meta.env` 的使用、VITE_ 前缀规则、.gitignore 安全配置

### 1.3 封装 API 调用函数
- **知识点**：使用 fetch 调用 Chat Completions API
- **对应文件**：`src/modules/01-api-basics/api.ts`
- **学习要点**：fetch 请求头设置、Authorization Bearer Token、请求体 JSON 序列化、响应解析

### 1.4 自定义 Hook - useChat
- **知识点**：封装 API 调用逻辑为 React Hook
- **对应文件**：`src/modules/01-api-basics/useChat.ts`
- **学习要点**：useState 管理 loading/error/data 状态、useCallback 缓存函数、异步状态机模式

### 1.5 Loading 状态与用户反馈
- **知识点**：请求过程中的 UI 状态展示
- **对应文件**：`src/modules/01-api-basics/ApiBasics.tsx`
- **学习要点**：条件渲染、disabled 按钮状态、loading 指示器

### 1.6 错误处理与重试
- **知识点**：处理 API 错误码（401/429/500）和网络错误
- **对应文件**：`src/modules/01-api-basics/useChat.ts`
- **学习要点**：try-catch 错误分类、HTTP 状态码判断、用户友好的错误提示

### 1.7 请求超时控制
- **知识点**：使用 AbortController 实现请求超时和手动取消
- **对应文件**：`src/modules/01-api-basics/useChat.ts`
- **学习要点**：AbortController 创建与 signal 传递、setTimeout 超时触发、组件卸载时清理

### 1.8 页面组件组装
- **知识点**：将输入框、按钮、结果展示组装为完整页面
- **对应文件**：`src/modules/01-api-basics/ApiBasics.tsx`
- **学习要点**：表单受控组件、事件处理、组件组合模式

---

## 模块 2：流式响应

### 2.1 SSE 协议理解
- **知识点**：理解 Server-Sent Events 数据格式
- **对应文件**：`src/modules/02-streaming/parseSSE.ts`
- **学习要点**：`data: ` 前缀格式、`[DONE]` 结束标记、delta 增量内容结构

### 2.2 ReadableStream 读取
- **知识点**：使用 fetch + ReadableStream 读取流式数据
- **对应文件**：`src/modules/02-streaming/useStreaming.ts`
- **学习要点**：`response.body.getReader()`、TextDecoder 解码、while 循环读取 chunk

### 2.3 SSE 数据解析器
- **知识点**：将原始 SSE 文本解析为结构化数据
- **对应文件**：`src/modules/02-streaming/parseSSE.ts`
- **学习要点**：按行分割、JSON.parse 提取 delta.content、处理不完整 chunk（粘包）

### 2.4 流式状态管理
- **知识点**：管理流式生成过程中的状态（生成中/已完成/已中断）
- **对应文件**：`src/modules/02-streaming/useStreaming.ts`
- **学习要点**：useRef 存储可变状态、状态机设计（idle/streaming/done/aborted）

### 2.5 逐字渲染与性能优化
- **知识点**：将流式数据逐步渲染到页面，避免频繁 re-render
- **对应文件**：`src/modules/02-streaming/Streaming.tsx`
- **学习要点**：requestAnimationFrame 批量更新、useRef + forceUpdate 模式、避免每个字符触发 setState

### 2.6 光标闪烁动画
- **知识点**：实现打字机光标效果
- **对应文件**：`src/modules/02-streaming/Cursor.tsx`
- **学习要点**：CSS animation（blink）、条件显示（仅生成中显示）、inline 元素定位

### 2.7 自动滚动到底部
- **知识点**：内容增长时自动滚动到最新位置
- **对应文件**：`src/modules/02-streaming/Streaming.tsx`
- **学习要点**：useRef 获取容器 DOM、scrollIntoView 或 scrollTop 设置、滚动时机控制

### 2.8 中断生成（停止按钮）
- **知识点**：用户主动中断流式生成
- **对应文件**：`src/modules/02-streaming/useStreaming.ts`
- **学习要点**：AbortController.abort() 中断 fetch、reader.cancel() 关闭流、保留已生成内容

---

## 模块 3：Prompt 工程

### 3.1 消息角色类型定义
- **知识点**：定义 system/user/assistant 三种角色的类型和用途
- **对应文件**：`src/modules/03-prompt/types.ts`
- **学习要点**：TypeScript 联合类型、每种角色在对话中的职责、消息数组的组织方式

### 3.2 System Prompt 预设模板
- **知识点**：设计多种场景的 System Prompt 模板
- **对应文件**：`src/modules/03-prompt/presets.ts`
- **学习要点**：Prompt 设计四要素（角色/范围/格式/示例）、模板字符串、预设数据结构

### 3.3 Prompt 模板切换 UI
- **知识点**：实现可切换的 Prompt 预设选择器
- **对应文件**：`src/modules/03-prompt/PromptLab.tsx`
- **学习要点**：Select/Radio 组件控制、状态联动、实时预览 Prompt 内容

### 3.4 多轮对话上下文维护
- **知识点**：维护 messages 数组实现多轮对话
- **对应文件**：`src/modules/03-prompt/useConversation.ts`
- **学习要点**：数组追加新消息、保持 system 消息在首位、assistant 回复自动加入历史

### 3.5 Token 计数器
- **知识点**：估算当前对话消耗的 Token 数量
- **对应文件**：`src/modules/03-prompt/tokenCounter.ts`
- **学习要点**：Token 估算算法（中文约 1.5 字/token，英文约 4 字符/token）、实时计数显示

### 3.6 滑动窗口策略
- **知识点**：当消息过多时裁剪早期消息
- **对应文件**：`src/modules/03-prompt/useConversation.ts`
- **学习要点**：保留最近 N 轮对话、始终保留 system 消息、Token 预算控制

### 3.7 结构化输出（JSON Mode）
- **知识点**：让模型返回 JSON 格式并前端解析展示
- **对应文件**：`src/modules/03-prompt/JsonRenderer.tsx`
- **学习要点**：response_format 参数设置、JSON.parse 安全解析、动态渲染 JSON 为卡片/表格

### 3.8 自定义 Prompt 编辑器
- **知识点**：支持用户自行编写和测试 System Prompt
- **对应文件**：`src/modules/03-prompt/PromptLab.tsx`
- **学习要点**：textarea 受控组件、localStorage 持久化用户自定义 Prompt、即时生效

---

## 模块 4：聊天界面

### 4.1 聊天状态管理 Store
- **知识点**：使用 zustand 或 Context 管理聊天全局状态
- **对应文件**：`src/modules/04-chat-ui/useChatStore.ts`
- **学习要点**：消息列表状态、当前会话 ID、多会话数据结构、状态更新方法

### 4.2 消息列表组件
- **知识点**：渲染消息列表，区分用户消息和 AI 消息
- **对应文件**：`src/modules/04-chat-ui/MessageList.tsx`
- **学习要点**：列表渲染 key 设置、条件样式（左/右对齐）、消息时间戳格式化

### 4.3 消息气泡组件
- **知识点**：设计用户和 AI 的消息气泡样式
- **对应文件**：`src/modules/04-chat-ui/MessageBubble.tsx`
- **学习要点**：CSS 气泡样式（圆角/阴影/箭头）、头像区分、不同角色不同配色

### 4.4 Markdown 渲染器
- **知识点**：将 AI 回复的 Markdown 文本渲染为富文本
- **对应文件**：`src/modules/04-chat-ui/MarkdownRenderer.tsx`
- **学习要点**：react-markdown 组件使用、remark-gfm 插件（表格/删除线）、自定义渲染组件

### 4.5 代码块组件（语法高亮 + 复制）
- **知识点**：渲染代码块并支持语法高亮和一键复制
- **对应文件**：`src/modules/04-chat-ui/CodeBlock.tsx`
- **学习要点**：rehype-highlight 或 Shiki 集成、navigator.clipboard.writeText 复制、语言标签显示

### 4.6 输入组件（多行 + 快捷键）
- **知识点**：实现移动端友好的输入框，支持多行输入和发送
- **对应文件**：`src/modules/04-chat-ui/ChatInput.tsx`
- **学习要点**：textarea 自适应高度（scrollHeight）、移动端键盘弹起适配、发送按钮触摸区域、输入法组合事件处理

### 4.7 自动滚动与滚动锁定
- **知识点**：新消息时自动滚动，用户上翻时暂停自动滚动
- **对应文件**：`src/modules/04-chat-ui/MessageList.tsx`
- **学习要点**：IntersectionObserver 检测底部可见性、useEffect 依赖消息变化、滚动行为 smooth

### 4.8 会话管理（多会话 + 持久化）
- **知识点**：支持多个聊天会话切换和 localStorage 持久化
- **对应文件**：`src/modules/04-chat-ui/useChatStore.ts`
- **学习要点**：会话 CRUD 操作、localStorage 序列化/反序列化、会话列表页（移动端全屏列表）

### 4.9 聊天页面组装
- **知识点**：将所有子组件组装为完整的移动端聊天页面
- **对应文件**：`src/modules/04-chat-ui/ChatPage.tsx`
- **学习要点**：全屏对话布局（顶部标题栏 + 消息区 + 底部输入栏）、移动端固定定位、集成流式输出

---

## 模块 5：Function Calling

### 5.1 工具 Schema 定义
- **知识点**：按 OpenAI 规范定义工具的 JSON Schema
- **对应文件**：`src/modules/05-function-calling/tools/definitions.ts`
- **学习要点**：function 对象结构（name/description/parameters）、JSON Schema 类型系统、required 字段

### 5.2 工具执行器
- **知识点**：根据模型返回的工具名和参数执行对应函数
- **对应文件**：`src/modules/05-function-calling/tools/executor.ts`
- **学习要点**：函数映射表（name → function）、参数解析、异步执行与错误捕获

### 5.3 天气工具实现（示例）
- **知识点**：实现一个具体的工具函数（模拟天气查询）
- **对应文件**：`src/modules/05-function-calling/tools/weather.ts`
- **学习要点**：工具函数签名设计、模拟数据返回、类型安全的参数处理

### 5.4 工具调用流程编排
- **知识点**：实现完整的 tool_calls 消息流转（用户→模型→工具→模型→最终回复）
- **对应文件**：`src/modules/05-function-calling/useToolChat.ts`
- **学习要点**：检测 response 中的 tool_calls 字段、构造 tool message、递归调用直到无 tool_calls

### 5.5 工具调用状态展示
- **知识点**：在 UI 中展示工具调用的中间过程
- **对应文件**：`src/modules/05-function-calling/ToolCallCard.tsx`
- **学习要点**：调用中 loading 状态、工具名称和参数展示、结果卡片渲染

### 5.6 多工具结果可视化
- **知识点**：为不同工具设计不同的结果展示卡片
- **对应文件**：`src/modules/05-function-calling/ToolCallCard.tsx`
- **学习要点**：根据工具名条件渲染不同 UI、天气卡片/计算结果/列表等多种布局

### 5.7 多步工具调用链
- **知识点**：处理模型需要多次调用工具的场景
- **对应文件**：`src/modules/05-function-calling/useToolChat.ts`
- **学习要点**：循环检测 tool_calls、调用链的消息累积、最大调用次数限制防止死循环

### 5.8 工具调用失败处理
- **知识点**：处理工具执行失败的情况
- **对应文件**：`src/modules/05-function-calling/tools/executor.ts`
- **学习要点**：try-catch 包裹工具执行、错误信息作为 tool message 返回给模型、UI 错误提示

---

## 模块 6：RAG 前端集成

### 6.1 文件上传组件
- **知识点**：实现支持拖拽的文件上传区域
- **对应文件**：`src/modules/06-rag/DocumentUpload.tsx`
- **学习要点**：input[type=file] 与 drag/drop 事件、File API 读取文件信息、文件格式校验

### 6.2 上传进度展示
- **知识点**：展示文件上传的进度条
- **对应文件**：`src/modules/06-rag/DocumentUpload.tsx`
- **学习要点**：XMLHttpRequest 的 progress 事件（或 fetch + ReadableStream）、进度百分比计算、进度条 UI

### 6.3 文档列表管理
- **知识点**：展示已上传文档的列表和状态
- **对应文件**：`src/modules/06-rag/DocumentList.tsx`
- **学习要点**：文档状态枚举（上传中/解析中/就绪/失败）、列表 CRUD、状态轮询或 WebSocket

### 6.4 文档处理状态流
- **知识点**：展示文档从上传到可用的完整处理流程
- **对应文件**：`src/modules/06-rag/DocumentList.tsx`
- **学习要点**：状态机（上传→解析→分块→向量化→就绪）、步骤指示器 UI、错误状态处理

### 6.5 RAG 问答接口调用
- **知识点**：调用后端 RAG 接口进行知识库问答
- **对应文件**：`src/modules/06-rag/useRag.ts`
- **学习要点**：请求参数（query + document_ids）、响应结构（answer + citations）、与普通聊天 API 的区别

### 6.6 引用来源卡片
- **知识点**：展示回答引用的文档片段
- **对应文件**：`src/modules/06-rag/CitationCard.tsx`
- **学习要点**：Citation 数据结构、引用编号标记 [1][2]、点击展开原文片段、相关度分数展示

### 6.7 RAG 问答界面组装
- **知识点**：将问答输入、回答展示、引用卡片组装为完整界面
- **对应文件**：`src/modules/06-rag/RagChat.tsx`
- **学习要点**：回答区域 + 引用区域布局、引用编号与卡片的联动高亮、空状态引导

### 6.8 RAG 主页面
- **知识点**：组合文档管理和问答功能为完整 RAG 页面
- **对应文件**：`src/modules/06-rag/RagPage.tsx`
- **学习要点**：Tab 或分栏布局（文档管理/问答）、全局状态串联、功能入口设计

---

## 模块 7：AI Agent 交互

### 7.1 Agent 类型定义
- **知识点**：定义 Agent 执行步骤、状态等核心类型
- **对应文件**：`src/modules/07-agent/types.ts`
- **学习要点**：AgentStep 类型（thinking/tool_call/tool_result/final_answer）、状态枚举、时间戳

### 7.2 Agent 执行 Hook
- **知识点**：封装 Agent 执行循环的逻辑
- **对应文件**：`src/modules/07-agent/useAgent.ts`
- **学习要点**：Think-Act-Observe 循环实现、步骤数组累积、流式接收每个步骤、最大步骤数限制

### 7.3 思考过程展示
- **知识点**：展示模型的推理链（Chain of Thought）
- **对应文件**：`src/modules/07-agent/ThinkingBubble.tsx`
- **学习要点**：折叠/展开交互、思考中动画（省略号闪烁）、与最终回答的视觉区分

### 7.4 执行时间线组件
- **知识点**：以时间线形式展示 Agent 的多步执行过程
- **对应文件**：`src/modules/07-agent/AgentTimeline.tsx`
- **学习要点**：垂直时间线布局、步骤节点状态样式（进行中/完成/失败）、实时追加新步骤

### 7.5 步骤卡片组件
- **知识点**：为每个执行步骤设计详情卡片
- **对应文件**：`src/modules/07-agent/StepCard.tsx`
- **学习要点**：根据 step.type 渲染不同内容、工具调用参数展示、结果折叠展示

### 7.6 用户干预机制
- **知识点**：在关键步骤暂停等待用户确认
- **对应文件**：`src/modules/07-agent/useAgent.ts`
- **学习要点**：暂停/继续状态控制、用户确认 UI（确认/修改/取消）、修改后继续执行

### 7.7 中断与回退
- **知识点**：支持用户中断 Agent 执行或回退到某一步
- **对应文件**：`src/modules/07-agent/useAgent.ts`
- **学习要点**：AbortController 中断、步骤历史保留、回退后重新执行

### 7.8 Agent 主页面
- **知识点**：组装完整的 Agent 交互页面
- **对应文件**：`src/modules/07-agent/AgentPage.tsx`
- **学习要点**：输入区 + 时间线 + 最终结果布局、全局状态管理、与聊天界面的区别

---

## 项目基础设施知识点

### 0.1 项目初始化与路由配置
- **知识点**：配置 React Router 实现模块间导航
- **对应文件**：`src/App.tsx`、`src/main.tsx`
- **学习要点**：React Router v6 路由配置、懒加载（React.lazy + Suspense）、导航菜单

### 0.2 公共组件与移动端样式
- **知识点**：搭建项目公共 UI 组件和移动端样式基础
- **对应文件**：`src/components/Layout.tsx`、`src/styles/`、`index.html`
- **学习要点**：viewport meta 配置、Tailwind CSS 移动优先设计、底部 Tab 导航、安全区域适配（safe-area-inset）

### 0.3 API 服务层封装
- **知识点**：统一封装 AI API 调用的基础服务
- **对应文件**：`src/services/ai.ts`
- **学习要点**：基础 fetch 封装、请求/响应拦截、统一错误处理、类型安全

---

## 学习顺序建议

```
0.1 → 0.2 → 0.3（项目基础）
  ↓
1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8（模块1）
  ↓
2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.8（模块2）
  ↓
3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8（模块3）
  ↓
4.1 → 4.2 → 4.3 → 4.4 → 4.5 → 4.6 → 4.7 → 4.8 → 4.9（模块4）
  ↓
5.1 → 5.2 → 5.3 → 5.4 → 5.5 → 5.6 → 5.7 → 5.8（模块5）
  ↓
6.1 → 6.2 → 6.3 → 6.4 → 6.5 → 6.6 → 6.7 → 6.8（模块6）
  ↓
7.1 → 7.2 → 7.3 → 7.4 → 7.5 → 7.6 → 7.7 → 7.8（模块7）
```

## 总计知识点数量

| 模块 | 知识点数 |
|------|---------|
| 基础设施 | 3 |
| 模块 1：AI API 基础 | 8 |
| 模块 2：流式响应 | 8 |
| 模块 3：Prompt 工程 | 8 |
| 模块 4：聊天界面 | 9 |
| 模块 5：Function Calling | 8 |
| 模块 6：RAG 集成 | 8 |
| 模块 7：AI Agent | 8 |
| Monorepo 工程化 | 7 |
| 服务端（Node BFF） | 9 |
| Vue3 网页端 | 8 |
| packages/shared | 4 |
| **总计** | **88** |

---

## 模块 8：Monorepo 工程化改造

### 8.1 Monorepo 架构理解
- **知识点**：Monorepo vs Polyrepo 的区别，适用场景
- **对应文件**：`pnpm-workspace.yaml`、根 `package.json`
- **学习要点**：工作区（workspace）概念、依赖提升（hoisting）、幽灵依赖、pnpm 的符号链接机制

### 8.2 pnpm workspace 配置
- **知识点**：使用 pnpm 工作区管理多包
- **对应文件**：`pnpm-workspace.yaml`、根 `package.json`
- **学习要点**：packages 数组路径配置、包命名约定 `@ai-study/*`、`pnpm add -w`、`pnpm --filter` 使用

### 8.3 项目目录迁移
- **知识点**：将原 React 项目迁移到 apps/web-react
- **对应文件**：目录结构变更、路径更新
- **学习要点**：迁移步骤、TSConfig path 别名更新、Vite root 配置、import 路径修正

### 8.4 根 package.json 工作区脚本
- **知识点**：编写统一脚本管理多包启动/构建
- **对应文件**：根 `package.json` scripts
- **学习要点**：`pnpm -r` 递归执行、`--parallel` 并行启动、`--filter` 精确选择、`dev` / `build` / `preview` 脚本

### 8.5 TypeScript 项目引用（Project References）
- **知识点**：配置 TS References 支持跨包类型引用
- **对应文件**：根 `tsconfig.base.json`、各包 `tsconfig.json`
- **学习要点**：`composite: true`、`references` 字段、路径别名映射、增量构建

### 8.6 ESLint 与 Prettier 根统一配置
- **知识点**：在根目录统一管理代码规范工具配置
- **对应文件**：根 `.eslintrc`、`.prettierrc`、`.editorconfig`
- **学习要点**：配置继承、各包 overrides、代码格式化统一入口

### 8.7 .gitignore 与忽略文件统一
- **知识点**：根 `.gitignore` 覆盖多包产物
- **对应文件**：根 `.gitignore`
- **学习要点**：各包的 dist / node_modules / .env 忽略模式

---

## 模块 9：Node.js BFF 服务端

### 9.1 Node 服务端项目初始化
- **知识点**：初始化 Node + TypeScript Express 项目
- **对应文件**：`apps/server/package.json`、`tsconfig.json`
- **学习要点**：`ts-node` / `tsx` 运行 TS、`@types/express` 类型、Nodemon/TSX watch 模式

### 9.2 Express 应用结构搭建
- **知识点**：搭建 Express 应用骨架（路由分层、中间件）
- **对应文件**：`apps/server/src/app.ts`、`apps/server/src/routes/`
- **学习要点**：Express 中间件链、Router 模块化、错误处理中间件、请求日志

### 9.3 环境变量与配置管理
- **知识点**：服务端 .env 管理（不能用 VITE_ 前缀！）
- **对应文件**：`apps/server/.env.example`、`apps/server/src/config.ts`
- **学习要点**：`dotenv` 加载、`process.env` 访问、配置集中导出、类型安全包装

### 9.4 BFF API 代理层（AI API 转发）
- **知识点**：服务端转发 AI API 请求，隐藏真实 API Key
- **对应文件**：`apps/server/src/routes/ai.ts`
- **学习要点**：服务端 `fetch`（Node 18+ 原生 / `undici` / `axios`）、请求透传、响应头处理、Error 映射

### 9.5 SSE 流式代理
- **知识点**：服务端将 AI 流式响应通过 SSE 转发给前端
- **对应文件**：`apps/server/src/routes/ai.ts`
- **学习要点**：Express 的 `res.write` / `res.flush`、`Content-Type: text/event-stream`、管道（pipeline）转发

### 9.6 会话管理（内存 / Redis）
- **知识点**：多轮对话上下文的服务端维护
- **对应文件**：`apps/server/src/services/conversation.ts`
- **学习要点**：`Map` 内存缓存 / `ioredis` 集成、会话 ID（cid）、消息历史存取、过期清理

### 9.7 CORS 跨域配置
- **知识点**：服务端配置 CORS 允许前端跨域请求
- **对应文件**：`apps/server/src/middleware/cors.ts`
- **学习要点**：`cors` 中间件、origin 白名单、credentials、预检请求（OPTIONS）

### 9.8 日志与错误监控
- **知识点**：服务端请求日志和异常捕获
- **对应文件**：`apps/server/src/middleware/logger.ts`、`apps/server/src/middleware/errorHandler.ts`
- **学习要点**：请求/响应耗时统计、结构化日志、全局错误兜底、错误堆栈过滤

### 9.9 健康检查与启动入口
- **知识点**：启动 HTTP 服务，提供健康检查接口
- **对应文件**：`apps/server/src/index.ts`
- **学习要点**：`app.listen()` 端口监听、`/healthz` 接口、优雅关闭（SIGTERM/SIGINT）、异常退出码

---

## 模块 10：Vue3 网页端

### 10.1 Vue3 + Vite 项目初始化
- **知识点**：创建 Vue3 + TypeScript + Vite 项目骨架
- **对应文件**：`apps/web-vue/package.json`、`vite.config.ts`、`tsconfig.json`
- **学习要点**：Vue SFC（`.vue` 单文件组件）、`defineProps`/`defineEmits`、Vite Vue 插件

### 10.2 Vue Router 配置
- **知识点**：使用 Vue Router v4 实现路由
- **对应文件**：`apps/web-vue/src/router/index.ts`
- **学习要点**：`createRouter`、`createWebHistory`、路由表配置、懒加载 `() => import()`、导航守卫

### 10.3 Pinia 状态管理
- **知识点**：使用 Pinia 管理全局状态
- **对应文件**：`apps/web-vue/src/stores/`
- **学习要点**：`defineStore`、State / Getters / Actions、`storeToRefs` 解构、持久化插件

### 10.4 Tailwind CSS 在 Vue 中集成
- **知识点**：Tailwind v3 与 Vue SFC 的配合
- **对应文件**：`apps/web-vue/tailwind.config.js`、`src/style.css`
- **学习要点**：content 路径包含 `.vue`、`@apply` 在 `<style>` 中使用、CSS Module 对比

### 10.5 首页与模块列表页（Vue 实现）
- **知识点**：用 Vue 组件方式重写首页导航
- **对应文件**：`apps/web-vue/views/Home.vue`、`apps/web-vue/components/ModuleCard.vue`
- **学习要点**：`v-for` 渲染列表、`v-bind` / `v-on`、`<router-link>`、`:class` 动态样式

### 10.6 AI API 基础调用（Vue 版）
- **知识点**：在 Vue 中调用 BFF 的非流式 AI 接口
- **对应文件**：`apps/web-vue/composables/useChat.ts`、`apps/web-vue/views/M1ApiBasics.vue`
- **学习要点**：`axios` / 原生 `fetch`、`ref` 管理 loading/error、`onMounted`、组件卸载 cancel

### 10.7 流式响应（Vue 版 + SSE）
- **知识点**：EventSource 消费 BFF 的 SSE 流式接口
- **对应文件**：`apps/web-vue/composables/useStreaming.ts`、`apps/web-vue/views/M2Streaming.vue`
- **学习要点**：`new EventSource(url)`、`onmessage` 事件、`close()` 关闭、`onerror` 重连

### 10.8 基础聊天界面（Vue 版）
- **知识点**：Vue 版简单聊天页面
- **对应文件**：`apps/web-vue/views/M4Chat.vue`、`apps/web-vue/components/MessageBubble.vue`
- **学习要点**：`textarea` 双向绑定 `v-model`、滚动到底部 `nextTick`、消息列表 `v-for` + key

---

## 模块 11：packages/shared 公共包

### 11.1 公共类型定义包
- **知识点**：抽离前端和服务端共享的 TS 类型
- **对应文件**：`packages/shared/src/types/*.ts`
- **学习要点**：`ChatRequest`、`ChatMessage`、`ChatResponse`、`Citation` 等类型统一导出、`export type` 语义

### 11.2 公共常量包
- **知识点**：跨端共享常量
- **对应文件**：`packages/shared/src/constants/*.ts`
- **学习要点**：模型名白名单、Temperature 范围、默认 System Prompt、模块路由映射等

### 11.3 公共工具函数
- **知识点**：与框架无关的纯工具函数
- **对应文件**：`packages/shared/src/utils/*.ts`
- **学习要点**：Token 估算、SSE 解析、时间格式化、ID 生成（nanoid）、纯函数无副作用

### 11.4 构建与导出配置
- **知识点**：配置 shared 包的构建和导出
- **对应文件**：`packages/shared/package.json`、`tsconfig.json`
- **学习要点**：`main` / `module` / `types` 字段、`tsup`/`vite` 构建（或直接源文件导入）、工作区依赖引用 `@ai-study/shared`
