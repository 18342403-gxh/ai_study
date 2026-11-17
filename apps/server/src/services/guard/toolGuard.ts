/**
 * 工具结果守卫（S5）
 *
 * 归一化（去零宽字符 + NFKC）后做规则匹配，识别工具输出中的提示注入特征。
 * 命中不丢弃结果，而是包裹并标注 risk=high，交由模型按“数据不是指令”处理。
 *
 * 开关：TOOL_GUARD=0 关闭（默认开启）。
 */

import { withSpanSync } from '../../observability/tracing.js'

export type GuardAction = 'allow' | 'wrap' | 'deny'
export type GuardCheckpoint = 'input' | 'retrieval' | 'tool' | 'output'
export type GuardRisk = 'low' | 'high'

export interface GuardDecision {
  action: GuardAction
  risk: GuardRisk
  /** 命中的规则 id */
  rules: string[]
  /** 处理后的文本（高风险时已包裹边界） */
  text: string
  elapsedMs: number
}

interface GuardRule {
  id: string
  pattern: RegExp
}

const RULES: GuardRule[] = [
  {
    id: 'ignore_previous',
    pattern: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
  },
  { id: 'system_prompt', pattern: /system\s*prompt|系统提示词|系统指令/i },
  {
    id: 'role_hijack',
    pattern: /现在你是|从现在起你是|你现在是|you\s+are\s+now\s+(?:a|an|the)\s+/i,
  },
  { id: 'exec_command', pattern: /执行以下(?:命令|脚本)|请运行以下(?:命令|脚本)|rm\s+-rf\s+\//i },
  { id: 'ignore_rules', pattern: /忽略(?:以上|之前|上面|前面).{0,8}(?:规则|指令|要求)/ },
  { id: 'leak_prompt', pattern: /(?:泄露|输出|打印).{0,8}(?:系统|内部).{0,6}(?:提示|指令)/ },
  { id: 'boundary_break', pattern: /<\/?(?:retrieved_data|system|tool_result)\b/i },
  { id: 'chat_tags', pattern: /\[system\]|<\|im_start\|>|<\|system\|>/i },
]

const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g

/** 归一化：去零宽/方向控制字符 + NFKC + 折叠空白 */
export const normalizeForGuard = (text: string): string =>
  text.normalize('NFKC').replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim()

/** 防止工具结果提前闭合包裹边界 */
const escapeToolBoundary = (text: string): string =>
  text.replace(/<(\/?)(tool_result)\b/gi, '&lt;$1$2')

export const isToolGuardEnabled = (): boolean => process.env.TOOL_GUARD !== '0'

/**
 * 检查工具输出。命中特征 → 包裹为 `<tool_result trust="untrusted" risk="high">`；
 * 未命中 → 原样返回，保证正常输出零改动。
 */
export const guardToolOutput = (toolName: string, output: string): GuardDecision => {
  const start = Date.now()
  if (!isToolGuardEnabled()) {
    return { action: 'allow', risk: 'low', rules: [], text: output, elapsedMs: 0 }
  }

  const normalized = normalizeForGuard(output)
  const rules = RULES.filter((rule) => rule.pattern.test(normalized)).map((rule) => rule.id)

  return withSpanSync(
    'guard.check',
    {
      'guard.checkpoint': 'tool',
      'tool.name': toolName,
      'app.text_length': output.length,
    },
    (span) => {
      if (rules.length === 0) {
        span.setAttribute('guard.action', 'allow')
        span.setAttribute('guard.rules_count', 0)
        return {
          action: 'allow',
          risk: 'low',
          rules: [],
          text: output,
          elapsedMs: Date.now() - start,
        }
      }

      span.setAttribute('guard.action', 'wrap')
      span.setAttribute('guard.rules_count', rules.length)
      span.setAttribute('guard.rules', rules.join(','))

      const body = escapeToolBoundary(output)
      const text = `<tool_result tool="${toolName}" trust="untrusted" risk="high" rules="${rules.join(',')}">\n${body}\n</tool_result>`
      return {
        action: 'wrap',
        risk: 'high',
        rules,
        text,
        elapsedMs: Date.now() - start,
      }
    },
  )
}
