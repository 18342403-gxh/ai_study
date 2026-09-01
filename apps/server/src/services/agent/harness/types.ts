/**
 * Harness 内部类型定义
 *
 * 注意：服务端 tsconfig rootDir 限制无法直接引用 packages/shared，
 * 所以 HarnessCheckResult 在本模块内独立定义，与 shared/types/agent.ts
 * 中的定义保持字段完全一致，运行时通过 SSE JSON 序列化互通。
 */

export type HarnessCheckResult = {
  name: 'input_safety' | 'tool_policy' | 'output_guardrail' | string
  result: 'pass' | 'block' | 'warn'
  reason?: string
  rule?: string
  timestamp?: number
}
