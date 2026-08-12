# 面试题规范

## 面试题数据结构

```typescript
interface InterviewQuestion {
  id: string                          // 格式："模块.知识点-q序号"，如 "1.3-q1"
  moduleId: number                    // 所属模块 1-7
  knowledgePointId: string            // 关联知识点，如 "1.3"
  difficulty: 'junior' | 'mid' | 'senior'
  category: 'principle' | 'coding' | 'design'
  question: string                    // 题目（中文）
  answerPoints: string[]              // 答案要点（3-6 条）
  relatedCode?: string                // 关联代码文件路径（可选）
}
```

## 面试题类型说明

| 类型 | 说明 | 示例 |
|------|------|------|
| principle | 原理理解，考察概念和机制 | "SSE 和 WebSocket 的区别" |
| coding | 代码实现，考察动手能力 | "手写 ReadableStream 消费逻辑" |
| design | 场景设计，考察架构思维 | "如何设计一个支持多轮对话的上下文管理方案" |

## 难度标准

| 难度 | 对应面试级别 | 特征 |
|------|-------------|------|
| junior | 1-3 年经验 | 基础概念、API 使用、简单实现 |
| mid | 3-5 年经验 | 原理深入、性能优化、方案对比 |
| senior | 5+ 年经验 | 架构设计、边界处理、生产级考量 |

## 答案要点编写规则

- 每条要点一句话，简洁明了
- 3-6 条要点覆盖完整答案
- 按重要程度排序（最关键的放前面）
- 包含「加分项」（面试官期望听到的额外点）

## 面试题与代码的关联

面试题的 `relatedCode` 字段指向实现该知识点的代码文件，方便学习者：
- 看完面试题后对照代码理解
- 从代码中找到面试考点标注 `// 📝 面试考点：xxx`
- 形成「题目 → 代码 → 理解」的学习闭环
