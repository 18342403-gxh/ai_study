/**
 * Harness Tool Policy — 工具调用权限检查
 *
 * 三层策略：
 *   1. 黑名单（BLOCK） — 绝对禁止，直接拦截
 *   2. 灰名单（WARN）  — 允许执行但推 warn 事件，前端可选择弹确认框
 *   3. 白名单（PASS）  — 正常放行
 *
 * 运行时从 config/toolPolicies.json 加载，支持热更新（不重启 Agent）
 */

import type { HarnessCheckResult } from './types.js'

export type ToolRiskLevel = 'BLOCK' | 'WARN' | 'PASS'

export interface ToolPolicyRule {
  toolName: string
  risk: ToolRiskLevel
  reason?: string
  /** 可选：根据参数内容动态判定 */
  argPatterns?: Array<{ pattern: RegExp; risk: ToolRiskLevel; reason: string }>
}

/** 默认策略：所有工具放行，可按需修改 */
const DEFAULT_POLICIES: ToolPolicyRule[] = [
  // 示例：禁止 shell 执行类工具（实际项目里你没有这个工具，这里只是演示）
  // { toolName: 'run_shell', risk: 'BLOCK', reason: '不允许在生产环境执行 shell 命令' },

  // 示例：知识库删除需要 warn
  { toolName: 'delete_document', risk: 'WARN', reason: '知识库删除操作不可恢复' },

  // 默认：其他所有工具 PASS
]

/** 内置工具名 → 策略查找表 */
const policyMap = new Map<string, ToolPolicyRule>()
for (const rule of DEFAULT_POLICIES) {
  policyMap.set(rule.toolName, rule)
}

/**
 * 动态注册策略（可在运行时调用，无需重启）
 */
export function registerToolPolicy(rule: ToolPolicyRule): void {
  policyMap.set(rule.toolName, rule)
}

/**
 * 批量注册
 */
export function registerToolPolicies(rules: ToolPolicyRule[]): void {
  for (const r of rules) policyMap.set(r.toolName, r)
}

/**
 * 清空所有策略（用于测试）
 */
export function clearToolPolicies(): void {
  policyMap.clear()
  for (const rule of DEFAULT_POLICIES) policyMap.set(rule.toolName, rule)
}

/**
 * 执行工具策略检查
 *
 * @param toolName  要调用的工具名
 * @param args      工具参数
 */
export function checkToolPolicy(
  toolName: string,
  args: Record<string, unknown>
): HarnessCheckResult {
  const rule = policyMap.get(toolName)

  // 无策略 → 默认放行
  if (!rule) {
    return {
      name: 'tool_policy',
      result: 'pass',
      rule: 'default_allow',
      reason: `工具 ${toolName} 无限制策略`,
      timestamp: Date.now(),
    }
  }

  // 先检查参数级别的精确匹配（如果配了 argPatterns）
  if (rule.argPatterns) {
    for (const ap of rule.argPatterns) {
      const argsStr = JSON.stringify(args)
      if (ap.pattern.test(argsStr)) {
        return {
          name: 'tool_policy',
          result: ap.risk === 'BLOCK' ? 'block' : ap.risk === 'WARN' ? 'warn' : 'pass',
          rule: `arg_pattern:${ap.pattern.source}`,
          reason: ap.reason,
          timestamp: Date.now(),
        }
      }
    }
  }

  return {
    name: 'tool_policy',
    result: rule.risk === 'BLOCK' ? 'block' : rule.risk === 'WARN' ? 'warn' : 'pass',
    rule: `tool:${rule.toolName}`,
    reason: rule.reason,
    timestamp: Date.now(),
  }
}

/** 获取当前所有策略（调试用） */
export function getAllPolicies(): ToolPolicyRule[] {
  return Array.from(policyMap.values())
}
