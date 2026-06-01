# 🤖 AI Frontend Lab

从前端角度学习 AI 应用开发的实践项目。

## 技术栈

- React 18 + TypeScript
- Vite
- 后续按需引入：OpenAI SDK、Vercel AI SDK 等

## 快速开始

```bash
npm install
npm run dev
```

## 学习路线

| 模块 | 主题 | 核心知识点 |
|------|------|-----------|
| 1 | 调用 AI API | fetch 请求、API Key 管理、错误处理 |
| 2 | 流式响应 | SSE、ReadableStream、逐字输出 |
| 3 | Prompt 工程 | System Prompt、模板设计、上下文管理 |
| 4 | 聊天界面 | 消息列表、Markdown 渲染、代码高亮 |
| 5 | Function Calling | 工具定义、前端调用链、结果展示 |
| 6 | RAG 集成 | 文档上传、向量搜索、引用展示 |
| 7 | AI Agent | 多步推理、工具编排、状态可视化 |

## 推荐资源

- [OpenAI API 文档](https://platform.openai.com/docs)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)
- [LangChain.js](https://js.langchain.com)

## 项目结构

```
ai-frontend-lab/
├── src/
│   ├── main.tsx          # 入口文件
│   ├── App.tsx           # 主应用组件
│   └── vite-env.d.ts     # Vite 类型声明
├── index.html            # HTML 模板
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

后续每个学习模块会在 `src/` 下创建对应目录，逐步扩展。
