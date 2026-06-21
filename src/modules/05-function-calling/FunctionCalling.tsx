/**
 * 知识点 5.5-5.8：Function Calling 主页面
 *
 * 学习要点：
 * - 工具调用流程的完整 UI 展示
 * - 步骤时间线布局
 * - 发送支持工具调用的请求
 */

import { useState } from 'react'

import Layout from '../../components/Layout'
import InterviewCard from '../../components/InterviewCard'
import ToolCallCard from './ToolCallCard'
import { useToolChat } from './useToolChat'
import { interviewQuestions } from '../../data/interview-questions'

const EXAMPLE_PROMPTS = [
  '北京今天天气怎么样？',
  '帮我计算 (12 + 8) * 3.5',
  '现在几点了？',
  '上海和深圳哪个更热？',
]

const FunctionCalling: React.FC = () => {
  const [input, setInput] = useState('')
  const { steps, isProcessing, error, handleSend, handleReset } = useToolChat()

  const handleSubmit = () => {
    if (!input.trim() || isProcessing) return
    handleSend(input.trim())
    setInput('')
  }

  const handleExampleClick = (prompt: string) => {
    if (isProcessing) return
    setInput(prompt)
    handleSend(prompt)
  }

  const moduleQuestions = interviewQuestions.filter((q) => q.moduleId === 5)

  return (
    <Layout title="Function Calling">
      <div className="px-4 py-4">
        {/* 输入区 */}
        <div className="mb-4">
          <label className="text-xs text-slate-400 mb-1 block">试试让 AI 调用工具：</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例如：北京天气怎么样？"
            className="tech-input w-full h-20 p-3 rounded-xl text-sm resize-none"
          />
        </div>

        {/* 快捷示例 */}
        <div className="flex flex-wrap gap-2 mb-4">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => handleExampleClick(prompt)}
              disabled={isProcessing}
              className="px-2.5 py-1 text-xs bg-slate-700/50 text-slate-300 rounded-lg border border-slate-600/50 disabled:opacity-40"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={handleSubmit}
            disabled={isProcessing || !input.trim()}
            className="flex-1 h-11 btn-glow text-white rounded-xl text-sm font-medium active:scale-[0.98] transition-transform"
          >
            {isProcessing ? '处理中...' : '发送'}
          </button>
          {steps.length > 0 && (
            <button
              onClick={handleReset}
              className="h-11 px-4 border border-slate-600 text-slate-300 rounded-xl text-sm"
            >
              重置
            </button>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-sm text-rose-400">
            {error}
          </div>
        )}

        {/* 工具调用步骤展示 */}
        {steps.length > 0 && (
          <div className="mb-4 space-y-2">
            <div className="text-xs text-slate-400 mb-2">执行过程：</div>
            {steps.map((step) => (
              <ToolCallCard key={step.id} step={step} />
            ))}
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

export default FunctionCalling
