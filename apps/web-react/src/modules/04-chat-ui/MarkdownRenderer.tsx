/**
 * 知识点 4.4：Markdown 渲染器
 *
 * 学习要点：
 * - react-markdown 组件将 Markdown 渲染为 React 元素
 * - remark-gfm 插件支持表格、删除线等扩展语法
 * - 自定义渲染组件覆盖默认行为（如代码块）
 *
 * 面试相关：
 * - react-markdown 的自定义渲染机制
 * - 为什么不用 dangerouslySetInnerHTML
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import CodeBlock from './CodeBlock'

interface MarkdownRendererProps {
  content: string
}

// 📝 面试考点：react-markdown 通过 components prop 覆盖默认元素渲染
const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // 自定义代码块渲染
        code({ className, children }) {
          // 📝 面试考点：通过 className 提取语言标识（如 "language-javascript"）
          const isInlineCode = !className
          if (isInlineCode) {
            return (
              <code className="px-1 py-0.5 bg-slate-700/50 rounded text-xs text-indigo-300">
                {children}
              </code>
            )
          }
          const language = className?.replace('language-', '') || ''
          return (
            <CodeBlock language={language}>
              {String(children).replace(/\n$/, '')}
            </CodeBlock>
          )
        },
        // 段落样式
        p({ children }) {
          return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
        },
        // 列表样式
        ul({ children }) {
          return <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>
        },
        ol({ children }) {
          return <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>
        },
        // 标题样式
        h1({ children }) {
          return <h1 className="text-lg font-bold mb-2 text-slate-100">{children}</h1>
        },
        h2({ children }) {
          return <h2 className="text-base font-bold mb-2 text-slate-100">{children}</h2>
        },
        h3({ children }) {
          return <h3 className="text-sm font-bold mb-1 text-slate-200">{children}</h3>
        },
        // 链接样式
        a({ href, children }) {
          return (
            <a href={href} className="text-indigo-400 underline" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          )
        },
        // 引用块
        blockquote({ children }) {
          return (
            <blockquote className="border-l-2 border-indigo-500/50 pl-3 my-2 text-slate-400 italic">
              {children}
            </blockquote>
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

export default MarkdownRenderer
