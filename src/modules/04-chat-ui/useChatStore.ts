/**
 * 知识点 4.1/4.8：聊天状态管理 Store
 *
 * 学习要点：
 * - zustand 创建 store（无需 Provider 包裹组件树）
 * - persist 中间件实现 localStorage 自动持久化
 * - 多会话数据结构设计（sessions 数组 + currentSessionId）
 * - 不可变状态更新（每次返回新对象，不直接修改原对象）
 *
 * 面试相关：
 * - zustand 和 Redux 的区别：无 Provider、无 action type 字符串、API 更简洁
 * - 为什么要不可变更新：React 通过引用比较检测变化，直接修改原对象不会触发重渲染
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 单条聊天消息
 * id: 唯一标识，用于 React 列表渲染的 key
 * role: 消息发送者（用户或AI助手）
 * content: 消息文本内容
 * timestamp: 发送时间戳（毫秒），用于排序和展示
 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

/**
 * 聊天会话
 * 一个会话包含一组消息，用户可以有多个会话并自由切换
 */
export interface ChatSession {
  id: string
  title: string       // 会话标题，默认取第一条用户消息的前20字
  messages: ChatMessage[]
  createdAt: number   // 创建时间，用于会话列表排序
}

/**
 * Store 状态和方法的完整类型定义
 * zustand 要求 state 和 actions 定义在同一个 interface 中
 */
interface ChatState {
  // ====== 状态 ======
  sessions: ChatSession[]          // 所有会话列表
  currentSessionId: string | null  // 当前激活的会话ID

  // ====== 派生方法 ======
  getCurrentSession: () => ChatSession | undefined

  // ====== 操作方法 ======
  createSession: () => string          // 创建新会话，返回新会话ID
  switchSession: (sessionId: string) => void
  deleteSession: (sessionId: string) => void
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  updateLastAssistant: (content: string) => void  // 流式更新用
  clearCurrentMessages: () => void
}

/**
 * 生成唯一ID
 * 用时间戳（36进制）+ 随机数组合，简单高效
 * 📝 面试考点：为什么不用 Math.random() 做唯一ID？
 * 答：纯随机有碰撞概率，加入时间戳后在同一毫秒内碰撞概率极低
 */
const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * 📝 面试考点：zustand 的 persist 中间件
 * - 自动将 state 序列化为 JSON 存入 localStorage
 * - 页面刷新后自动从 localStorage 恢复 state
 * - 只需传入 { name: 'storage-key' } 即可启用
 */
export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,

      /**
       * 获取当前激活的会话对象
       * 使用 get() 读取最新 state，避免闭包中拿到旧值
       */
      getCurrentSession: () => {
        const { sessions, currentSessionId } = get()
        return sessions.find((s) => s.id === currentSessionId)
      },

      /**
       * 创建新会话并设为当前会话
       * 新会话插入数组开头（最新的在前面）
       */
      createSession: () => {
        const newSession: ChatSession = {
          id: generateId(),
          title: '新对话',
          messages: [],
          createdAt: Date.now(),
        }
        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSessionId: newSession.id,
        }))
        return newSession.id
      },

      /** 切换当前会话 */
      switchSession: (sessionId: string) => {
        set({ currentSessionId: sessionId })
      },

      /**
       * 删除指定会话
       * 如果删除的恰好是当前会话，自动切换到列表第一个
       */
      deleteSession: (sessionId: string) => {
        set((state) => {
          const filtered = state.sessions.filter((s) => s.id !== sessionId)
          const isCurrentDeleted = state.currentSessionId === sessionId
          return {
            sessions: filtered,
            currentSessionId: isCurrentDeleted
              ? (filtered[0]?.id ?? null)  // 可选链 + 空值合并
              : state.currentSessionId,
          }
        })
      },

      /**
       * 添加一条新消息到当前会话
       * 如果是第一条用户消息，自动用它的内容更新会话标题
       */
      addMessage: (message) => {
        const newMsg: ChatMessage = {
          ...message,
          id: generateId(),
          timestamp: Date.now(),
        }
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== state.currentSessionId) return s
            // 第一条用户消息 → 用内容前20字作为会话标题
            const shouldUpdateTitle =
              s.messages.length === 0 && message.role === 'user'
            return {
              ...s,
              title: shouldUpdateTitle
                ? message.content.slice(0, 20)
                : s.title,
              messages: [...s.messages, newMsg],
            }
          }),
        }))
      },

      /**
       * 📝 面试考点：流式更新 assistant 消息
       * AI 回复是逐步生成的，每收到一个 chunk 就调用此方法更新内容
       * 策略：如果最后一条是 assistant → 更新它的 content
       *       如果最后一条不是 assistant → 新建一条
       */
      updateLastAssistant: (content: string) => {
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== state.currentSessionId) return s
            const msgs = [...s.messages]
            const lastMsg = msgs[msgs.length - 1]
            if (lastMsg?.role === 'assistant') {
              // 已有 assistant 消息，更新 content
              msgs[msgs.length - 1] = { ...lastMsg, content }
            } else {
              // 没有 assistant 消息，新建一条
              msgs.push({
                id: generateId(),
                role: 'assistant',
                content,
                timestamp: Date.now(),
              })
            }
            return { ...s, messages: msgs }
          }),
        }))
      },

      /** 清空当前会话的所有消息，标题重置为"新对话" */
      clearCurrentMessages: () => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === state.currentSessionId
              ? { ...s, messages: [], title: '新对话' }
              : s
          ),
        }))
      },
    }),
    // persist 配置：指定 localStorage 的 key 名
    { name: 'chat-sessions-storage' }
  )
)
