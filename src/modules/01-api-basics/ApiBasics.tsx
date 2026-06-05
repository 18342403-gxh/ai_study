/**
 * 知识点 1.5/1.8：页面组件组装
 *
 * 学习要点：
 * - 表单受控组件（textarea value + onChange）
 * - 事件处理与条件渲染
 * - Loading 状态与 disabled 按钮
 * - 组件组合模式
 *
 * 面试相关：
 * - React 受控组件 vs 非受控组件
 * - 如何防止重复提交
 */

import { useState } from 'react'
import Layout from '../../components/Layout'
import InterviewCard from '../../components/InterviewCard'
import { useChat } from './useChat'
import { interviewQuestions } from '../../data/interview-questions'
import type { Message } from './types'

const ApiBasics: React.FC = () => {
  const [input, setInput] = useState('')
  const { reply, loading, error, send, cancel } = useChat()

  // 📝 面试考点：受控组件 — 表单值由 React state 驱动
  const handleSend = () => {
    if (!input.trim() || loading) return

    const messages: Message[] = [
      { role: 'user', content: input.trim() },
    ]
    send(messages)
  }

  // 获取模块 1 的面试题
  const moduleQuestions = interviewQuestions.filter((q) => q.moduleId === 1)

  return (
    <Layout title="AI API 基础调用">
      <div className="px-4 py-4">
        {/* 输入区 */}
        <div className="mb-4">
          <label className="text-sm text-gray-600 mb-1 block">输入你的问题：</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例如：什么是人工智能？"
            className="w-full h-24 p-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:border-blue-400"
          />
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 mb-4">
          {/* 📝 面试考点：disabled 防止重复提交 */}
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="flex-1 h-11 bg-blue-500 text-white rounded-xl text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
          >
            {loading ? '请求中...' : '发送请求'}
          </button>
          {loading && (
            <button
              onClick={cancel}
              className="h-11 px-4 border border-gray-300 text-gray-600 rounded-xl text-sm active:scale-[0.98] transition-transform"
            >
              取消
            </button>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        {/* 响应结果 */}
        {reply && (
          <div className="mb-4">
            <div className="text-sm text-gray-600 mb-1">响应结果：</div>
            <div className="p-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 whitespace-pre-wrap">
              {reply}
            </div>
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

export default ApiBasics
