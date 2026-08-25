/**
 * useChat — AI 对话 Composable
 * 
 * 连接 BFF /api/chat/completions 接口
 * 支持流式 SSE 响应、多会话管理、服务端持久化
 */

import { ref, computed } from 'vue'
import type { ChatMessage, ChatSession } from '@ai-study/shared'

const STORAGE_KEY = 'ai-generator-sessions'
const ACTIVE_KEY = 'ai-generator-active-session'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function loadSessions(): ChatSession[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    }
  } catch {}
  return []
}

function saveSessions(sessions: ChatSession[]) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
    }
  } catch {}
}

const sessions = ref<ChatSession[]>([])
const activeSessionId = ref<string>('')
const isLoading = ref(false)
const streamingContent = ref('')
const initialized = ref(false)

export function useChat() {
  const activeSession = computed(() =>
    sessions.value.find((s) => s.id === activeSessionId.value) || null
  )

  const currentMessages = computed<ChatMessage[]>(
    () => activeSession.value?.messages ?? []
  )

  const activeSessionTitle = computed(
    () => activeSession.value?.title ?? '新对话'
  )

  const loadOrCreateSession = () => {
    if (initialized.value) return
    initialized.value = true
    sessions.value = loadSessions()
    const activeId = typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_KEY) : null

    if (activeId && sessions.value.find((s) => s.id === activeId)) {
      activeSessionId.value = activeId
    } else {
      createNewSession()
    }
  }

  const createNewSession = () => {
    const session: ChatSession = {
      id: generateId(),
      title: '新对话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    sessions.value.unshift(session)
    activeSessionId.value = session.id
    saveSessions(sessions.value)
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(ACTIVE_KEY, session.id)
      }
    } catch {}
  }

  const switchSession = (id: string) => {
    activeSessionId.value = id
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(ACTIVE_KEY, id)
      }
    } catch {}
  }

  const deleteSession = (id: string) => {
    sessions.value = sessions.value.filter((s) => s.id !== id)
    if (activeSessionId.value === id) {
      activeSessionId.value = ''
      if (sessions.value.length > 0) {
        activeSessionId.value = sessions.value[0].id
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(ACTIVE_KEY, activeSessionId.value)
          }
        } catch {}
      } else {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(ACTIVE_KEY)
          }
        } catch {}
        createNewSession()
      }
    }
    saveSessions(sessions.value)
  }

  const updateSessionTitle = (id: string, title: string) => {
    const session = sessions.value.find((s) => s.id === id)
    if (session) {
      session.title = title
      saveSessions(sessions.value)
    }
  }

  const addMessage = (message: ChatMessage) => {
    if (!activeSessionId.value) return
    const session = sessions.value.find((s) => s.id === activeSessionId.value)
    if (!session) return

    session.messages.push(message)
    session.updatedAt = Date.now()

    if (session.messages.length === 1 && message.role === 'user') {
      session.title = message.content.slice(0, 20) || '新对话'
    }

    saveSessions(sessions.value)
  }

  const updateLastAssistant = (content: string, code?: string) => {
    if (!activeSessionId.value) return
    const session = sessions.value.find((s) => s.id === activeSessionId.value)
    if (!session || session.messages.length === 0) return

    const lastMsg = session.messages[session.messages.length - 1]
    if (lastMsg.role === 'assistant') {
      lastMsg.content = content
      if (code) lastMsg.code = code
      lastMsg.timestamp = Date.now()
      saveSessions(sessions.value)
    }
  }

  const clearCurrentSession = () => {
    if (!activeSessionId.value) return
    const session = sessions.value.find((s) => s.id === activeSessionId.value)
    if (session) {
      session.messages = []
      saveSessions(sessions.value)
    }
  }

  const sendMessage = async (content: string) => {
    if (isLoading.value || !content.trim()) return

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    addMessage(userMsg)

    const assistantMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }
    addMessage(assistantMsg)

    isLoading.value = true
    streamingContent.value = ''

    try {
      const config = useRuntimeConfig()
      const bffUrl = config.public.bffUrl || 'http://localhost:3001'

      const response = await fetch(`${bffUrl}/api/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            ...currentMessages.value.map((m) => ({ role: m.role, content: m.content })),
          ],
          stream: true,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(errText || `请求失败: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法获取响应流')

      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''
      let extractedCode = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        buffer += chunk

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const json = JSON.parse(data)
            const delta = json.choices?.[0]?.delta?.content || ''
            if (delta) {
              fullContent += delta
              streamingContent.value = fullContent
              updateLastAssistant(fullContent)

              const codeMatch = fullContent.match(/```[\s\S]*?```/)
              if (codeMatch) {
                extractedCode = codeMatch[0].replace(/```\w*\n?/g, '').replace(/```$/, '')
              }
            }
          } catch {}
        }
      }

      updateLastAssistant(fullContent, extractedCode || undefined)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '请求失败'
      updateLastAssistant(`❌ 请求出错：${errorMsg}\n\n请检查网络连接或 BFF 服务是否启动。`)
    } finally {
      isLoading.value = false
      streamingContent.value = ''
    }
  }

  const stopStreaming = () => {
    isLoading.value = false
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    currentMessages,
    activeSessionTitle,
    isLoading,
    streamingContent,
    loadOrCreateSession,
    createNewSession,
    switchSession,
    deleteSession,
    updateSessionTitle,
    addMessage,
    updateLastAssistant,
    clearCurrentSession,
    sendMessage,
    stopStreaming,
  }
}
