/**
 * 知识点 4.6：移动端输入组件
 *
 * 学习要点：
 * - textarea 自适应高度（scrollHeight 动态设置）
 * - 输入法组合事件（isComposing 判断防止中文输入误触发）
 * - 发送按钮触摸区域（最小 44px）
 *
 * 面试相关：
 * - 如何实现 textarea 自适应高度
 * - compositionstart/compositionend 事件的作用
 */

import { useRef, useCallback } from 'react'
import { SendOutline } from 'antd-mobile-icons'

interface ChatInputProps {
  value: string
  isDisabled?: boolean
  onChange: (value: string) => void
  onSend: () => void
}

const MAX_HEIGHT = 120 // textarea 最大高度

const ChatInput: React.FC<ChatInputProps> = ({ value, isDisabled, onChange, onSend }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 📝 面试考点：根据 scrollHeight 动态调整 textarea 高度
  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
    const el = e.target
    // 重置高度后取 scrollHeight，实现自适应
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [onChange])

  // 📝 面试考点：isComposing 判断 — 中文输入法组合状态下不触发发送
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onSend()
      // 发送后重置高度
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    }
  }, [onSend])

  return (
    <div className="flex items-end gap-2 p-3 glass-nav border-t border-slate-700/50">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="输入消息..."
        rows={1}
        className="tech-input flex-1 py-2.5 px-3 rounded-xl text-sm resize-none min-h-[40px]"
        style={{ maxHeight: `${MAX_HEIGHT}px` }}
      />
      <button
        type="button"
        onClick={onSend}
        disabled={isDisabled || !value.trim()}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center btn-glow rounded-xl text-white disabled:opacity-30"
      >
        <SendOutline fontSize={18} />
      </button>
    </div>
  )
}

export default ChatInput
