/**
 * 知识点 7.1：Agent 类型定义
 *
 * 学习要点：
 * - AgentStep 类型（thinking/tool_call/tool_result/final_answer）
 * - 状态枚举（idle/running/paused/completed/failed）
 * - 时间戳用于计算每步耗时
 */

/** Agent 执行步骤类型 */
export type StepType = 'thinking' | 'tool_call' | 'tool_result' | 'final_answer'

/** Agent 整体运行状态 */
export type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed'

/** 单个执行步骤 */
export interface AgentStep {
  id: string
  type: StepType
  content: string          // 思考内容 / 工具名 / 工具结果 / 最终回答
  toolName?: string        // tool_call 时的工具名
  toolArgs?: string        // tool_call 时的参数 JSON
  isError?: boolean        // 步骤是否执行失败
  timestamp: number        // 步骤开始时间
  duration?: number        // 步骤耗时（毫秒）
}
