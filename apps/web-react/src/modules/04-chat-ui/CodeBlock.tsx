/**
 * 知识点 4.5：代码块组件（语法高亮 + 复制）
 *
 * 学习要点：
 * - highlight.js 语法高亮集成
 * - navigator.clipboard.writeText 复制到剪贴板
 * - 复制状态反馈（已复制 → 2秒恢复）
 *
 * 面试相关：
 * - navigator.clipboard API 的兼容性和安全限制
 */

import { useState, useCallback } from 'react'

interface CodeBlockProps {
  language: string
  children: string
}

// 📝 面试考点：clipboard API 需要 HTTPS 或 localhost 环境
const CodeBlock: React.FC<CodeBlockProps> = ({ language, children }) => {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(children)
      setIsCopied(true)
      // 2秒后恢复按钮文字
      setTimeout(() => setIsCopied(false), 2000)
    } catch {
      // 降级方案：使用 execCommand（已废弃但兼容性好）
      const textarea = document.createElement('textarea')
      textarea.value = children
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    }
  }, [children])

  return (
    <div className="relative my-2 rounded-lg overflow-hidden bg-slate-900 border border-slate-700/50">
      {/* 顶部栏：语言标签 + 复制按钮 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/80 border-b border-slate-700/50">
        <span className="text-xs text-slate-400">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-xs text-slate-400 hover:text-slate-200 min-w-[44px] min-h-[28px] flex items-center justify-center"
        >
          {isCopied ? '已复制' : '复制'}
        </button>
      </div>
      {/* 代码内容 */}
      <pre className="p-3 overflow-x-auto text-xs leading-relaxed">
        <code className={`language-${language} text-slate-200`}>
          {children}
        </code>
      </pre>
    </div>
  )
}

export default CodeBlock
