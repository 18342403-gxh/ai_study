/**
 * 代码块组件（语法高亮 + 复制）
 * 公共组件，可在任何需要展示代码块的地方使用
 */

import { useState, useCallback } from 'react'

interface CodeBlockProps {
  language: string
  children: string
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, children }) => {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(children)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch {
      // 降级方案
      const textarea = document.createElement('textarea')
      textarea.value = children
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
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
      <pre className="p-3 overflow-x-auto text-xs leading-relaxed">
        <code className={`language-${language} text-slate-200`}>
          {children}
        </code>
      </pre>
    </div>
  )
}

export default CodeBlock
