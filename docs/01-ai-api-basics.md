# 模块 1：AI API 基础调用

## 学习目标

- 理解大模型 API 的请求/响应结构
- 从前端发起 AI API 调用并展示结果
- 掌握 API Key 安全管理方案
- 处理常见错误和边界情况

## 知识点

### 1.1 大模型 API 基本概念

- **Chat Completions API**: 最常用的对话接口
- **消息角色**: system / user / assistant
- **核心参数**: model、messages、temperature、max_tokens
- **计费方式**: Token 计算（输入 + 输出）

### 1.2 请求结构

```typescript
// 典型的 Chat Completions 请求体
interface ChatRequest {
  model: string           // 模型名称，如 "gpt-4o"
  messages: Message[]     // 消息列表
  temperature?: number    // 0-2，越高越随机
  max_tokens?: number     // 最大输出 token 数
}

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}
```

### 1.3 API Key 安全

前端直接暴露 API Key 是危险的，常见方案：

1. **BFF 代理层**（推荐）：前端请求自己的后端，后端转发到 AI 服务
2. **环境变量 + 服务端渲染**：Next.js 等框架的 API Routes
3. **开发阶段**：使用 `.env` 文件 + Vite 环境变量（仅限本地开发）

### 1.4 错误处理

- 429: 速率限制 → 实现重试/退避
- 401: Key 无效 → 提示用户检查配置
- 500: 服务端错误 → 友好提示 + 重试
- 网络超时 → AbortController 控制

## 实践任务

### 任务 1：基础调用

创建一个简单页面：
- 输入框让用户输入问题
- 点击按钮调用 AI API
- 展示返回结果

### 任务 2：环境变量管理

- 使用 `.env.local` 存储 API Key
- 通过 Vite 的 `import.meta.env` 读取
- 添加 `.env.local` 到 `.gitignore`

### 任务 3：错误处理

- 实现请求 loading 状态
- 处理网络错误和 API 错误
- 添加请求超时控制（AbortController）

## 参考代码结构

```
src/
├── modules/
│   └── 01-api-basics/
│       ├── ApiBasics.tsx      # 主页面组件
│       ├── useChat.ts         # 封装 API 调用的 Hook
│       └── types.ts           # 类型定义
```

## 检验标准

- [ ] 能成功调用 AI API 并获取响应
- [ ] API Key 不会出现在前端代码中（生产环境）
- [ ] 有 loading 状态和错误提示
- [ ] 理解 Token 的概念和计费方式
