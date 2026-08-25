# 详细学习计划 - 需求文档

## 概述

将现有 7 个学习模块的内容细化为精确到每个小知识点的学习计划，每个知识点对应具体的代码实现，形成可逐步对照学习的结构化路径。

## 核心需求

- 每个模块拆分为细粒度的知识点（每个知识点是一个可独立学习的最小单元）
- 每个知识点有明确的：学习目标、涉及的代码文件、关键代码片段说明
- 知识点之间有清晰的依赖关系和学习顺序
- 学习者可以按顺序逐个完成，每完成一个知识点就能看到对应的代码效果

## 面试结合需求（🎯 AI + C 端双侧重）

- 每个知识点关联 1-3 道相关的前端面试题，其中 **AI 产品场景题 ≥ 80%**（不允许出现纯「前端通用 Todo/商城/管理后台」场景的面试题）
- 面试题覆盖：**AI 产品原理理解类**（流式粘包处理、Hydration Mismatch 聊天场景）、**代码实现类**（闭包在 4 个 AI 场景用法）、**C 端体验设计类**（聊天列表虚拟滚动、输入框键盘避让）
- 面试题在学习完对应知识点后展示，用于自测和巩固
- 面试题包含参考答案要点，方便自我检验
- 面试题难度标注（初级/中级/高级），标注「AI 前端工程师」「C 端产品工程师」真实面试场景匹配度

## UI 呈现约束（🎯 C 端生产级 · 移动端 375px 一等公民）

- **移动端 375px（iPhone 12/13/14 逻辑宽度）是默认开发视口**，桌面端 >768px 只是适配不是主场景；所有组件先在 375px 下写对，再用 Tailwind `md:` 前缀适配大屏
- **移动端细节强制到位（一眼像真 App）**：viewport meta 含 `viewport-fit=cover`（刘海/安全区）、`user-scalable=no`（禁双指缩放）；iPhone 底部安全区 `env(safe-area-inset-bottom)`、顶部刘海 `env(safe-area-inset-top)`；1px 细线；防止点击高亮；长按消息菜单
- **交互反馈强制三态齐全**：所有可点击元素必须有 `:active` 点击态 / `:disabled` 禁用态 / loading 骨架三态；错误提示是用户可读中文，不能只吐 console；空状态页有插图 + 引导文案
- **输入体验（聊天/表单类上线级）**：iOS 键盘避让（输入框不被键盘遮挡）；回车发送 + 粘贴图片/文件预览；草稿自动保存（刷新/切换会话不丢）；发送中按钮禁用 + 停止按钮可取消（AbortController）
- **聊天界面采用全屏对话模式**（类似微信/ChatGPT 移动端）：消息气泡 375px 宽度不超过 85%、长文本自动换行、代码块横向滚动、流式打字机光标动画不闪
- 导航使用底部 Tab 栏（≥44px 高度，图标 + 文字两行），不使用桌面端侧边栏
- **上线前必须勾选「📱 C 端体验必查 7 大类清单」**（见 design.md 对应章节）：① 首屏性能 3G 弱网指标 ② 交互三态反馈 ③ 输入体验 ④ 安全（前端永不含 API Key、CSP、DOMPurify）⑤ 移动端细节 ⑥ 长列表虚拟滚动 + 图片懒优化 ⑦ a11y 可访问性基础
- **安全（C 端上线底线，写入每个模块验收）**：所有 API 请求走 BFF/Nitro 中转，前端打包产物搜索 `sk-` / API Key 绝对等于 0 个结果；Markdown 渲染必须 DOMPurify 过滤；工具调用 Schema / 敏感逻辑 100% 放服务端执行

---

## 模块 1：AI API 基础调用

> 🤖 **AI 场景价值概述**：本模块实现「用户发一句话 → 模型回一句话」的最短 AI 对话闭环，是后面流式、RAG、Agent 的地基。所有 AI 产品的第一个开发里程碑就是这个模块跑通（历史消息拼接、请求超时、429 限流、错误分类用户可读提示都是 AI 产品的上线标配）。
>
> 📱 **C 端生产化改造点（本模块特有）**：① 发送按钮 loading/禁用/普通三态 + 按钮点击态；② 错误提示要按 AI 场景分层（密钥错误 / 余额不足 / 模型维护 / 网络断开），不能都弹「请求失败」；③ 移动端键盘「发送」键（Return 键）直接发送消息；④ 草稿自动保存（输入一半刷新不丢）。
>
> 🧠 **AI + C 端专属面试题示例**：
> 1. 在 ChatRequest 里拼接历史消息，如何用闭包「在超时清理时正确取消当前请求」？如果用普通 let chatId 会有什么 AI 场景下的串会话问题？
> 2. 当 API 返回 401（未授权）/ 429（限流）/ 500（服务端异常）时，375px 下的错误 Toast 分别怎么设计才不会让用户觉得「App 崩了」？（画交互说明，三态案例）

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

> 🤖 **AI 场景价值概述**：流式打字机（SSE delta 逐字渲染）是 AI 产品区别于普通 App 的第一核心体验。本模块解决「用户 3s 内看到第一个字」的体感（哪怕 10s 才完全输出），解决「粘包处理」「光标动画」「断网重连」「停止按钮」都是 ChatGPT 级 C 端上线必须有的体验，AI 场景占比 100%。
>
> 📱 **C 端生产化改造点（本模块特有）**：① 逐字累加时聊天列表自动滚到底部（375px 小屏不能让用户手动滑）；② 光标动画 + 打字机效果不闪烁（不能每 50ms 整段重渲染 Markdown，要做增量渲染）；③ 停止按钮在流式中高亮，停止后可再发下一条；④ SSE 断网指数退避重连（1s→2s→4s→8s 最多 5 次），重连成功接在当前回答尾巴上；⑤ 用户长按流式回答可「复制已有部分」。
>
> 🧠 **AI + C 端专属面试题示例**：
> 1. 事件循环 + SSE：在 375px 下同时做「逐字累加 ref += delta（微任务 Promise.then）」+「光标 500ms 闪烁（宏任务 setTimeout）」+「新 chunk 到达自动滚到底（scrollTop）」，请画出宏任务/微任务执行顺序，并解释为什么有的手机上「打字一卡一卡」？如何用 requestAnimationFrame 合并 delta 批量刷新？
> 2. SSE 粘包：一个 chunk 里包含 `data: {"delta":"你好"}\n\ndata: {"delta":"啊"}\n` 两个数据，有的实现只会渲染出「啊」，漏掉「你好」，请写出 3 行以上的粘包处理正则/状态机实现思路，并解释为什么 AI 流式一定会出现粘包（TCP 流无边界的原理）。

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

> 🤖 **AI 场景价值概述**：AI 产品的效果 ≈ Prompt 效果 × 模型能力。本模块解决「不同 AI 任务用不同模板（翻译/总结/润色/角色设定）」「System Prompt 与多轮历史正确拼接顺序」「Token 计数 + 截断保留最新 N 轮」「JSON 结构化输出强约束」都是真实 AI 产品上线必须的业务逻辑，不是通用前端。
>
> 📱 **C 端生产化改造点（本模块特有）**：① 375px 下 Prompt 模板切换使用底部 ActionSheet（不是桌面端下拉菜单）+ 选中高亮；② Token 计数器实时显示在输入框右上角（红色预警当超 80% 模型上限）；③ JSON 结构化输出失败时在 375px 下做「卡片展开/收起」显示中间调试信息（C 端不能把控制台错误暴露给用户）。
>
> 🧠 **AI + C 端专属面试题示例**：
> 1. Token 计数：中文 1 字 ≈ 1.3 tokens、英文 1 word ≈ 1 tokens，模型上限 4096 tokens。请基于闭包 + TS 类型设计一个 `useTokenCounter()` composable，要求当拼接历史消息 + Prompt 模板 + 用户新问题后超过 3500 tokens 时自动「保留 System Prompt + 最近 6 轮对话」（滑动窗口），并解释为什么这种滑动窗口会在 AI 产品里导致「记忆丢失」？（结合事件循环说明异步更新问题）
> 2. Prompt 角色设定在 SSR 阶段用 Pinia 持久化到 Cookie：如果写 `useCookie('prompt_role', { default: () => 'default' })`，default 用了 `Math.random()` 导致 Hydration Mismatch，请给出 2 种修复方案并分别说明 SSR 时 C 端首屏的差异（TTFB / CLS）。

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

> 🤖 **AI 场景价值概述**：聊天 UI 是 AI 产品的核心交互形态。本模块解决「多会话切换」「消息气泡区分 system/user/assistant/tool 四种角色」「代码块高亮 + 一键复制」「长消息流式渲染不闪烁」「引用来源 Citation 卡片」，全部都是 AI 产品独有的前端需求，不是普通 App 的列表页。
>
> 📱 **C 端生产化改造点（本模块特有）**：① 375px 下全屏聊天布局，底部输入框 + iPhone 安全区 + 键盘高度监听避让；② 长聊天列表 ≥50 条消息启用虚拟滚动（虚拟列表），否则首屏 DOM 过多 LCP/INP 爆炸；③ 单条消息长按弹出「复制 / 重新生成 / 删除 / 转发」的移动端 ActionSheet；④ 引用来源 Citation 卡片 375px 下可左滑收起；⑤ 空状态页（无会话、无消息）插图 + 引导 + 快捷开始对话按钮。
>
> 🧠 **AI + C 端专属面试题示例**：
> 1. 消息列表在 SSR 下 `useAsyncData` 预取了前 20 条消息，客户端又追加了 3 条流式新消息。当用户关闭 Tab 再回来：如果 Pinia persistentstate 错误使用了 localStorage（不是 cookie storage），会导致 Hydration Mismatch 的哪 3 种典型表现？请按渲染流水线（SSR 字符串 → 客户端激活）画出错误发生的具体阶段。
> 2. 聊天输入框：375px 小屏 + iOS Safari 键盘弹起时，传统「scrollIntoView(false)」会把消息顶出屏幕。请用 composables/useKeyboardAvoidance 写一段闭包 + 事件监听 + 节流（requestAnimationFrame）的实现，解释为什么闭包能「记住上一次键盘高度」避免抖动。

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

## 模块 5：Function Calling（工具调用）

> 🤖 **AI 场景价值概述**：Function Calling 让 AI 从「只会说话」变成「会干活」——查天气、查机票、查 SQL、调第三方 API。AI 前端在这个模块的核心价值是：**前端绝对不能执行工具，只传白名单 + 显示执行中间态**（比如「模型决定调用：天气查询（北京）→ 正在执行... → 工具返回结果 → 模型总结给用户」的 Agent 时间线），是 AI 产品安全 + 可视化的核心。
>
> 🔗 **后端实现约束（LangChain.js 落地 · 禁止手写 while 循环拼 tool_calls）**：BFF（apps/server）+ Nitro 转发层，全部走 `@langchain/core` / `@langchain/openai` 生态：
> - 所有工具走 `DynamicStructuredTool`（Zod schema 定义参数），在 `apps/server/src/services/tools/*.tool.ts` 里 4 件套声明（name/description/Zod/_call 实现）；`services/tools/index.ts` 的 `registerTools()` 做统一注册中心
> - 调用链走 `ChatOpenAI.bindTools([...])` 或 `createToolCallingAgent()` + `AgentExecutor`，**BFF 路由 /api/tools/execute 直接吃 graph/agent 的 streamEvents SSE 输出**（LangChain 自动拼 system prompt、自动解析 tool_calls、自动注入 tool message，不手写）
> - 安全：Nitro 路由只把 {question, allowedToolIds} 转发给 BFF，**工具 Schema / Zod 定义 / 执行代码 100% 在 apps/server**，前端只拿到 `ToolWhiteListItem`（id+name+icon），打包产物里搜不到任何 StructuredTool/Zod
>
> 📱 **C 端生产化改造点（本模块特有）**：① 工具执行中间态卡片 375px 下有加载 spinner + 工具名 + 参数摘要（绝对不能把完整 JSON Schema 原样吐给用户）；② 工具失败（如天气 API 挂了）卡片有「重试」按钮 + 用户可读中文错误，不能显示后端的 Stack Trace；③ 前端工具白名单只让勾选「模型允许的工具」，防止用户篡改请求调其它工具；④ 所有工具 Schema / 实际执行 100% 放在 Nitro server route 或 BFF，前端打包产物里**不能出现执行代码**。
>
> 🧠 **AI + C 端专属面试题示例**：
> 1. 安全（面试高频）：某 AI App 把工具 Schema 定义写在前端 `definitions.ts` 里，并且直接让前端 `axios.post(工具 URL)` 执行。请从「C 端上线安全底线」角度，列出至少 5 种攻击路径（篡改白名单、注入参数、刷调用次数、读取本地文件、XSS 触发工具调用），并给出本项目的正确架构（Nitro 执行 + 前端只传白名单）。
> 2. TS 类型收窄 + 工具 Schema：有一个工具 `{"name":"weather","parameters":{"type":"object","properties":{"city":{"type":"string"},"days":{"type":"number"}},"required":["city"]}}`，请用 TS `satisfies` + `zod` schema 在 Nitro 服务端做「参数校验」，前端只传 `{city}` 并显示「正在查北京天气...」的卡片。解释为什么 TS 类型（开发期）≠ runtime 校验（上线期），zod 的必要性在 AI 场景里是什么？

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

### 5.9 后端实现：LangChain.js StructuredTool + AgentExecutor（apps/server）
- **知识点**：4 件套声明工具 → 统一注册中心 → 绑定到模型 → agent 执行流式输出中间态
- **对应文件**：`apps/server/src/services/tools/{calculator,now,rag_retriever}.tool.ts` / `apps/server/src/services/tools/index.ts` / `apps/server/src/routes/tools.ts`
- **学习要点**：① `DynamicStructuredTool.from({name, description, schema: z.object(...), func: async(args)=>...})` 模板 ② `ChatOpenAI.bindTools(Object.values(registerTools()))` 如何让模型自动决定调用哪个工具 ③ `AgentExecutor` 的 `streamEvents({ version: 'v1' })` 事件格式（events: on_llm_start / on_tool_start / on_tool_end）→ 对应前端 ToolCallCard 三态（loading / 参数摘要 / 结果）④ 为什么必须把 `maxIterations` 设成 8（防止死循环消耗 Token）

---

## 模块 6：RAG 前端集成（AI 知识库）

> 🤖 **AI 场景价值概述**：RAG = 「检索 + 生成」= 让 AI 基于你的私有文档回答（AI 知识库、AI 文档问答）。本模块前端要解决「文档上传 + 进度条 + 失败重试」「知识库文档列表 + 搜索 + 分页懒加载」「回答里的引用来源 Citation 卡片点击跳转原文片段」——全部是 AI 企业级产品的独有用法，不是普通的「文件管理系统」。
>
> 🔗 **后端实现约束（LangChain.js 落地 · 禁止手写 split('\n\n')）**：RAG 4 步流水线全部用 `@langchain/community` 系列组件：
> - **Loader**：PDF→pdf-parse、MD→TextLoader、DOCX→可选 Mammoth，统一输出 `Document<MetadataRecord>[]`
> - **Splitter**：`RecursiveCharacterTextSplitter({ chunkSize: 256, chunkOverlap: 32, separators: ['\n\n','\n','。','',' '] })`，**禁止手写 split('\n\n')**（会把完整语义切散，检索命中率骤降 50%+）
> - **Embeddings**：统一走 `@langchain/core/embeddings` 接口（默认 OpenAIEmbeddings，换 DashScope 只改 1 行）；批量 embedDocuments 并发 8
> - **VectorStore**：默认 `MemoryVectorStore.fromDocuments(docs, embeddings)`（教学期）；持久化一行替换 `new LangChainVectorStoreSqlite()` / `new QdrantVectorStore(...)`
> - **问答链**：`createRetrievalChain()` 或等价 LCEL，**必须返回 `{answer, context: Document[]}`** → context 映射到 `CitationFragment[]` 给前端渲染
>
> 📱 **C 端生产化改造点（本模块特有）**：① 375px 下文件上传用底部 ＋ 按钮 ActionSheet（拍照 / 相册 / 文件 / 粘贴板），不是桌面端拖拽（移动端拖不了）；② 上传进度条 + 多文件并行上传（最大 5 个并发）+ 单个文件失败重试；③ 文档列表用 IntersectionObserver 做无限滚动（前 20 条 SSR 预取，滚动到底自动下一页）；④ Citation 引用来源卡片在回答气泡里可点击展开「原文 200 字上下文」+「跳转到文档详情页」；⑤ 长 PDF 上传失败 → 分块切片前端显示（后端分块，前端显示「切片 1/52 已处理」）。
>
> 🧠 **AI + C 端专属面试题示例**：
> 1. 文件上传 + 背压：某知识库 PDF 50MB，前端直接 multipart/form-data 上传时手机发热、页面卡顿（Node 端 `req.on('data')` 频率 > 浏览器 UI 刷新频率）。请用 `ReadableStream` + 前端分块切片（每块 2MB，用 SparkMD5 做 identifier）+ 并发 3 条流水线（Promise.all + 信号量）写一个 composables/useChunkedUpload，并解释 Node Stream 背压的原理在 AI 文档上传场景是什么？
> 2. SSR + 无限列表：知识库文档列表前 20 条在 Nuxt SSR 用 `useFetch` 预取，375px 下 IntersectionObserver 自动下一页，当某一页返回重复数据（服务端游标 bug）时，前端不能把「Loading 骨架」卡住。请用 TS 泛型 + 闭包去重 + 错误兜底（空态 + 重试按钮）写一个实现思路，说明虚拟滚动对长文档列表的 INP 影响（浏览器原理 Task 队列）。

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

### 6.9 后端实现：LangChain.js RAG 4 步流水线 + Retrieval Chain（apps/server）
- **知识点**：PDF/MD/Text Loader → RecursiveCharacterTextSplitter → Embeddings → MemoryVectorStore → RetrievalQA with Citations
- **对应文件**：`apps/server/src/services/rag/{loaders,splitter,embeddings,vectorstore}.ts` / `apps/server/src/routes/rag.ts`
- **学习要点**：① RecursiveCharacterTextSplitter 为什么要设置中文分隔符（`。`）+ chunkOverlap ≥ 32 字符（防止一个长句被切在两个 chunk 的边界，检索 miss）② `similaritySearchWithScore(query, k=4)` → 返回的 score 做归一化（cosine 0~1）给前端渲染相似度条 ③ createRetrievalChain 后如何从 `context` 里取 sourceDocuments → 映射为 `CitationFragment[]`（docId/docName/chunkIndex/snippet/score）

---

## 模块 7：AI Agent 交互

> 🤖 **AI 场景价值概述**：Agent = AI 自主「思考 → 调用工具 → 观察结果 → 再思考 → 再调用工具...」的循环（Think-Act-Observe）。本模块前端要解决「Agent 时间线可视化」（StepCard 一步步显示 思考/工具/结果/总结）、「用户干预」（用户中途打断：暂停 / 继续 / 修改参数 / 停止 / 回滚到上一步）——这是 AI Agent 产品区别于普通聊天的核心交互。
>
> 🔗 **后端实现约束（LangGraph.js 落地 · 禁止手写 while(true) Think-Act-Observe）**：Agent 循环全程走 `@langchain/langgraph` StateGraph 声明式状态图：
> - 状态定义：`interface AgentState { messages: BaseMessage[]; step: number; tool_results: ToolMessage[]; answer?: string }`（StateGraph 会自动合并 reducer）
> - 节点声明：`think(llm)` / `call_tools` / `observe` / `answer` 四个节点，条件边 `if tool_calls then → call_tools else → answer`
> - 持久化：`MemorySaver` 做 checkpointer（教学期），升级 `better-sqlite3` + `SqliteSaver` 一行替换
> - 中断（Human-in-the-loop）：`call_tools` 节点加 `interruptBefore`（中断等用户确认工具参数 / 允许工具执行）
> - SSE：BFF `/api/agent/run` 直接吐 `graph.streamEvents(input, { version: 'v2', streamMode: 'values' })` → 前端 AgentTimeline 直接按 event type 渲染 5 色进度条
>
> 📱 **C 端生产化改造点（本模块特有）**：① 375px 下 Agent 时间线用左侧垂直进度条 + 每步卡片展示（思考=灰色、工具执行=蓝色加载、结果=绿色、失败=红色），时间线自动滚到当前步骤；② 用户干预底部浮层：暂停/继续（AbortController 信号）、停止对话、修改下一轮参数的底部抽屉；③ Agent 执行超时后（比如 10 步仍未出最终答案）C 端显示「已执行 10 步，是否继续 5 步？」的浮层，不无限加载；④ 每步的中间变量（Tool 输入/输出）卡片支持「长按复制参数」「展开 JSON 原文」，但默认只显示友好摘要。
>
> 🧠 **AI + C 端专属面试题示例**：
> 1. Agent 状态机：有一个 AgentLoop（10 步 Think-Act-Observe），SSE 每推一步前端更新一次 `agentSteps[]`，同时「时间线自动滚到底」。请用闭包 + TS 联合类型收窄（StepStatus = 'thinking' | 'tool_call' | 'tool_result' | 'error' | 'done'）写 `composables/useAgentTimeline`，并解释为什么用 `ref<AgentStep[]>` + `shallowRef` 在 20 步以上时能显著降低 INP（响应交互时间）？
> 2. 用户「回滚到上一步」的交互：在 Agent 执行到第 6 步时用户点「回到第 3 步重跑」。由于服务端状态机不回滚，前端不能直接改数组。请给出一个基于「会话 ID + 分支版本号（v1 → v1-r3）」的前端实现方案，结合 cookie 持久化 + Pinia 多会话分支说明 SSR Hydration 下为什么不能用可变数组原地 splice？

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

### 7.9 后端实现：LangGraph.js StateGraph + Checkpointer（apps/server）
- **知识点**：声明式 AgentState → 4 节点（think/call_tools/observe/answer）StateGraph → 条件边 → checkpointer 持久化 → streamEvents 事件流输出
- **对应文件**：`apps/server/src/services/agent/{state,graph,checkpointer}.ts` / `apps/server/src/routes/agent.ts`
- **学习要点**：① StateGraph 的 reducer 为什么要用 `messages: addMessages`（自动合并而不是覆盖）② 条件边写法 `addConditionalEdges('think', shouldCallTools, { call_tools, answer })` 如何替代手写 if-while ③ checkpointer 的 `thread_id` 如何让同一个会话关闭浏览器后恢复继续 ④ `graph.streamEvents` 的 event 类型 → `AgentTimelineStep.kind` 的映射表（on_chat_model_start→think / on_tool_start→tool_call / on_tool_end→tool_output / on_chain_end→observe / final→answer）

---

## 模块 8：AI 组件生成器（产品主线 ⭐ · 7 模块毕业项目）

> 🚀 **产品定位**：AI 组件生成器 = 前面 7 个 AI 模块技术的集大成毕业项目。用户输入自然语言需求（如"带防抖的搜索框，支持下拉建议"）→ Agent 多轮细化 → RAG 检索组件库源码 → LangChain 生成 Vue/React 组件代码 → 沙箱实时预览 → 迭代/下载。独立应用 apps/generator（Nuxt 3 SSR, :3002），复用 BFF services/generator 编排层。
>
> 🔗 **7 模块在生成器里的角色映射（教学时必须挂这个映射）**：
> | AI 模块 | 生成器环节 | 说明 |
> |---|---|---|
> | m1 API 基础 | LLM 调用层 | 生成器调 LLM 生成代码的基座 |
> | m2 流式响应 | 代码流式输出 | 逐行输出代码 + 实时语法高亮（Monaco diff） |
> | m3 Prompt 工程 | 代码生成 Prompt 模板 | System Prompt = 资深前端架构师角色 + 组件规范约束 |
> | m4 Chat UI | 需求对话界面 | 用户和 Agent 对话细化需求的界面 |
> | m5 Function Calling | 工具调用层 | create_file / run_preview / generate_props / generate_tests / validate_code |
> | m6 RAG | 组件库源码检索 | Element Plus/Naive UI 组件源码向量化，生成时检索参考 |
> | m7 Agent | 多轮迭代循环 | 需求细化 → 检索 → 生成 → 预览 → 用户反馈 → 再生成 |
>
> 📱 **C 端生产化改造点（生成器专属）**：① 375px 下三栏布局变 Tab 切换（对话 | 代码 | 预览），不是桌面端的并排；② Monaco 编辑器移动端只读模式（关小地图 + 缩小字体），桌面端全功能编辑；③ iframe 沙箱预览 `sandbox="allow-scripts"` 禁 `allow-same-origin`，防止生成的代码访问父页面 Cookie/DOM；④ 预览设备尺寸切换（375px/768px/1024px），移动端默认 375px 设备框；⑤ 生成中可 AbortController 取消 + 草稿自动保存；⑥ ZIP 下载支持移动端 File System Access API / fallback download attribute。
>
> 🧠 **AI + C 端专属面试题示例**：
> 1. 沙箱安全：AI 生成的 Vue SFC 组件里可能有 `<script>document.cookie</script>` 或 `fetch('/api/admin')`，如果直接在主页面渲染会导致 XSS / 越权。请用 iframe sandbox 属性 + CSP nonce 设计一个安全沙箱方案，说明 `allow-scripts` 和 `allow-same-origin` 为什么不能同时开。
> 2. 流式代码渲染：LangChain streamEvents v2 的 `on_chat_model_stream` 逐 token 输出代码，但 Monaco Editor 的 `setValue()` 每次全量替换会导致光标跳动 + 性能卡顿。请用 `editor.executeEdits()` 增量插入 + requestAnimationFrame 节流写一个 `useCodeEditor` 的流式代码更新方案，解释事件循环和浏览器渲染管线的关系。

### 8.1 需求输入与 Agent 对话（复用 m4 Chat UI）
- **知识点**：自然语言需求输入 + Agent 多轮细化追问界面
- **对应文件**：`apps/generator/pages/index.vue` + `components/RequirementInput.vue` + `components/AgentDialog.vue`
- **学习要点**：需求输入区（回车发送 + 草稿保存）、Agent 对话区（复用 MessageBubble + 流式打字机）、追问跳过逻辑、上传设计稿截图（多模态预留）

### 8.2 代码流式输出与编辑器（复用 m2 流式 + Monaco）
- **知识点**：LangChain streamEvents → Monaco Editor 增量代码渲染
- **对应文件**：`apps/generator/components/CodeEditor.vue` + `composables/useCodeEditor.ts`
- **学习要点**：Monaco 生命周期管理、`executeEdits()` 增量插入 vs `setValue()` 全量替换、Diff 视图（用户编辑 vs AI 生成）、375px 只读模式、长代码折叠（>500 行）

### 8.3 沙箱预览（生成器核心）
- **知识点**：iframe 隔离渲染 + 实时热更新 + 设备尺寸切换
- **对应文件**：`apps/generator/components/SandboxPreview.vue` + `composables/useSandbox.ts`
- **学习要点**：iframe `sandbox="allow-scripts"` 安全隔离、esbuild 浏览器端编译 vs Vite dev BFF 端编译、热更新触发机制、预览设备切换（375px/768px/1024px）、编译错误捕获与展示

### 8.4 自动文档生成（FC + AST 解析）
- **知识点**：Function Calling 工具解析 SFC/TSX AST → 生成 Props/Emits/Slots 文档
- **对应文件**：`apps/generator/components/PropsDocPanel.vue` + `apps/server/src/services/generator/tools/generate_props.tool.ts`
- **学习要点**：`@vue/compiler-sfc` 解析 `defineProps` 泛型、`@babel/parser` 解析 TSX `interface Props`、文档面板表格渲染、AST 解析 vs 正则匹配的准确性差异

### 8.5 自动测试生成（FC + Vitest）
- **知识点**：Function Calling 工具生成组件测试用例 + 运行结果展示
- **对应文件**：`apps/generator/components/TestPanel.vue` + `apps/server/src/services/generator/tools/generate_tests.tool.ts`
- **学习要点**：基于 Props 边界值 + 交互场景生成 Vitest 测试、测试覆盖率检查、测试结果流式输出、失败用例高亮

### 8.6 代码校验（FC + ESLint + AST）
- **知识点**：Function Calling 工具做静态代码检查
- **对应文件**：`apps/server/src/services/generator/tools/validate_code.tool.ts`
- **学习要点**：ESLint 集成、TypeScript 类型检查、AST 级别未使用变量检测、ValidationIssue 严重级别分层（error/warning）、校验结果前端展示

### 8.7 组件历史管理（Pinia 多会话 + checkpointer）
- **知识点**：历史生成组件列表 + 搜索 + 标签 + 详情回放
- **对应文件**：`apps/generator/pages/history.vue` + `pages/[id].vue` + `composables/useComponentHistory.ts`
- **学习要点**：LangGraph checkpointer 按 thread_id 拉取历史、Pinia 多会话管理、虚拟滚动（≥20 个组件）、Agent 步骤回放、草稿持久化

### 8.8 下载与导出
- **知识点**：ZIP 打包下载组件 + 文档 + 测试 + package.json
- **对应文件**：`apps/generator/components/DownloadBar.vue`
- **学习要点**：jszip + file-saver 打包、移动端 File System Access API / fallback download、复制到剪贴板、导出 GitHub Gist（预留）

### 8.9 BFF 生成器编排层（LangGraph StateGraph 5 节点）
- **知识点**：GeneratorAgent 状态图（clarify → retrieve → generate → preview → iterate）+ 条件边 + checkpointer
- **对应文件**：`apps/server/src/services/generator/{agent,codegen,rag,sandbox}.ts` + `apps/server/src/services/generator/tools/*.tool.ts` + `apps/server/src/routes/generator.ts`
- **学习要点**：① 5 节点 StateGraph 设计（clarify 判断是否需要追问 / retrieve 调 RAG 检索组件库源码 / generate LCEL 代码生成 / preview 调 FC 工具建文件+编译 / validate 调 FC 工具校验+文档+测试）② 条件边：`clarify → if need_clarify then clarify else retrieve` / `validate → if user_satisfied then answer else iterate→retrieve` ③ codegen 的 Prompt 模板设计（角色=资深前端架构师 + 组件规范约束 + 检索到的参考组件注入） ④ sandbox 临时目录隔离 + 超时清理 ⑤ 5 个 StructuredTool 的 Zod schema 设计

---

## 项目基础设施知识点
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
| Vue3 网页端（SPA 对照） | 8 |
| **Vue3 SSR 端（Nuxt 3 · 主学习端）** | **16** |
| packages/shared | 4 |
| **基础补充 A：JavaScript 语言** | **18** |
| **基础补充 B：浏览器原理** | **14** |
| **基础补充 C：Node.js 运行时** | **16** |
| **总计** | **140** |

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

---

## 模块 12：Vue3 SSR 端（Nuxt 3 · 主学习端，C 端导向）

> ⚠️ **优先级说明**：本模块优先级高于 React 端和 Vue SPA 端，后续所有新功能（7 个学习模块对齐）优先在 Nuxt SSR 端实现，再回补 SPA / React 作为对照。
>
> 📚 **Vue3 / Nuxt 3 教学范围定位：中高级（跳过基础语法）**
> - 不再讲解以下 Vue 3 基础语法（默认已掌握）：`<template>` 常用指令写法、`<script setup>` 基本结构、ref/reactive/computed/watch 的基础用法、v-if/v-for/v-model/ @click 等常见指令、defineProps / defineEmits 基本声明、`import { xxx } from 'vue'` 的引入方式
> - 直接讲解以下**工程化 / 业务化 / SSR 专属的中高级内容**：
>   - Composition API 工程化：自定义 Composables 抽取（`composables/useXxx` 命名约定）、「全局 Pinia 状态」vs「局部可复用逻辑 composable」的拆分边界
>   - Vue3 响应式进阶：`ref` vs `reactive` 的使用边界、`toRefs / toRef` 解构响应式保留、`shallowRef / shallowReactive / markRaw` 性能优化、Vue 3.3+ 的 `defineModel` / `defineProps<泛型接口>()` / `defineSlots`
>   - Vue3 + TypeScript 实战：`ref<泛型>`、`computed<返回类型>`、`defineProps<泛型接口>()` + `withDefaults`、Emits 类型化、`InjectionKey<T>` 让 provide/inject 全链路类型安全
>   - Nuxt 3 约定式系统：`pages/` 目录路由规则（含动态路由 `[id].vue` / 嵌套路由 / 捕获所有路由 `[...slug].vue`）、`layouts/` 布局系统、`middleware/` 路由中间件（全局/命名/内联）、`plugins/` 自动注册 + `.server.ts`/`.client.ts` 执行端控制
>   - Nuxt 3 数据预取（SSR 核心）：`useFetch` vs `useAsyncData` vs `$fetch` 的 SSR 安全用法、`lazy`/`immediate`/`server`/`watch`/`default` 选项组合、Hydration Mismatch 排查清单 + 修复模板
>   - Nuxt 3 SEO & 性能：`useSeoMeta` / `useHead` 注入 title/description/og:image/JSON-LD、`<NuxtImg>` 自动格式 + 响应式尺寸 + 懒加载、`<NuxtLink>` 预取、Nitro `routeRules` 做 SSR/SSG/ISR/CDN Cache 混部策略
>   - 真实 AI 业务组件设计：消息气泡/消息列表/打字机光标/流式 Markdown 渲染/引用来源卡片/Agent 时间线等组件拆分、插槽/作用域插槽/动态组件的高级用法
>   - 移动端 C 端 UI：布局壳（顶部标题栏 + 底部 TabBar + iPhone 安全区适配）、滚动锁定（聊天发送消息自动滚到底）、输入框键盘避让、触摸手势、移动端 1px 边框 / 点击态 / 长按态
>
> 🤖 **AI 场景价值（Nuxt SSR 主线）**：本模块是 7 个 AI 模块的「C 端上线级承载容器」。Nuxt 3 SSR 的核心 AI 价值 = ① 聊天首页首屏能看到 AI 模块卡片（SEO 收录 AI 学习路径）② 历史对话在 SSR 阶段预取 → 用户打开页面 1.2s 内就能看到历史（不是 CSR 转圈 3s）③ 工具调用 Schema / API Key 全进 Nitro server route（C 端安全底线）④ RAG 文档列表 SSR 前 20 条 → 移动端 3G 弱网下仍有内容。**所有 Nuxt 知识点都要挂到 7 个 AI 模块的真实业务上，不能做「个人博客/电商首页」的 SSR Demo**。
>
> 📱 **C 端生产化改造（Nuxt 主线特有）**：① 必须部署 Lighthouse 移动端跑 CI：FCP<1.2s / LCP<2.5s / CLS<0.1 / INP<200ms 作为上线门槛（375px + 3G Fast 模拟）；② `<NuxtImg>` 所有插图用 format=avif/webp + sizes 响应式，单页 JS gzip <150KB；③ 首屏关键 CSS 内联 + 对话消息的 Markdown 样式 inline（避免首屏无样式闪烁）；④ Hydration Mismatch 排查清单（5 场景）作为每个 AI 模块落地后的必填验收项；⑤ PWA 可安装（`@vite-pwa/nuxt`）：375px「添加到主屏幕」后显示为真 App 图标 + 启动页。
>
> 🧠 **AI + C 端专属面试题（Nuxt 主线）示例**：
> 1. SSR + AI 聊天：Nuxt 3 下 `useAsyncData('chat-list', () => fetchHistory())` 在 SSR 阶段拿到了 A 用户的历史消息，但 Nitro 用了默认的内存 cache key，B 用户打开同一页面拿到了 A 的历史（这是真实 AI 线上事故，P0）。请基于 Nitro `useFetch` / `useAsyncData` 的 `key` 选项 + `getCookie('user_id')` + BFF 鉴权给一个修复方案，并说明 TTFB（首字节）为什么会增加 20~80ms？（C 端性能 vs 安全的权衡）
> 2. 移动端输入框键盘避让（真 C 端上线大坑）：在 Nuxt SSR 下写 `composables/useKeyboardAvoidance` 监听 `visualViewport.resize`（iOS Safari 支持）+ 用闭包记录上次高度，用 requestAnimationFrame 节流设置输入框 paddingBottom。请画出「键盘弹起 → visualViewport 高度变化 → ref 更新 → 视图重排」的浏览器渲染流水线 5 阶段（HTML→CSSOM→Layout→Paint→Composite）标注每个阶段对应的改动，说明为什么不用 setTimeout 节流？

### 12.1 SSR 原理理解 & 选型（Nuxt 3 vs Vue + Vite SSR 手动 vs Qu SSR）
- **知识点**：CSR / SSR / SSG / ISR 四种渲染方式对比
- **对应文件**：`docs/09-nuxt3-ssr-step-by-step.md`（教学文档）
- **学习要点**：首屏 TTFB / FCP / LCP / SEO 差异、水合（Hydration）概念、C 端为什么必须 SSR、选择 Nuxt 3 的原因（约定大于配置、自动代码分割、Nitro 跨平台部署）
- **💡 JS 基础补充**：Promise 并发（`Promise.all` vs `Promise.allSettled`）— SSR 并行预取多个接口时必用
- **💡 浏览器基础补充**：渲染流水线 + 首屏关键路径（CRP）— 理解为什么 SSR 能把 FCP 从 3s 压到 500ms
- **💡 Node 基础补充**：Node 作为 Web Server 的流（Stream）模型 — SSR 把 HTML 流式吐给浏览器和 SSE 是同一套底层机制

### 12.2 Nuxt 3 项目初始化（pnpm workspace 方式）
- **知识点**：在 `apps/web-vue-nuxt/` 内创建 Nuxt 3 项目并接入 monorepo
- **对应文件**：`apps/web-vue-nuxt/package.json`、`nuxt.config.ts`、`tsconfig.json`
- **学习要点**：`npx nuxi init apps/web-vue-nuxt`、`@ai-study/shared workspace:*` 引入、`nuxt.config.ts` 中 `alias` + `typescript.tsConfig` 配置与根 tsconfig.base 对齐
- **🤝 与 React 对照**：Nuxt 约定目录（pages/composables/stores/plugins） vs React 手动建目录 / Router 手配

### 12.3 Nuxt 目录约定：pages / layouts / components / composables / stores
- **知识点**：Nuxt 3 基于文件系统的约定路由与自动导入
- **对应文件**：`apps/web-vue-nuxt/pages/`、`layouts/`、`components/`、`composables/`
- **学习要点**：`pages/index.vue` → `/`、`pages/m1.vue` → `/m1`、`[id].vue` 动态路由、`<NuxtPage />` `<NuxtLayout />` `<NuxtLink>` 三个核心组件、`composables/` 下文件自动导入
- **💡 JS 基础补充**：文件系统模块扫描（glob / require.context / import.meta.glob）— 约定路由的底层就是「目录遍历 + 正则映射」

### 12.4 数据预取：useFetch / useAsyncData / $fetch（核心）
- **知识点**：SSR 阶段在 Node 端拉数据，hydration 后在客户端同步
- **对应文件**：`apps/web-vue-nuxt/composables/useAiChat.ts`、`pages/m1.vue`
- **学习要点**：`useFetch(url, { server: true, key, lazy })` 缓存去重、`useAsyncData(key, ()=>BFF请求)` 手动请求、`$fetch`（ohmyfetch 自动降级 Node/browser）、payload 提取与水合核对
- **💡 Node 基础补充**：Node 端发起 HTTP 请求（undici / fetch / axios）与浏览器 fetch 的差异（无 cookie jar、无 Origin、需手动代理）
- **💡 浏览器基础补充**：Hydration Mismatch 水合错误的 5 个常见原因（时间戳、随机数、`typeof window` 判断、客户端 CSS、不同步数据）与修复

### 12.5 SEO：useSeoMeta / useHead / <Title> / <Meta>
- **知识点**：在 SSR 阶段注入正确的 `<title>` `<meta>` OG 标签，面向 C 端收录
- **对应文件**：`apps/web-vue-nuxt/pages/*.vue`、`app.vue`
- **学习要点**：`useSeoMeta({ title, description, ogImage })` 类型安全写法、`useServerSeoMeta` 只在服务端执行、动态路由页根据数据渲染 meta
- **💡 浏览器基础补充**：爬虫（Googlebot）抓取模型、首屏 HTML 中必须包含可索引文字（反对「纯 CSR + 爬虫单独 SSR」的 Prerender 脆弱方案）

### 12.6 状态管理：Pinia + Nuxt 专用持久化（SSR 安全）
- **知识点**：在 Nuxt SSR 安全地使用 Pinia（客户端水合不能污染 Node 内存）
- **对应文件**：`apps/web-vue-nuxt/stores/chat.ts`、`nuxt.config.ts` 模块注册
- **学习要点**：`@pinia/nuxt` 模块、`defineStore` 写法、`useChatStore()` 在 setup 中调用、`persistedstate` 必须加 `storage: persistedState.cookiesWithOptions()` 以保证 SSR/CSR 同源
- **💡 JS 基础补充**：闭包 — Pinia 插件（`$persist`）本质是用闭包把 store 实例和 cookie/localStorage 绑定

### 12.7 路由守卫 + 中间件（middleware）
- **知识点**：全局 / 页面级 / 命名中间件，在 SSR 跳转前做鉴权、埋点、重定向
- **对应文件**：`apps/web-vue-nuxt/middleware/auth.ts`、`pages/xxx.vue` 中的 `definePageMeta({ middleware })`
- **学习要点**：`middleware/auth.ts` 同时在 Node 端（SSR 首跳）和浏览器端（SPA 内跳）执行、`navigateTo` / `abortNavigation`、服务端读取 cookie 用 `useCookie`
- **💡 Node 基础补充**：HTTP 重定向（301/302/307/308）和 Location 头 — SSR 重定向必须在响应头完成，不能等浏览器 JS 执行

### 12.8 Nitro 服务端 API 路由（/server/api/*）
- **知识点**：Nuxt 自带 Nitro HTTP 引擎，可以在同项目内写 `/api/*` 接口（替代 BFF 的一半职责）
- **对应文件**：`apps/web-vue-nuxt/server/api/chat.post.ts`、`server/api/chat/stream.get.ts`
- **学习要点**：`defineEventHandler`、`readBody(event)`、`setHeader(event,'Content-Type','text/event-stream')`、`sendStream`、内部转发到 `apps/server:3001`
- **💡 Node 基础补充**：Node 流（Readable/Writable/Transform） + pipeline — SSE 流式代理必须用 pipeline 处理背压

### 12.9 AI 模块 1（API 基础）在 Nuxt SSR 端落地
- **知识点**：把 `useFetch` + BFF 接口组合，实现 `/m1` 页面的提问 + 非流式回答渲染
- **对应文件**：`apps/web-vue-nuxt/pages/m1.vue`、`composables/useChat.ts`
- **学习要点**：页面加载时不做 SSR 预取（问答是用户触发），但「历史回答列表」用 `useAsyncData` 在 SSR 阶段取；loading/error 用 `<ClientOnly>` + transition 包裹

### 12.10 AI 模块 2（流式 SSE）在 Nuxt SSR 端落地
- **知识点**：客户端 EventSource 消费 Nitro 透传的 SSE 流，实现打字机效果
- **对应文件**：`apps/web-vue-nuxt/pages/m2.vue`、`server/api/chat/stream.get.ts`
- **学习要点**：`onMounted` 后才实例化 EventSource（SSR 阶段无 window）、`ref` 逐字累积、`onBeforeUnmount` 里 `close()`

### 12.11 AI 模块 3/4（Prompt + Chat UI）在 Nuxt SSR 端落地
- **知识点**：Prompt 模板、多轮历史 Token 计数、移动端全屏 Chat 布局 Nuxt 化
- **对应文件**：`apps/web-vue-nuxt/pages/m3.vue`、`pages/m4.vue`、`components/message/*.vue`
- **学习要点**：多会话 ID 用 `useCookie('session_id')` SSR 安全持久化；Markdown 渲染器用 `@vueup/vue-quill` 或 `markdown-it` + Shiki；`useHead` 动态给当前会话改 `<title>`

### 12.12 AI 模块 5（Function Calling）在 Nuxt SSR 端落地
- **知识点**：工具调用链路移到 Nitro server route 执行（前端只拿执行结果和最终回答，工具参数不暴露给浏览器，C 端安全）
- **对应文件**：`apps/web-vue-nuxt/server/api/tools/execute.post.ts`、`pages/m5.vue`
- **学习要点**：前端仅传「用户问题 + 选定工具白名单」，Schema + 实际执行都在 Nitro 内，防篡改；工具调用中间态用 Server-Sent Events 推给前端

### 12.13 AI 模块 6（RAG）在 Nuxt SSR 端落地
- **知识点**：文档上传走 Nitro multipart 路由，转发到 BFF，文档列表在 SSR 阶段预取
- **对应文件**：`apps/web-vue-nuxt/pages/m6.vue`、`server/api/documents/*.ts`
- **学习要点**：`readMultipartFormData(event)` 处理上传、lazy SSR 列表（首屏预取前 20 条，滚动后 client 侧 `useFetch` 加载更多）

### 12.14 AI 模块 7（Agent）在 Nuxt SSR 端落地
- **知识点**：Agent 执行循环在 Nitro 侧，时间线流式推送，支持用户干预
- **对应文件**：`apps/web-vue-nuxt/pages/m7.vue`、`server/api/agent/run.post.ts`
- **学习要点**：Nitro 端维护步骤状态数组，每个 step 完成后推送一个 SSE 事件；干预请求通过独立 route 修改状态

### 12.15 Nuxt 3 部署相关（生产）
- **知识点**：Nitro 预设（node-server / vercel / cloudflare-pages），Node Standalone 部署
- **对应文件**：`nitro.config.ts`（或 nuxt.config.ts#nitro）、`Dockerfile` 草案
- **学习要点**：`NITRO_PRESET=node-server pnpm build` 产物、`.output/server/index.mjs` 单文件启动、静态资源放在 `.output/public`
- **💡 Node 基础补充**：process 对象 + 信号（SIGINT/SIGTERM/SIGUSR1）— 「优雅关闭」的本质就是监听信号执行 `await nitroApp.close()`

### 12.16 性能优化 + 可观测性（C 端必备）
- **知识点**：Nuxt 图片优化、自动拆分 JS、Lighthouse 指标、Web Vitals 上报
- **对应文件**：`nuxt.config.ts#modules`（`@nuxt/image`、`@vite-pwa/nuxt`）、`plugins/web-vitals.client.ts`
- **学习要点**：图片 lazy load / 响应式格式、首屏关键 CSS 内联、`@nuxtjs/web-vitals` 把 CLS/LCP/INP 上报到 BFF；路由级 `definePageMeta({ layoutTransition })` 切页动画
- **💡 浏览器基础补充**：Web Vitals（LCP/CLS/INP 三大核心指标）+ PerformanceObserver API — 这是面试 + 真实项目都绕不开的话题

---

## 模块 13：Electron 桌面端（方案 A · 🔒 预留，当前阶段不开发）

> 🔒 **预留规则**：本模块只记录架构设计与知识点映射，当前阶段**不创建 apps/desktop 目录、不安装 electron 相关依赖、不写入任何实际代码**。等待模块 12（Nuxt 3 SSR 主线）的 7 个 AI 模块全部功能落地完成后，再按本模块进入桌面端开发。
>
> 📌 **采用方案 A（最通用、改动最小）**：Electron =「桌面壳 + 系统能力」，渲染进程直接复用 Nuxt 3 / Vue SPA 的前端产物（开发期 loadURL → :3000；生产期 loadFile 加载静态 build 产物），Electron 侧只写主进程 / preload / IPC 胶水代码，不重写 UI。
>
> 💡 **为什么选方案 A（而不是 B/C）**：
> - 方案 A 对现有 Monorepo 零破坏；前端 UI 代码和 Nuxt 端 100% 共享，不会出现「桌面端一套、Web 一套」的分叉维护
> - 后续想升级方案 B（内置本地 BFF 离线版）只需在主进程内多一个「启动 apps/server Express 实例（随机端口）」的步骤，不影响现有代码结构
> - 方案 C（独立 electron-vite 渲染层）= UI 分叉，学习成本高，不作为默认
>
> 🤖 **AI 场景价值（Electron 桌面端特有）**：桌面端是 7 个 AI 模块的「离线 AI 产品」形态。方案 B（内置 BFF）能把 AI 知识库 RAG 的 embedding 模型 / better-sqlite3 向量检索**全放在用户本地**，用户数据永不离机（企业级 AI 知识库的合规刚需）；Electron 的系统对话框 + 文件系统能做到「选择本地任意目录作为知识库 → 后台增量同步到 SQLite」的纯桌面 AI 产品体验。
>
> 🖥️ **C 端桌面级体验改造**：① 启动时显示 Splash Screen（启动图）+ 初始化内置 BFF（随机端口）完成后再显示主窗口，避免白屏；② 系统托盘：关闭按钮不退出，最小化到托盘，托盘菜单「新建会话 / 显示主窗口 / 检查更新 / 退出」；③ 原生通知：AI Agent 长任务执行完（比如 500 页 PDF 切片 + embedding）发原生系统通知，用户点通知直接回到对应会话；④ 全局快捷键 Ctrl+Alt+J 一键呼出 AI 对话（类似微信桌面端）。
>
> 🧠 **AI + C 端专属面试题（Electron 预留）示例**：
> 1. XSS + 桌面端安全：某 AI 知识库 App 打开了 nodeIntegration:true（方便读本地文件），用户上传了一篇恶意 HTML 文档 → Markdown 渲染 XSS 弹框 → 注入代码 `require('child_process').exec('calc.exe')` 成功执行。请按「安全三件套 + contextBridge 白名单」给一个正确的架构，说明「为什么 Electron 的 XSS = 整台电脑被控制」（浏览器进程隔离对比 Node 主进程权限）。
> 2. 原生依赖 ABI：better-sqlite3 向量知识库在 Node 18 下 `require()` 正常，打包到 Electron 31（内置 Node 20）后启动报「Module version mismatch. Expected 115, Got 108」。请写一段 postinstall 钩子（electron-rebuild）修复说明，结合 `process.versions.modules` 解释 ABI 不匹配的根因（Node 运行时模型）。

### 13.1 Electron 三进程模型（主进程 / 渲染进程 / preload）
- **知识点**：Electron = Node.js 主进程 + Chromium 渲染进程 + preload 桥接层；三类进程职责边界
- **对应文件**：`apps/desktop/electron/main.ts`、`electron/preload.ts`（🔒 预留，暂不创建）
- **学习要点**：主进程管 BrowserWindow / Tray / Menu / 系统 API；渲染进程 = 普通浏览器环境运行 Nuxt/Vue 页面；preload 是唯一允许跨 Node↔Chromium 的桥梁，必须开启 contextIsolation
- **💡 Node 基础补充**：child_process.fork + 进程间通信 IPC — Electron 主 ↔ 渲染 IPC 本质就是「父子进程 IPC + 序列化」
- **💡 JS 基础补充**：结构化克隆算法（structuredClone）— IPC 传输数据时不是 JSON.parse，支持 Date/Map/Set/ArrayBuffer，但不支持函数/类/DOM

### 13.2 安全三件套 + contextBridge 白名单暴露（Electron 第一硬规则）
- **知识点**：`webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }` + `contextBridge.exposeInMainWorld`
- **对应文件**：`apps/desktop/electron/preload.ts`（🔒 预留）
- **学习要点**：**绝对不能**打开 nodeIntegration: true / contextIsolation: false（= XSS 即等于本地文件被删/任意命令执行）；preload 只暴露「有限白名单」的 `electronAPI: { selectFile: () => Promise<...>, saveFile: ... }` 这种纯函数，不直接暴露 ipcRenderer
- **💡 浏览器基础补充**：XSS 进阶（桌面端 XSS 比浏览器严重 10 倍，因为渲染进程被攻破后通过不安全 preload 可以跳到 Node 主进程读本地磁盘）+ CSP 配置 electron-builder 里 Electron CSP header

### 13.3 开发期 vs 生产期加载策略（loadURL :3000 vs loadFile 静态资源）
- **知识点**：dev 环境 `app.isPackaged === false` 时 `win.loadURL('http://localhost:3000')` 直连 Nuxt；prod 环境 `loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))`
- **对应文件**：`apps/desktop/electron/main.ts` → `createWindow()`（🔒 预留）
- **学习要点**：开发期 HMR 全保留（因为加载的就是 Nuxt dev server）；生产打包用 `nuxi generate` 或 `NITRO_PRESET=browser` 生成纯静态 HTML/CSS/JS 放进 electron resources
- **💡 Node 基础补充**：`process.env.NODE_ENV` + `app.isPackaged` + `__dirname` vs `import.meta.url`（ESM 环境 __dirname 不存在，要 `fileURLToPath(new URL('.', import.meta.url))` 构造路径）

### 13.4 IPC 通信：请求-响应模式 + 单向推送模式
- **知识点**：`ipcMain.handle('channel', () => res)` ↔ `ipcRenderer.invoke('channel', args)`（异步请求-响应，推荐）+ `ipcMain.on` ↔ `ipcRenderer.send`（单向）
- **对应文件**：`main.ts` ipc 注册、`preload.ts` contextBridge 封装、`apps/web-vue-nuxt/composables/useDesktopApi.ts`（🔒 预留）
- **学习要点**：用 Composable 把 IPC 包成「像调本地函数」的 `useDesktopApi().selectFile()`，页面层不感知是 Electron IPC 还是 Web File API（方便降级到纯浏览器）
- **💡 JS 基础补充**：Promise 包装回调、Error 跨进程序列化栈丢失问题（需要手动打包成纯对象传回来）

### 13.5 系统对话框：文件选择 / 保存 / 消息框（对接 RAG 本地文档）
- **知识点**：`dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [...] })`、`showSaveDialog`、`showMessageBox`
- **对应文件**：`main.ts` IPC handler `electron:dialog:select-files`（🔒 预留）
- **学习要点**：在 Nuxt 端封装 `useLocalFilePicker()` composable，Electron 环境用 IPC 调原生对话框，Web 环境回退到 `<input type="file" multiple />`；让业务层代码（RAG 上传）完全不用关心环境
- **💡 Node 基础补充**：`fs.createReadStream` + `Buffer` + `path.join` — 用户选了本地文件后，Electron 主进程可以直接读文件路径（浏览器 Web 做不到）

### 13.6 托盘 / 菜单 / 原生通知 / 全局快捷键
- **知识点**：`Tray`（系统托盘图标 + 菜单）、`Menu.setApplicationMenu`（应用菜单）、`Notification`（原生通知）、`globalShortcut.register`（全局快捷键呼出）
- **对应文件**：`main.ts` 初始化阶段 + `app.on('window-all-closed')` 托盘保活（🔒 预留）
- **学习要点**：macOS 点红色关闭按钮 = 隐藏到托盘（不退出），Windows/Linux = 退出，这是常见交互差异；全局快捷键要在 `app.whenReady()` 后注册、`will-quit` 前注销
- **💡 浏览器基础补充**：浏览器的 Notification API 权限模型 vs Electron 原生 Notification（无需权限，直接弹系统级通知）的差异

### 13.7 原生依赖 rebuild：better-sqlite3 匹配 Electron 内置 Node ABI
- **知识点**：Electron 内置的 Node 版本 ≠ 用户本机 Node 版本，`better-sqlite3` 这种 C++ 原生模块需要按 Electron ABI 重新编译
- **对应文件**：`apps/desktop/package.json` 脚本 `postinstall: electron-rebuild -f -w better-sqlite3` + `.npmrc` 配置（🔒 预留）
- **学习要点**：A = Node-API 稳定所以一般不用重建；传统原生模块（用了 V8 API 的）需要 `electron-rebuild`；Windows 下还要有 VS Build Tools、Python 等编译环境
- **💡 Node 基础补充**：原生模块 / N-API / node-gyp / V8 ABI 版本号（process.versions.modules）— 「Module version mismatch」报错的根因就是 ABI 不对

### 13.8 内置 BFF 模式（方案 B 预留）：主进程内启动 Express + 随机端口
- **知识点**：方案 A → 方案 B 的升级路径：主进程 `import { createApp } from '@ai-study/server/src/app'` 直接起 Express，监听 `127.0.0.1:0`（随机端口），退出 app 前 `server.close()`
- **对应文件**：`main.ts` 启动/关闭阶段 + Nuxt 页面 API_BASE 配置改写（🔒 预留）
- **学习要点**：完全离线可用，知识库数据放 `app.getPath('userData') + '/rag.db'`（Electron 标准用户数据目录）；前端请求全走 `127.0.0.1:<随机端口>`，不依赖互联网
- **💡 Node 基础补充**：`http.createServer` + `server.listen(0)` 自动分配随机端口 + `server.address().port` 取端口号；优雅关闭的 before-quit / will-quit / quit 三事件顺序

### 13.9 自动更新（electron-updater）+ 代码签名
- **知识点**：`electron-builder` 的 autoUpdater，从 GitHub Releases / 私有更新服务器拉 `.exe.blockmap` / `.dmg` 做增量更新；Windows 用 EV 代码签名、macOS 用 Developer ID + 公证
- **对应文件**：`main.ts` autoUpdater 事件监听 + `electron-builder.yml` publish 配置（🔒 预留）
- **学习要点**：增量更新 = 只下载 blockmap 差异（通常几十 KB），不用全量重装；未签名安装包 = Windows SmartScreen / macOS Gatekeeper 拦截
- **💡 浏览器基础补充**：HTTPS/TLS 证书链 vs 代码签名证书（前者给域名身份背书，后者给可执行文件身份背书）；散列摘要 + 非对称签名原理

### 13.10 打包 & 分发（electron-builder：nsis exe / dmg / AppImage）
- **知识点**：`electron-builder` 多平台构建产物、NSIS 安装包配置（安装路径、开始菜单、卸载、开机自启）、`asar: true` 把源码打包成单归档防修改、`fileAssociations` 关联后缀
- **对应文件**：`apps/desktop/electron-builder.yml`、根 `pnpm build:desktop` 脚本（🔒 预留）
- **学习要点**：Windows exe 起步 ~70MB（带 Chromium）；macOS 要分 Intel/arm64 或 universal；Linux AppImage 单文件直接跑；Monorepo 下 electron-builder `files:` 字段要包含 `node_modules/@ai-study/shared`（workspace 依赖）
- **💡 Node 基础补充**：package.json `exports` 字段 / ESM 与 CJS 双包兼容（Electron 主进程生态很多库还是 CJS，Nuxt/Vue 是 ESM，打包时会踩到互操作坑）

---

## 基础补充 A：JavaScript 语言（18 个必讲单元）

> 规则：讲解主线知识点时，从本列表挑 1~3 条**强关联**的基础，放到「💡 JS 基础补充」小节，不可跳过。

### A.1 执行上下文栈（Call Stack）+ 词法环境 + 作用域链
- **关联主线**：所有闭包 / 递归 / 自定义 Hook / Composables 讲解
- **内容要点**：EC 三段（VO/AO + Scope Chain + this）、LHS/RHS 查询、let/const 暂时性死区（TDZ）

### A.2 闭包（Closure）本质 & 4 类经典场景
- **关联主线**：Pinia / Redux 插件、useChat Hook、AbortController 超时闭包
- **内容要点**：外层函数执行完毕但内部函数引用它的变量 → 变量逃逸、柯里化、防抖节流、立即执行函数 IIFE 模块化

### A.3 this 指向的 5 条规则（默认 / 隐式 / 显式 / new / 箭头）
- **关联主线**：事件回调、Vue options API、React 类组件（对照）
- **内容要点**：`call/apply/bind` 手写、箭头函数的 this 是「定义时外层 this」且无法被 bind 改

### A.4 原型链（Prototype Chain）+ Class 语法糖拆解
- **关联主线**：Vue 组件实例、Error 子类化（AiApiError extends Error）
- **内容要点**：`__proto__` vs `prototype`、`new Foo()` 四步、`Object.create(null)`、`instanceof` 原理

### A.5 事件循环（Event Loop）宏任务 / 微任务顺序
- **关联主线**：流式响应、setState 批处理、nextTick、任何 async-await
- **内容要点**：浏览器 3 步（执行栈 → 微任务清空 → 宏任务取一个）+ Node 6 阶段 + 差异图、`async function` 返回 Promise 的时机

### A.6 Promise 状态机 + 手写 Promise A+
- **关联主线**：fetch 封装、工具执行器 executor、并发请求
- **内容要点**：Pending→Fulfilled/Rejected 不可逆、`.then` 返回新 Promise（链式）、`Promise.all/race/allSettled/any` 四兄弟场景

### A.7 async-await 语法糖的编译产物（Generator + Promise）
- **关联主线**：所有 SSR 数据预取、BFF 接口、流式读循环
- **内容要点**：`function*` + `yield` + 自动执行器、`await` 后面非 Promise 也会被 `Promise.resolve()` 包裹

### A.8 类型系统：typeof / instanceof / toString 四种类型判断
- **关联主线**：TS 类型守卫、工具参数校验、Embedding 响应字段
- **内容要点**：typeof 的 7 个返回值 + null bug、`Object.prototype.toString.call(x).slice(8,-1)`、手写 `deepClone` 时对 Set/Map/Date/RegExp 的分支

### A.9 隐式类型转换（== vs === + ToPrimitive）
- **关联主线**：面试题、表单值（string ↔ number）、路由参数 `:id` 比较
- **内容要点**：`a==[]`、`a==!a` 经典题拆解、`Symbol.toPrimitive / valueOf / toString` 优先级

### A.10 TS 类型收窄（Narrowing）的 6 种方式
- **关联主线**：SSE 解析、工具调用参数解析、ChatMessage.role 联合类型
- **内容要点**：typeof / instanceof / in / 字面量相等 / is 类型谓词 / satisfies 操作符；`as const` 固化元组

### A.11 模块化：ESM vs CJS 全对比
- **关联主线**：monorepo package.json `type:module`、Server 端 ESM 下 `__dirname` 问题
- **内容要点**：`require` 同步加载 vs `import` 静态分析 / 动态 `import()`、`exports` 字段条件导出、循环加载差异

### A.12 Object 引用 vs 原始值 + 浅拷贝深拷贝
- **关联主线**：Redux/Pinia 不可变更新、messages 数组追加、会话历史深拷贝回退
- **内容要点**：栈 vs 堆、`Object.assign / { ...x }` 是浅拷贝、`structuredClone` 原生深拷贝 vs JSON 序列化法（无法处理函数/Symbol/undefined/Circular）

### A.13 Proxy & Reflect 响应式原理
- **关联主线**：Vue3 ref/reactive 本质、Pinia store；对比 React setState
- **内容要点**：`new Proxy(target, { get, set, deleteProperty })`、依赖收集 track() / 触发 trigger()、`Reflect.get/set` 配合 receiver 修正 this

### A.14 迭代器（Iterator）与生成器（Generator）
- **关联主线**：ReadableStream 的 `[Symbol.asyncIterator]`、for-await-of 流式消费
- **内容要点**：`[Symbol.iterator]()` 协议（next() 必须返回 `{value,done}`）、`function*` 可中断、`yield*` 委托、`for...of` vs `for await...of`

### A.15 标准内置对象：Map / Set / WeakMap / WeakSet
- **关联主线**：会话 Map 缓存、去重、Pinia 状态关联表
- **内容要点**：Map vs Object 何时用、WeakMap 键是弱引用（GC 不计数 → 不内存泄漏）+ 只能存对象、典型应用「DOM 节点元数据」「私有属性 polyfill」

### A.16 Array 高阶函数：map / filter / reduce 原理 + 手写
- **关联主线**：messages 过滤展示、Token 计数 reduce、chunks 向量化 batch
- **内容要点**：reduce( fn(acc,curr,i,arr), init ) 万能转换、手写 `Array.prototype.map`、数组空位 `[,,,]` 遍历行为

### A.17 字符串 / 数字 / 日期常用 API + 正则入门
- **关联主线**：SSE 按行分割、Markdown 代码块匹配、时间戳格式化
- **内容要点**：`split(/\r?\n/)`、正则修饰符 g / i / s、`(?:xxx)` 非捕获组、`Date.now()` vs `new Date().toISOString()`

### A.18 错误处理：Error 子类化 + try-catch 边界 + 全局兜底
- **关联主线**：BFF 错误映射、fetch AbortError 分类、UI 错误边界（React ErrorBoundary / Vue errorCaptured）
- **内容要点**：`class AiApiError extends Error { constructor(code,msg){ super(msg); this.name='AiApiError'; this.code=code } }`、`err instanceof AiApiError` 分支、浏览器 `window.onerror / unhandledrejection`

---

## 基础补充 B：浏览器原理（14 个必讲单元）

> 规则：讲解到前端主线知识点时，从本列表挑强关联的 1~2 条，放到「💡 浏览器基础补充」小节。

### B.1 浏览器渲染流水线：HTML→DOM + CSS→CSSOM → Render Tree → Layout → Paint → Composite
- **关联主线**：所有 UI 组件、Tailwind 类重排重绘、动画选择 transform 而非 top

### B.2 重绘（Repaint） vs 回流/重排（Reflow / Layout） & 性能优化
- **关联主线**：聊天自动滚动、消息气泡动画、输入高度自适应
- **内容要点**：触发 reflow 的 7 类 DOM 操作、`display:none` vs `visibility:hidden` vs `opacity:0`、用 `documentFragment` / `classList` 批量更新、`will-change: transform` 提升合成层

### B.3 事件模型：捕获 → 目标 → 冒泡三阶段 + addEventListener 参数
- **关联主线**：消息点击、停止按钮、移动端 tap 冲突
- **内容要点**：`addEventListener(type,fn,{capture,passive,once})`、passive=true 解决 touch 滚动卡顿、事件委托（ul 上监听 li 点击）

### B.4 Cookie / LocalStorage / SessionStorage / IndexedDB 对比 & 安全
- **关联主线**：会话持久化、Nuxt SSR cookie、Pinia 持久化
- **内容要点**：Cookie 4 个安全属性（HttpOnly / Secure / SameSite / Domain-Path）、XSS vs CSRF 防护原理

### B.5 跨域：同源策略 + 6 种跨域方案原理对比
- **关联主线**：BFF CORS 配置、API 代理、SSR 同域部署
- **内容要点**：CORS 简单/预检请求（OPTIONS）、Access-Control-Allow-Credentials + 前端 `credentials:include`、JSONP（仅 GET）、postMessage、Nginx / Vite devServer 反向代理、SSR 同域彻底消灭跨域

### B.6 HTTP 1.1 / 2 / 3 核心差异 + 队头阻塞（HOL Blocking）
- **关联主线**：SSE 多路复用、流式接口、CDN 缓存
- **内容要点**：H/1.1 同域 6 连接 + 管道化缺陷、H/2 二进制分帧 + HPACK + 多路复用（单 TCP 仍有 HOL）、H/3 QUIC（UDP 每个流独立）

### B.7 TCP 三次握手 / 四次挥手 + TLS 1.3 握手
- **关联主线**：fetch 网络异常、AbortController 断连、HTTPS 证书报错
- **内容要点**：SYN / SYN+ACK / ACK、TIME_WAIT（2MSL）、TLS 1.3 1-RTT、0-RTT 重放风险

### B.8 缓存体系：强缓存 / 协商缓存 / Service Worker / CDN
- **关联主线**：Vite build 的 hash 文件名、SSR 页面 Cache-Control、图片/静态资源
- **内容要点**：`Cache-Control: max-age + immutable` 强缓存、`ETag/If-None-Match`、`Last-Modified/If-Modified-Since` 协商缓存、Service Worker CacheStorage 离线方案、CDN 回源 + 边缘缓存

### B.9 DOM 查询与性能：`querySelectorAll` vs `getElementsBy*`、回流触发
- **关联主线**：消息列表 DOM 操作、滚动到底部 IntersectionObserver
- **内容要点**：NodeList（静态）vs HTMLCollection（实时集合）、避免在 `scroll/resize` 事件读 offsetTop（会强制同步布局 FSL）

### B.10 定时器：setTimeout / setInterval / requestAnimationFrame / requestIdleCallback
- **关联主线**：请求超时、打字机效果、自动滚动、Token 计数 debounce
- **内容要点**：`setTimeout(0)` 不准（最小延迟 4ms 规范）、rAF 跟随显示器刷新率（16.6ms / 60Hz）、节流（throttle）防抖（debounce）手写 + 时间戳 vs 定时器两种实现

### B.11 Observer 家族：Intersection / Mutation / Resize / Performance
- **关联主线**：懒加载、引用卡片展开动画、聊天窗口尺寸自适应
- **内容要点**：`new IntersectionObserver(cb,{threshold})` 实现无限滚动 + 图片懒加载；MutationObserver 替代废弃的 DOMAttrModified

### B.12 History API / Hash 路由 / H5 pushState
- **关联主线**：Vue Router 两种模式、React Router 两种模式、Nuxt SSR 必须用 history 模式
- **内容要点**：`history.pushState/replaceState/popstate` 不刷新加 URL、hashchange、SSR 首屏必须匹配当前路径（否则 Hydration 404）

### B.13 Web Vitals：LCP / CLS / INP（FID 已淘汰）
- **关联主线**：任何 C 端页面性能优化、Nuxt 12.16 性能优化模块
- **内容要点**：三个核心指标定义 + 合格线（LCP<2.5s、CLS<0.1、INP<200ms）、`PerformanceObserver` API 采样上报

### B.14 浏览器安全：XSS / CSRF / CSP / Sandbox / HSTS
- **关联主线**：Markdown 用户生成内容（UGC）渲染、AI API 输入内容过滤、iframe 嵌入
- **内容要点**：反射型/存储型/DOM型 XSS → CSP 白名单 + 输入 HTML 转义；CSRF → SameSite=Lax/Strict + CSRF Token；HSTS 强制 HTTPS

---

## 基础补充 C：Node.js 运行时（16 个必讲单元）

> 规则：讲解到服务端 / BFF / SSR / 构建工具主线知识点时，从本列表挑强关联的 1~2 条，放到「💡 Node 基础补充」小节。

### C.1 Node 事件循环 6 阶段详解 & 与浏览器的差异
- **关联主线**：Server express 中间件执行顺序、Nitro 异步预取并发
- **内容要点**：timers → pending callbacks → idle/prepare → poll（阻塞等待 IO）→ check（setImmediate）→ close callbacks；微任务（nextTick 队列优先于 Promise 微任务）在每个阶段切换之间全部清空

### C.2 process 对象：argv / env / cwd / exit / 信号监听
- **关联主线**：dotenv、端口 PORT 环境变量、优雅关闭
- **内容要点**：`process.env.NODE_ENV`、`process.exitCode=14` vs `process.exit(14)`、`process.on('SIGTERM', gracefulShutdown)`

### C.3 模块系统：require 加载机制（路径解析 + 缓存 + JSON/原生扩展）
- **关联主线**：apps/server CommonJS vs ESM 迁移、monorepo workspace symlink 加载
- **内容要点**：`require('x')` → 核心模块 / node_modules（逐级向上）；JSON 文件会被 `JSON.parse`；缓存键是**绝对路径**（所以 monorepo hoisting 容易出现版本双实例）

### C.4 Node ESM：import.meta.url / fileURLToPath / node: 前缀 / package.json exports
- **关联主线**：Server 端用 ESM 时 `__dirname` 不存在、pdf-parse 动态 import、shared 包 dual publish
- **内容要点**：`const __dirname = path.dirname(fileURLToPath(import.meta.url))`、`node:fs` 前缀区分内置 vs 用户模块、`exports` 条件导出 `import`/`require`/`types`/`node`/`default`

### C.5 内置模块 fs：同步 / 异步回调 / Promise API / createReadStream
- **关联主线**：文档上传存储、db sqlite 文件、日志写入
- **内容要点**：`fs.readFileSync` 阻塞事件循环 → 尽量 `fs/promises.readFile`；大文件必须 `createReadStream`（按 64KB chunks 读，占用内存恒定）；`fs.createWriteStream` + backpressure 背压

### C.6 内置模块 path / url / querystring / crypto
- **关联主线**：uploads 路径拼接、URL 解析、URL SearchParams、API key HMAC 校验
- **内容要点**：`path.join` vs `path.resolve` 区别（后者从根开始算绝对路径）、`new URL('/api/chat', base)` 替代字符串拼接

### C.7 内置模块 http / https：原生 req/res 对象 + Express 中间件原理
- **关联主线**：BFF API、Nitro http server、CORS 中间件
- **内容要点**：`http.createServer((req,res)=>{...})` 回调每次请求触发一次、Express 中间件就是 `(req,res,next)=>{...}` 的数组，按顺序 `next()` 传下去，错误处理 4 参数 `(err,req,res,next)`

### C.8 流（Stream）：Readable / Writable / Duplex / Transform + pipeline
- **关联主线**：SSE 流式转发、上传文件数据流、pdf 解析、SSR HTML 流式输出
- **内容要点**：流是 Node 处理大数据的唯一「正确姿势」；4 类流区别、`.pipe()` 缺点（错误不会自动清理资源）→ 用 `stream.pipeline([rs, transform, ws], cb)` 兜底 + 自动 destroy

### C.9 子进程 child_process：exec / execFile / spawn / fork
- **关联主线**：pnpm 子命令、Vite/esbuild 子进程、调用 Python 向量化脚本（学习延伸）
- **内容要点**：exec 用 shell 包裹（危险）、execFile 直接执行（无 shell、安全）、spawn 流式 stdout、fork 是 `spawn(node, [script], {stdio:'ipc'})` 自带 IPC 通道

### C.10 进程并发：cluster（多进程） vs worker_threads（多线程）
- **关联主线**：Node 服务端多核利用、Nitro 生产 preset cluster
- **内容要点**：Node 默认单线程（JS 层单线程，libuv 有线程池做 IO），cluster 是「多进程 + 负载均衡」适合 CPU 密集；worker_threads 共享内存（SharedArrayBuffer）适合传大数组，比如 embedding 计算

### C.11 线程池（libuv）+ 异步 IO 模型
- **关联主线**：better-sqlite3 阻塞 VS sqlite3 异步、文件 IO、dns.lookup
- **内容要点**：libuv 默认 4 个线程（可调 `UV_THREADPOOL_SIZE`），Node 异步 IO = 「主线程交给线程池 → 线程池阻塞干活 → 完成后塞 poll 阶段事件队列 → 主线程取回调执行」

### C.12 内存模型 + GC + 内存泄漏排查
- **关联主线**：BFF 内存会话 Map 增长、SSE 连接不释放、长连接服务
- **内容要点**：新生代（Scavenge）/ 老生代（Mark-Sweep & Mark-Compact）分代 GC；泄漏 4 种典型：全局变量 / 闭包 / 事件监听未解绑 / 定时器未清；排查用 `node --inspect` + Chrome DevTools Memory 拍 Heap Snapshot 对比

### C.13 环境变量与配置：dotenv / cross-env / zod 校验
- **关联主线**：Server/Nuxt .env、AI_API_KEY 安全、生产部署 secrets
- **内容要点**：`.env.local` 覆盖 `.env`；不要把 secrets 打进前端 bundle（VITE_ 前缀会暴露）；生产用 `z.object({ PORT: z.coerce.number() }).parse(process.env)` 启动时强校验，缺字段直接炸

### C.14 错误监控与日志：uncaughtException / unhandledRejection / pino 结构化日志
- **关联主线**：BFF logger 中间件、线上 AI 请求失败可回溯
- **内容要点**：同步抛错 → `uncaughtException`；Promise reject 无 `.catch` → `unhandledRejection`；日志必须 JSON 结构化（`{level,time,reqId,msg,err}`）+ `traceId` 贯穿 request 全链路

### C.15 性能分析：--prof / --inspect / clinic.js / 0x 火焰图
- **关联主线**：BFF 接口慢、流式响应卡顿、构建慢
- **内容要点**：`node --prof app.js` 生成 v8.log → `node --prof-process isolate-v8.log > processed.txt` 读热点；`0x app.js` 压测出交互式火焰图 SVG；clinic.js 三件套（doctor / flame / bubbleprof）

### C.16 部署与进程管理：pm2 / systemd / Docker 健康检查
- **关联主线**：Nuxt node-server + Express BFF 生产部署
- **内容要点**：pm2 集群模式 `pm2 start ecosystem.config.cjs -i max` 自动占满 CPU；Dockerfile 必须 `EXPOSE`、`HEALTHCHECK --interval=5s CMD node healthcheck.js`、非 root 用户运行 + dumb-init 收僵尸进程
