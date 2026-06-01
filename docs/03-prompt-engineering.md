# 模块 3：Prompt 工程

## 学习目标

- 理解 System Prompt 的作用和设计原则
- 掌握 Prompt 模板化技巧
- 实现多轮对话的上下文管理
- 学会控制输出格式（JSON Mode、结构化输出）

## 知识点

### 3.1 消息角色与职责

| 角色 | 作用 | 示例 |
|------|------|------|
| system | 设定 AI 的行为规则和人设 | "你是一个前端技术专家..." |
| user | 用户的输入 | "解释一下 React hooks" |
| assistant | AI 的回复（历史） | 用于维持上下文 |

### 3.2 System Prompt 设计原则

1. **明确角色**：告诉模型它是谁
2. **限定范围**：规定能做什么、不能做什么
3. **输出格式**：指定回复的格式要求
4. **示例引导**：给出 few-shot 示例

```typescript
const systemPrompt = `你是一个前端技术助手。
规则：
1. 只回答前端相关问题
2. 代码示例使用 TypeScript
3. 回答简洁，不超过 200 字
4. 如果不确定，明确说明`
```

### 3.3 上下文管理策略

- **滑动窗口**：只保留最近 N 轮对话
- **Token 预算**：计算 token 数，超出时裁剪早期消息
- **摘要压缩**：让模型总结历史对话，替代原始消息
- **重要消息标记**：关键信息始终保留

### 3.4 结构化输出

```typescript
// 要求模型返回 JSON
const messages = [
  { role: 'system', content: '以 JSON 格式回复，包含 title 和 summary 字段' },
  { role: 'user', content: '总结 React 18 的新特性' }
]

// 使用 response_format 参数
const params = {
  model: 'gpt-4o',
  messages,
  response_format: { type: 'json_object' }
}
```

## 实践任务

### 任务 1：Prompt 模板系统

- 创建可切换的 System Prompt 预设（翻译助手、代码审查、写作助手等）
- 支持用户自定义 System Prompt
- 实时预览 Prompt 效果

### 任务 2：上下文管理

- 实现多轮对话，维护消息历史
- 添加 Token 计数显示
- 实现滑动窗口策略（保留最近 10 轮）

### 任务 3：结构化输出

- 让模型返回 JSON 格式数据
- 前端解析 JSON 并以卡片/表格形式展示
- 处理 JSON 解析失败的情况

## 参考代码结构

```
src/
├── modules/
│   └── 03-prompt/
│       ├── PromptLab.tsx       # Prompt 实验页面
│       ├── presets.ts          # Prompt 预设模板
│       ├── useConversation.ts  # 多轮对话管理
│       ├── tokenCounter.ts    # Token 计数工具
│       └── JsonRenderer.tsx    # JSON 结果渲染
```

## 检验标准

- [ ] 能设计有效的 System Prompt
- [ ] 实现多轮对话上下文管理
- [ ] 理解 Token 限制和裁剪策略
- [ ] 能让模型输出结构化数据并正确解析
