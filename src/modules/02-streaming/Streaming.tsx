/**
 * 知识点 2.5/2.7/2.8：流式响应页面
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
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (status === 'streaming') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [content, status])

  const handleStart = () => {
    if (!input.trim() || status === 'streaming') return
    const messages: Message[] = [{ role: 'user', content: input.trim() }]
    start(messages)
  }

  const isStreaming = status === 'streaming'
  const moduleQuestions = interviewQuestions.filter((q) => q.moduleId === 2)

  return (
    <Layout title="流式响应">
      <div className="px-4 py-4">
        {/* 输入区 */}
        <div className="mb-4">
          <label className="text-xs text-slate-400 mb-1 block">输入你的问题：</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例如：用简单的语言解释量子计算"
            className="tech-input w-full h-24 p-3 rounded-xl text-sm resize-none"
          />
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={handleStart}
            disabled={isStreaming || !input.trim()}
            className="flex-1 h-11 btn-glow text-white rounded-xl text-sm font-medium active:scale-[0.98] transition-transform"
          >
            {isStreaming ? '生成中...' : '开始生成'}
          </button>
          {isStreaming && (
            <button
              onClick={stop}
              className="h-11 px-4 border border-rose-500/50 text-rose-400 rounded-xl text-sm active:scale-[0.98] transition-transform"
            >
              停止
            </button>
          )}
        </div>

        {/* 状态标签 */}
        {status !== 'idle' && (
          <div className="mb-2 flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded ${
              isStreaming ? 'bg-emerald-500/20 text-emerald-400' :
              status === 'done' ? 'bg-indigo-500/20 text-indigo-400' :
              status === 'aborted' ? 'bg-amber-500/20 text-amber-400' :
              'bg-slate-700 text-slate-400'
            }`}>
              {isStreaming ? '● 生成中' :
               status === 'done' ? '● 已完成' :
               status === 'aborted' ? '● 已停止' : ''}
            </span>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-sm text-rose-400">
            {error}
          </div>
        )}

        {/* 流式内容展示 */}
        {(content || isStreaming) && (
          <div className="mb-4 glass-card p-3 rounded-xl text-sm text-slate-200 whitespace-pre-wrap min-h-[80px] max-h-[400px] overflow-y-auto">
            {content}
            {isStreaming && <Cursor />}
            <div ref={bottomRef} />
          </div>
        )}

        {/* 面试题区域 */}
        {moduleQuestions.length > 0 && (
          <div className="mt-6">
            <div className="text-sm font-medium text-slate-300 mb-3">学习面试题</div>
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
