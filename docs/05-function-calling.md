# 模块 5：Function Calling

## 学习目标

- 理解 Function Calling（工具调用）的机制
- 定义工具 Schema 并让模型调用
- 前端处理工具调用结果并展示
- 实现多步工具调用链

## 知识点

### 5.1 什么是 Function Calling

让大模型不仅能生成文本，还能「调用工具」：
- 模型根据用户意图，决定调用哪个工具
- 返回工具名称和参数（JSON）
- 前端/后端执行工具，将结果返回给模型
- 模型基于工具结果生成最终回复

### 5.2 工具定义

```typescript
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '获取指定城市的天气信息',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市名称' },
          unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
        },
        required: ['city']
      }
    }
  }
]
```

### 5.3 调用流程

```
用户输入 → 模型判断是否需要工具
                    ↓ 是
          返回 tool_calls（工具名 + 参数）
                    ↓
          前端/后端执行工具函数
                    ↓
          将工具结果作为 tool message 发回
                    ↓
          模型基于结果生成最终回复
```

### 5.4 前端展示策略

- 工具调用中：显示「正在查询天气...」
- 工具结果：以卡片形式展示（天气卡片、搜索结果等）
- 最终回复：模型整合工具结果的自然语言回复

## 实践任务

### 任务 1：基础工具调用

- 定义 2-3 个简单工具（天气、计算器、翻译）
- 实现工具调用的完整流程
- 展示工具调用过程（调用中 → 结果）

### 任务 2：工具结果可视化

- 为不同工具设计不同的结果卡片
- 天气 → 天气卡片
- 计算 → 公式展示
- 搜索 → 结果列表

### 任务 3：多步调用

- 实现需要多次工具调用的场景
- 展示调用链的过程
- 处理工具调用失败的情况

## 参考代码结构

```
src/
├── modules/
│   └── 05-function-calling/
│       ├── FunctionCallingPage.tsx  # 主页面
│       ├── tools/
│       │   ├── definitions.ts      # 工具 Schema 定义
│       │   ├── executor.ts         # 工具执行器
│       │   └── weather.ts          # 天气工具实现
│       ├── ToolCallCard.tsx         # 工具调用展示卡片
│       └── useToolChat.ts          # 带工具调用的聊天 Hook
```

## 检验标准

- [ ] 能正确定义工具 Schema
- [ ] 模型能根据用户意图选择合适的工具
- [ ] 工具调用过程有清晰的 UI 反馈
- [ ] 理解多步调用的消息流转
