/**
 * 知识点 1.5/1.8：页面组件组装
 */

import { useState } from 'react'
import Layout from '../../components/Layout'
import InterviewCard from '../../components/InterviewCard'
import { useChat } from './useChat'
import { interviewQuestions } from '../../data/interview-questions'
import type { Message } from './types'

const ApiBasics: React.FC = () => {
  const [input, setInput] = useState('')
  const { reply, isLoading, error, send, cancel } = useChat()

  const handleSend = () => {
    if (!input.trim() || isLoading) return
    const messages: Message[] = [{ role: 'user', content: input.trim() }]
    send(messages)
  }

  const moduleQuestions = interviewQuestions.filter((q) => q.moduleId === 1)

  return (
    <Layout title="AI API 基础调用">
      <div className="px-4 py-4">
        {/* 输入区 */}
        <div className="mb-4">
          <label className="text-xs text-slate-400 mb-1 block">输入你的问题：</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例如：什么是人工智能？"
            className="tech-input w-full h-24 p-3 rounded-xl text-sm resize-none"
          />
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="flex-1 h-11 btn-glow text-white rounded-xl text-sm font-medium active:scale-[0.98] transition-transform"
          >
            {isLoading ? '请求中...' : '发送请求'}
          </button>
          {isLoading && (
            <button
              onClick={cancel}
              className="h-11 px-4 border border-slate-600 text-slate-300 rounded-xl text-sm active:scale-[0.98] transition-transform"
            >
              取消
            </button>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-sm text-rose-400">
            {error}
          </div>
        )}

        {/* 响应结果 */}
        {reply && (
          <div className="mb-4">
            <div className="text-xs text-slate-400 mb-1">响应结果：</div>
            <div className="glass-card p-3 rounded-xl text-sm text-slate-200 whitespace-pre-wrap">
              {reply}
            </div>
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

export default ApiBasics
