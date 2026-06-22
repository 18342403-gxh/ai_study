/**
 * Markdown 渲染公共组件
 *
 * 将 AI 回复的 Markdown 文本渲染为格式化的富文本，
 * 不会显示原始的 #、**、``` 等标记符号。
 *
 * 使用方式：
 * import MarkdownRenderer from '../../components/MarkdownRenderer'
 * <MarkdownRenderer content={aiReply} />
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import CodeBlock from './CodeBlock'

interface MarkdownRendererProps {
  content: string
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // 代码块：区分行内代码和多行代码块
        code({ className, children }) {
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
        // 段落
        p({ children }) {
          return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
        },
        // 无序列表
        ul({ children }) {
          return <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>
        },
        // 有序列表
        ol({ children }) {
          return <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>
        },
        // 列表项
        li({ children }) {
          return <li className="text-sm">{children}</li>
        },
        // 标题
        h1({ children }) {
          return <h1 className="text-lg font-bold mb-2 text-slate-100">{children}</h1>
        },
        h2({ children }) {
          return <h2 className="text-base font-bold mb-2 text-slate-100">{children}</h2>
        },
        h3({ children }) {
          return <h3 className="text-sm font-bold mb-1 text-slate-200">{children}</h3>
        },
        // 加粗
        strong({ children }) {
          return <strong className="font-semibold text-slate-100">{children}</strong>
        },
        // 链接
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
        // 水平分割线
        hr() {
          return <hr className="border-slate-700 my-3" />
        },
        // 表格
        table({ children }) {
          return (
            <div className="overflow-x-auto my-2">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          )
        },
        th({ children }) {
          return <th className="border border-slate-600 px-2 py-1 bg-slate-800 text-slate-300 text-left">{children}</th>
        },
        td({ children }) {
          return <td className="border border-slate-700 px-2 py-1 text-slate-300">{children}</td>
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

export default MarkdownRenderer
