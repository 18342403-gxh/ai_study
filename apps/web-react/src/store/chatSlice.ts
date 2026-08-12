/**
 * 知识点 4.1/4.8：聊天状态管理 — Redux Toolkit Slice
 *
 * 学习要点：
 * - createSlice 定义 state + reducers（替代手写 action type + reducer）
 * - PayloadAction 类型安全的 action payload
 * - localStorage 持久化（通过 store subscribe 实现）
 * - 不可变更新：RTK 内置 Immer，可以"直接修改" state（底层自动转为不可变操作）
 *
 * 面试相关：
 * - Redux Toolkit 解决了传统 Redux 的哪些痛点
 * - createSlice 内部的 Immer 如何工作
 * - 为什么企业项目选 Redux 而非轻量库
 */

import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'

// ====== 类型定义 ======

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
}

interface ChatState {
  sessions: ChatSession[]
  currentSessionId: string | null
}

// ====== 工具函数 ======

/** 生成唯一 ID：时间戳(36进制) + 随机数 */
const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** 从 localStorage 恢复持久化状态 */
const STORAGE_KEY = 'chat-sessions-storage'

const loadPersistedState = (): ChatState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // 兼容 zustand persist 旧格式：{ state: { sessions, ... }, version: 0 }
      const data = parsed.state ?? parsed
      // 校验数据结构是否合法
      if (Array.isArray(data.sessions)) {
        return {
          sessions: data.sessions,
          currentSessionId: data.currentSessionId ?? null,
        }
      }
    }
  } catch {
    // localStorage 读取/解析失败时使用默认值
  }
  return { sessions: [], currentSessionId: null }
}

// ====== Slice 定义 ======

/**
 * 📝 面试考点：createSlice 自动生成 action creators + action types
 * 内置 Immer 允许在 reducer 中"直接修改" state，底层自动做不可变更新
 */
const chatSlice = createSlice({
  name: 'chat',
  initialState: loadPersistedState(),
  reducers: {
    /** 创建新会话 */
    createSession(state) {
      const newSession: ChatSession = {
        id: generateId(),
        title: '新对话',
        messages: [],
        createdAt: Date.now(),
      }
      // 📝 面试考点：RTK 的 Immer — 这里看起来是"直接修改"，实际是不可变操作
      state.sessions.unshift(newSession)
      state.currentSessionId = newSession.id
    },

    /** 切换当前会话 */
    switchSession(state, action: PayloadAction<string>) {
      state.currentSessionId = action.payload
    },

    /** 删除指定会话，如果是当前会话则自动切换 */
    deleteSession(state, action: PayloadAction<string>) {
      const sessionId = action.payload
      state.sessions = state.sessions.filter((s) => s.id !== sessionId)
      // 如果删除的是当前会话，切换到第一个
      if (state.currentSessionId === sessionId) {
        state.currentSessionId = state.sessions[0]?.id ?? null
      }
    },

    /** 添加消息到当前会话 */
    addMessage(state, action: PayloadAction<Omit<ChatMessage, 'id' | 'timestamp'>>) {
      const session = state.sessions.find((s) => s.id === state.currentSessionId)
      if (!session) return

      const newMsg: ChatMessage = {
        ...action.payload,
        id: generateId(),
        timestamp: Date.now(),
      }
      session.messages.push(newMsg)

      // 第一条用户消息自动更新会话标题
      const shouldUpdateTitle = session.messages.length === 1 && action.payload.role === 'user'
      if (shouldUpdateTitle) {
        session.title = action.payload.content.slice(0, 20)
      }
    },

    /**
     * 流式更新最后一条 assistant 消息
     * 📝 面试考点：流式接收时持续调用此 reducer 更新内容
     */
    updateLastAssistant(state, action: PayloadAction<string>) {
      const session = state.sessions.find((s) => s.id === state.currentSessionId)
      if (!session) return

      const lastMsg = session.messages[session.messages.length - 1]
      if (lastMsg?.role === 'assistant') {
        // 已有 assistant 消息，更新内容
        lastMsg.content = action.payload
      } else {
        // 没有 assistant 消息，新建一条
        session.messages.push({
          id: generateId(),
          role: 'assistant',
          content: action.payload,
          timestamp: Date.now(),
        })
      }
    },

    /** 清空当前会话消息 */
    clearCurrentMessages(state) {
      const session = state.sessions.find((s) => s.id === state.currentSessionId)
      if (session) {
        session.messages = []
        session.title = '新对话'
      }
    },
  },
})

export const {
  createSession,
  switchSession,
  deleteSession,
  addMessage,
  updateLastAssistant,
  clearCurrentMessages,
} = chatSlice.actions

export default chatSlice.reducer
