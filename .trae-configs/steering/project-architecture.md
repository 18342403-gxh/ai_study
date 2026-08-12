# 项目架构规范

本项目是一个前端 AI 应用开发学习项目，以移动端 Web 为呈现形式。

## 目录结构

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
│   │   ├── 01-api-basics/        # 模块1: AI API 基础调用
│   │   ├── 02-streaming/         # 模块2: 流式响应
│   │   ├── 03-prompt/            # 模块3: Prompt 工程
│   │   ├── 04-chat-ui/           # 模块4: 聊天界面
│   │   ├── 05-function-calling/  # 模块5: Function Calling
│   │   ├── 06-rag/              # 模块6: RAG 前端集成
│   │   └── 07-agent/            # 模块7: AI Agent 交互
│   └── data/
│       └── interview-questions.ts # 面试题数据
├── docs/                         # 学习文档（只读参考）
├── .kiro/                        # Kiro 编辑器配置（只读）
└── .trae-configs/                # Trae 使用的项目配置
    ├── steering/                 # 项目规则
    └── specs/                    # 功能规范
```

## 技术栈

| 用途 | 选择 |
|------|------|
| 框架 | React 18 + TypeScript |
| 构建 | Vite 5 |
| 样式 | Tailwind CSS（移动优先） |
| 路由 | React Router v6（懒加载） |
| 状态 | Redux Toolkit (@reduxjs/toolkit + react-redux) |
| Markdown | react-markdown + rehype-highlight |
| 代码高亮 | highlight.js |

## 路由规则

```typescript
const routes = [
  { path: '/', element: <Home /> },
  { path: '/m1', element: <ApiBasics /> },
  { path: '/m2', element: <Streaming /> },
  { path: '/m3', element: <PromptLab /> },
  { path: '/m4', element: <ChatPage /> },
  { path: '/m5', element: <FunctionCalling /> },
  { path: '/m6', element: <RagPage /> },
  { path: '/m7', element: <AgentPage /> },
]
```

## 模块内文件命名约定

每个模块目录下的文件遵循以下命名：
- `XxxPage.tsx` 或 `Xxx.tsx` — 模块主页面组件
- `useXxx.ts` — 自定义 Hook
- `types.ts` — 类型定义
- `*.tsx` — UI 子组件
- `*.ts` — 工具函数/数据

## AI API 调用规范

所有 AI API 调用统一通过 `src/services/ai.ts` 封装：
- 基础 URL 从环境变量读取：`import.meta.env.VITE_AI_API_URL`
- API Key 从环境变量读取：`import.meta.env.VITE_AI_API_KEY`
- 统一错误处理和类型定义
- 各模块的 Hook 调用 services 层，不直接 fetch
