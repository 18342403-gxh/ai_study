# 模块 2：流式响应

## 学习目标

- 理解 SSE（Server-Sent Events）协议
- 使用 ReadableStream 处理流式数据
- 实现打字机效果的逐字输出
- 对比流式与非流式的用户体验差异

## 知识点

### 2.1 为什么需要流式响应

- 大模型生成较慢（几秒到几十秒）
- 非流式：用户等待全部生成完才能看到结果
- 流式：边生成边展示，体验更好（类似 ChatGPT）

### 2.2 SSE 协议基础

```
// SSE 数据格式
data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"你"}}]}

data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"好"}}]}

data: [DONE]
```

- 每行以 `data: ` 开头
- 以 `data: [DONE]` 标记结束
- 每个 chunk 包含增量内容（delta）

### 2.3 前端处理流式响应

```typescript
// 核心：使用 fetch + ReadableStream
const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...params, stream: true }),
})

const reader = response.body!.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  
  const chunk = decoder.decode(value)
  // 解析 SSE 格式，提取 content
}
```

### 2.4 流式状态管理

- 需要维护「正在生成」的状态
- 逐步拼接文本内容
- 支持中断生成（AbortController）

## 实践任务

### 任务 1：基础流式输出

- 调用 API 时设置 `stream: true`
- 解析 SSE 格式的响应数据
- 逐字展示在页面上

### 任务 2：打字机效果优化

- 添加光标闪烁动画
- 控制渲染频率（避免过于频繁的 setState）
- 自动滚动到底部

### 任务 3：中断控制

- 添加「停止生成」按钮
- 使用 AbortController 中断请求
- 保留已生成的内容

## 参考代码结构

```
src/
├── modules/
│   └── 02-streaming/
│       ├── Streaming.tsx       # 主页面
│       ├── useStreaming.ts     # 流式请求 Hook
│       ├── parseSSE.ts        # SSE 解析工具
│       └── Cursor.tsx          # 光标动画组件
```

## 检验标准

- [ ] 实现逐字输出效果
- [ ] 能正确解析 SSE 格式数据
- [ ] 支持中断生成
- [ ] 理解 ReadableStream API 的工作原理
