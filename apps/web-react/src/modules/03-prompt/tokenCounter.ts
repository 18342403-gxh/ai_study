/**
 * 知识点 3.5：Token 计数器
 *
 * 学习要点：
 * - Token 估算算法（精确计算需要 tiktoken 库，这里用估算）
 * - 中文约 1.5 字/token，英文约 4 字符/token
 * - 了解为什么需要计数：成本控制 + 上下文限制
 *
 * 面试相关：
 * - Token 是什么？和字符数有什么区别？
 * - 如何在前端估算 Token 消耗
 */

import type { ChatMessage } from './types'

// 📝 面试考点：Token ≠ 字符数，中英文分词方式不同
// 精确计算需要 tiktoken 库，这里用经验公式估算
export const estimateTokens = (text: string): number => {
  let tokens = 0

  for (const char of text) {
    if (/[\u4e00-\u9fff]/.test(char)) {
      // 中文字符：约 1.5 字 = 1 token → 每字约 0.67 token
      // 实际更接近每字 1.5 token（因为 BPE 分词后中文通常 2-3 bytes/token）
      tokens += 1.5
    } else if (/[a-zA-Z]/.test(char)) {
      // 英文字符：约 4 字符 = 1 token
      tokens += 0.25
    } else {
      // 空格、标点等
      tokens += 0.5
    }
  }

  // 每条消息有额外开销（role 标记等），约 4 tokens
  return Math.ceil(tokens)
}

/**
 * 计算消息数组的总 Token 数
 * 📝 面试考点：每条消息除了 content 还有 role 等元数据的 Token 开销
 */
export const estimateMessagesTokens = (messages: ChatMessage[]): number => {
  const MESSAGE_OVERHEAD = 4 // 每条消息的固定开销

  return messages.reduce((total, msg) => {
    return total + estimateTokens(msg.content) + MESSAGE_OVERHEAD
  }, 3) // 3 是整个请求的固定开销
}
