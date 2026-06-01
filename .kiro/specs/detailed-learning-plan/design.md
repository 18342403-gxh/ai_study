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

| 用途 | 选择 | 理由 |
|------|------|------|
| 框架 | React 18 + TypeScript | 项目已有 |
| 构建 | Vite | 项目已有 |
| 样式 | Tailwind CSS | 移动端优先的 utility-first 方案 |
| 路由 | React Router v6 | 轻量、支持懒加载 |
| 状态 | zustand | 轻量、无 Provider 包裹 |
| Markdown | react-markdown + rehype-highlight | 成熟方案 |
| 代码高亮 | highlight.js（通过 rehype） | 体积小、语言覆盖全 |

## 开发顺序

1. **Phase 0**：项目基础设施（路由、布局、Tab 导航、面试题组件）
2. **Phase 1**：模块 1 + 模块 2（API 基础 + 流式）
3. **Phase 2**：模块 3 + 模块 4（Prompt + 聊天界面）
4. **Phase 3**：模块 5（Function Calling）
5. **Phase 4**：模块 6 + 模块 7（RAG + Agent）
6. **Phase 5**：面试题数据填充 + 整体联调
