/**
 * 知识点 4.9：聊天主页面
 *
 * 学习要点：
 * - 全屏对话布局（顶部标题栏 + 消息区 + 底部输入栏）
 * - 集成 zustand store 管理会话状态
 * - 流式输出集成
 * - 会话切换和新建
 *
 * 面试相关：
 * - 移动端全屏聊天布局的 CSS 方案
 * - 如何组织一个完整的聊天页面状态
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { LeftOutline, AddOutline, DeleteOutline } from 'antd-mobile-icons'
import { useNavigate } from 'react-router-dom'

import { useChatStore } from './useChatStore'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import { createSSEParser } from '../02-streaming/parseSSE'

const API_URL = import.meta.env.VITE_AI_API_URL || 'https://api.openai.com/v1'
const API_KEY = import.meta.env.VITE_AI_API_KEY || ''

const ChatPage: React.FC = () => {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  const {
    sessions,
    currentSessionId,
    getCurrentSession,
    createSession,
    switchSession,
    deleteSession,
    addMessage,
    updateLastAssistant,
    clearCurrentMessages,
  } = useChatStore()

  const [isSessionListVisible, setIsSessionListVisible] = useState(false)

  const currentSession = getCurrentSession()
  const messages = currentSession?.messages ?? []

  // 如果没有会话，自动创建一个
  useEffect(() => {
    if (sessions.length === 0) {
      createSession()
    } else if (!currentSessionId) {
      switchSession(sessions[0].id)
    }
  }, [sessions, currentSessionId, createSession, switchSession])

  const handleStop = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setIsStreaming(false)
  }, [])

  // 发送消息并获取流式回复
  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return

    // 清空输入框并添加用户消息到 store
    setInput('')
    addMessage({ role: 'user', content: trimmed })
    setIsStreaming(true)

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      /**
       * 📝 面试考点：构造 messages 数组
       * API 需要完整的对话历史才能理解上下文
       * 顺序：system → 历史消息 → 当前用户消息
       */
      const apiMessages = [
        { role: 'system' as const, content: '你是一个友好的 AI 助手，请用中文回答。' },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: trimmed },
      ]

      // 📝 面试考点：stream: true 开启流式响应
      const response = await fetch(`${API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: 'glm-4-flash',
          messages: apiMessages,
          stream: true,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})`)
      }

      // 📝 面试考点：从 response.body 获取 ReadableStream 的 reader
      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法获取响应流')

      const decoder = new TextDecoder()
      const parse = createSSEParser()
      let assistantContent = ''

      // 📝 面试考点：while(true) 循环持续读取流，直到 done=true
      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        // 将二进制 chunk 解码为文本，再用 SSE 解析器提取内容
        const text = decoder.decode(value, { stream: true })
        const results = parse(text)

        for (const result of results) {
          if (result.done) break
          if (result.content) {
            // 累积内容并更新 store 中的 assistant 消息
            assistantContent += result.content
            updateLastAssistant(assistantContent)
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        // 非用户主动取消的错误，展示给用户
        updateLastAssistant(`请求出错：${err.message}`)
      }
    } finally {
      setIsStreaming(false)
      controllerRef.current = null
    }
  }, [input, isStreaming, messages, addMessage, updateLastAssistant])

  const handleNewSession = useCallback(() => {
    createSession()
    setIsSessionListVisible(false)
  }, [createSession])

  return (
    <div className="h-screen flex flex-col tech-gradient-bg">
      {/* 顶部栏 */}
      <header className="h-11 flex items-center justify-between px-4 glass-nav shrink-0">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2 text-slate-400"
        >
          <LeftOutline />
        </button>
        <button
          type="button"
          onClick={() => setIsSessionListVisible(!isSessionListVisible)}
          className="text-sm text-slate-200 truncate max-w-[200px]"
        >
          {currentSession?.title || '新对话'}
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleNewSession}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400"
          >
            <AddOutline />
          </button>
          <button
            type="button"
            onClick={clearCurrentMessages}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400"
          >
            <DeleteOutline />
          </button>
        </div>
      </header>

      {/* 会话列表（点击标题展开） */}
      {isSessionListVisible && (
        <div className="absolute top-11 left-0 right-0 z-40 glass-nav border-b border-slate-700/50 max-h-[300px] overflow-y-auto">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => {
                switchSession(session.id)
                setIsSessionListVisible(false)
              }}
              className={`w-full px-4 py-3 text-left text-sm flex items-center justify-between ${
                session.id === currentSessionId ? 'text-indigo-400' : 'text-slate-300'
              }`}
            >
              <span className="truncate">{session.title}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  deleteSession(session.id)
                }}
                className="text-slate-500 min-w-[32px] min-h-[32px] flex items-center justify-center"
              >
                <DeleteOutline fontSize={14} />
              </button>
            </button>
          ))}
        </div>
      )}

      {/* 消息列表 */}
      <MessageList messages={messages} isStreaming={isStreaming} />

      {/* 底部输入栏 */}
      <ChatInput
        value={input}
        isDisabled={isStreaming}
        onChange={setInput}
        onSend={isStreaming ? handleStop : handleSend}
      />
    </div>
  )
}

export default ChatPage
