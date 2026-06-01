# 模块 7：AI Agent 前端交互

## 学习目标

- 理解 AI Agent 的核心概念（规划、执行、观察循环）
- 实现多步推理过程的前端可视化
- 构建 Agent 工作流的交互界面
- 处理 Agent 的中间状态和用户干预

## 知识点

### 7.1 Agent 与普通对话的区别

| 对比 | 普通对话 | Agent |
|------|---------|-------|
| 交互轮次 | 一问一答 | 多步自主执行 |
| 工具使用 | 可选 | 核心能力 |
| 决策 | 用户驱动 | 模型自主规划 |
| 状态 | 无状态 | 有执行状态链 |

### 7.2 Agent 执行循环

```
Think（思考）→ Act（行动）→ Observe（观察）→ 循环直到完成
```

### 7.3 前端需要展示的信息

- **思考过程**：模型的推理链（Chain of Thought）
- **工具调用**：调用了什么工具、参数是什么
- **执行结果**：每步的返回结果
- **最终输出**：综合所有步骤的最终回答
- **执行状态**：进行中 / 等待用户确认 / 完成 / 失败

### 7.4 状态可视化方案

```typescript
interface AgentStep {
  id: string
  type: 'thinking' | 'tool_call' | 'tool_result' | 'final_answer'
  content: string
  status: 'running' | 'completed' | 'failed'
  timestamp: number
}
```

展示方式：
- 时间线/步骤条
- 折叠面板（展开查看详情）
- 实时更新动画

## 实践任务

### 任务 1：Agent 执行可视化

- 展示 Agent 的思考-行动-观察循环
- 每一步用卡片/时间线展示
- 实时更新执行状态

### 任务 2：用户干预机制

- 在关键步骤暂停，等待用户确认
- 用户可以修改 Agent 的下一步计划
- 支持中断和回退

### 任务 3：多 Agent 协作（进阶）

- 展示多个 Agent 的协作过程
- 消息在 Agent 之间的流转
- 最终结果的汇总展示

## 参考代码结构

```
src/
├── modules/
│   └── 07-agent/
│       ├── AgentPage.tsx        # Agent 主页面
│       ├── AgentTimeline.tsx    # 执行时间线
│       ├── StepCard.tsx         # 步骤卡片
│       ├── ThinkingBubble.tsx   # 思考过程展示
│       ├── useAgent.ts          # Agent 执行 Hook
│       └── types.ts             # Agent 类型定义
```

## 检验标准

- [ ] 理解 Agent 的 Think-Act-Observe 循环
- [ ] 能可视化展示 Agent 的多步执行过程
- [ ] 支持用户在执行中干预
- [ ] 状态管理清晰，UI 实时更新
