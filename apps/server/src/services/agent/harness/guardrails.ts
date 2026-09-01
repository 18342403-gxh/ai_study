/**
 * Harness Guardrails — 输入/输出安全护栏
 *
 * 三层检查：
 *   1. checkInputSafety()     — think 节点前：拦截 prompt injection、有害指令
 *   2. checkOutputGuardrail() — answer 节点前：清洗幻觉、敏感词、格式异常
 *
 * 设计原则：
 *   - 所有函数都是纯函数，不依赖外部状态，方便单元测试
 *   - 返回统一的 HarnessCheckResult 格式，供 SSE 事件消费
 *   - 规则可配置、可扩展，不硬编码到 agent.ts 里
 */

import type { HarnessCheckResult } from './types.js'

// ---------------------------------------------------------------------------
// 1. 输入安全检查 — 拦截 Prompt Injection 与有害请求
// ---------------------------------------------------------------------------

/** 危险指令模式（prompt injection） */
const INJECTION_PATTERNS: Array<{ pattern: RegExp; rule: string; reason: string }> = [
  { pattern: /忽略(之前|上面|前文|前面)(的)?(所有|全部)?指令/gi, rule: 'ignore_prior_instructions', reason: '尝试覆盖系统提示词' },
  { pattern: /你是[：: ]?.*?prompt\s*(injection|注入)/gi, rule: 'prompt_injection_declaration', reason: '声明自己是注入攻击' },
  { pattern: /system\s*prompt[：:]?\s*(.*)/gi, rule: 'system_prompt_probe', reason: '试图探测系统提示词内容' },
  { pattern: /disregard\s+(all\s+)?previous\s+(instructions|prompts)/gi, rule: 'ignore_prior_instructions_en', reason: '英文版注入指令' },
  { pattern: /jailbreak|dan\s*mode|developer\s*mode/gi, rule: 'jailbreak_attempt', reason: '典型越狱攻击关键词' },
]

/** 敏感内容模式 */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; rule: string; reason: string }> = [
  { pattern: /如何(制造|制作|合成).{0,10}(炸弹|毒品|炸药|武器)/gi, rule: 'dangerous_recipe', reason: '请求危险物品制作方法' },
  { pattern: /(黑客|hacker|cracker).{0,10}(攻击|入侵|破解)/gi, rule: 'malicious_intent', reason: '请求恶意攻击相关内容' },
  { pattern: /(色情|赌博|博彩).{0,5}(网站|平台|APP|软件)/gi, rule: 'illegal_content', reason: '请求违法违规内容' },
]

/** 长度限制（防止超长 prompt 打爆 token） */
const MAX_INPUT_LENGTH = 4000

export function checkInputSafety(input: string): HarnessCheckResult {
  // 长度检查
  if (input.length > MAX_INPUT_LENGTH) {
    return {
      name: 'input_safety',
      result: 'block',
      rule: 'input_too_long',
      reason: `输入长度 ${input.length} 超过限制 ${MAX_INPUT_LENGTH}`,
      timestamp: Date.now(),
    }
  }

  // 注入检查
  for (const { pattern, rule, reason } of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return {
        name: 'input_safety',
        result: 'block',
        rule,
        reason,
        timestamp: Date.now(),
      }
    }
  }

  // 敏感内容检查
  for (const { pattern, rule, reason } of SENSITIVE_PATTERNS) {
    if (pattern.test(input)) {
      return {
        name: 'input_safety',
        result: 'warn',
        rule,
        reason,
        timestamp: Date.now(),
      }
    }
  }

  return {
    name: 'input_safety',
    result: 'pass',
    rule: 'all_checks_passed',
    reason: '输入安全检查通过',
    timestamp: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// 2. 输出 Guardrail — 清洗幻觉、敏感输出
// ---------------------------------------------------------------------------

/** 幻觉特征短语（模型瞎编的典型表现） */
const HALLUCINATION_MARKERS = [
  /根据.*?(我的)?假设|我猜(可能|也许)/gi,
  /(虚构|编造).*?(数据|信息|事实)/gi,
  /暂无相关数据|没有找到.*?但我可以/gi,
]

/** 自我暴露/系统提示词泄露 */
const LEAK_MARKERS = [
  /作为(一个)?(AI|人工智能|大模型).*?我的(任务|职责|系统提示)/gi,
  /我的.*?(prompt|系统指令|system\s*prompt)(是|为|:)/gi,
]

/** 输出质量检查 & 清洗 */
export function checkOutputGuardrail(answer: string): { result: HarnessCheckResult; sanitized: string } {
  let sanitized = answer

  // 幻觉检测
  for (const pattern of HALLUCINATION_MARKERS) {
    if (pattern.test(answer)) {
      sanitized = sanitized.replace(pattern, '（内容可能不准确，仅供参考）')
    }
  }

  // 泄露检测
  for (const pattern of LEAK_MARKERS) {
    if (pattern.test(answer)) {
      return {
        result: {
          name: 'output_guardrail',
          result: 'block',
          rule: 'prompt_leak',
          reason: '输出疑似泄露系统提示词',
          timestamp: Date.now(),
        },
        sanitized: '抱歉，我无法回答这个问题。',
      }
    }
  }

  // 空回答检测
  if (!answer.trim() || answer.trim().length < 2) {
    return {
      result: {
        name: 'output_guardrail',
        result: 'block',
        rule: 'empty_answer',
        reason: 'AI 返回了空回答',
        timestamp: Date.now(),
      },
      sanitized: '抱歉，我没有理解你的问题，请换一种方式提问。',
    }
  }

  return {
    result: {
      name: 'output_guardrail',
      result: 'pass',
      rule: 'all_checks_passed',
      reason: '输出安全检查通过',
      timestamp: Date.now(),
    },
    sanitized: sanitized.trim(),
  }
}
