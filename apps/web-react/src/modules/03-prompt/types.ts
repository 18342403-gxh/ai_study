/**
 * 知识点 3.1：消息角色类型定义
 *
 * 学习要点：
 * - system/user/assistant 三种角色的职责
 * - TypeScript 联合类型定义
 * - 消息数组的组织方式
 *
 * 面试相关：
 * - 三种角色分别在对话中起什么作用
 * - 为什么 system 消息要放在第一个
 */

// 📝 面试考点：三种角色 — system 设定行为规则，user 提问，assistant 回答
export type Role = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: Role
  content: string
  timestamp?: number
}

// 📝 面试考点：Prompt 预设包含角色、描述和 system 指令
export interface PromptPreset {
  id: string
  name: string
  description: string
  systemPrompt: string
}
