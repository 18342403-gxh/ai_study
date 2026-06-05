/**
 * 知识点 2.5/2.7/2.8：流式响应页面
 *
 * 学习要点：
 * - 逐字渲染效果
 * - 自动滚动到底部（scrollIntoView）
 * - 停止按钮中断生成
 * - 状态驱动的 UI 条件渲染
 *
 * 面试相关：
 * - 如何实现自动滚动并处理用户上翻
 * - 流式内容更新的性能优化
 */

import { useState, useRef, useEffect } from 'react'
import Layout from '../../components/Layout'
import InterviewCard from '../../components/InterviewCard'
import Cursor from './Cursor'
import { useStreaming } from './useStreaming'
import { interviewQuestions } from '../../data/interview-questions'
import type { Message } from '../01-api-basics/types'

const Streaming: React.FC = () => {
  const [input, setInput] = useState('')
  const { content, status, error, start, stop } = useStreaming()

  // 📝 面试考点：useRef 获取 DOM 元素用于滚动控制
  const bottomRef = useRef<HTMLDivElement>(null)

  // 📝 面试考点：内容变化时自动滚动到底部
  useEffect(() => {
    if (status === 'streaming') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [content, status])

  const handleStart = () => {
    if (!input.trim() || status === 'streaming') return

    const messages: Message[] = [
      { role: 'user', content: input.trim() },
    ]
    start(messages)
  }

  const isStreaming = status === 'streaming'

  // 获取模块 2 面试题
  const moduleQuestions = interviewQuestions.filter((q) => q.moduleId === 2)

  return (
    <Layout title="流式响应">
      <div className="px-4 py-4">
        {/* 输入区 */}
        <div className="mb-4">
          <label className="text-sm text-gray-600 mb-1 block">输入你的问题：</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例如：用简单的语言解释量子计算"
            className="w-full h-24 p-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:border-blue-400"
          />
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={handleStart}
            disabled={isStreaming || !input.trim()}
            className="flex-1 h-11 bg-blue-500 text-white rounded-xl text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
          >
            {isStreaming ? '生成中...' : '开始生成'}
          </button>
          {/* 📝 面试考点：停止按钮 — 调用 abort 中断流，保留已生成内容 */}
          {isStreaming && (
            <button
              onClick={stop}
              className="h-11 px-4 border border-red-300 text-red-500 rounded-xl text-sm active:scale-[0.98] transition-transform"
            >
              停止
            </button>
          )}
        </div>

        {/* 状态标签 */}
        {status !== 'idle' && (
          <div className="mb-2 flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded ${
              isStreaming ? 'bg-green-100 text-green-700' :
              status === 'done' ? 'bg-blue-100 text-blue-700' :
              status === 'aborted' ? 'bg-orange-100 text-orange-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {isStreaming ? '⚡ 生成中' :
               status === 'done' ? '✅ 已完成' :
               status === 'aborted' ? '⏹ 已停止' : ''}
            </span>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        {/* 流式内容展示 */}
        {(content || isStreaming) && (
          <div className="mb-4 p-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 whitespace-pre-wrap min-h-[80px] max-h-[400px] overflow-y-auto">
            {content}
            {/* 📝 面试考点：仅在生成中显示光标闪烁动画 */}
            {isStreaming && <Cursor />}
            <div ref={bottomRef} />
          </div>
        )}

        {/* 面试题区域 */}
        {moduleQuestions.length > 0 && (
          <div className="mt-6">
            <div className="text-sm font-medium text-gray-700 mb-3">📝 学习面试题</div>
            <div className="space-y-3">
              {moduleQuestions.map((q) => (
                <InterviewCard
                  key={q.id}
                  question={q.question}
                  difficulty={q.difficulty}
                  category={q.category}
                  answerPoints={q.answerPoints}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

export default Streaming
