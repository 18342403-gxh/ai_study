/**
 * 知识点 7.8：Agent 主页面
 *
 * 学习要点：
 * - 输入区 + 时间线 + 状态指示器布局
 * - Agent 运行状态展示
 * - 中断和重置操作
 */

import { useState } from 'react'

import Layout from '../../components/Layout'
import InterviewCard from '../../components/InterviewCard'
import AgentTimeline from './AgentTimeline'
import { useAgent } from './useAgent'
import { interviewQuestions } from '../../data/interview-questions'

const EXAMPLE_TASKS = [
  '帮我查一下北京和上海的天气，对比一下哪个更适合出门',
  '现在几点了？帮我算一下距离下班还有多久（假设6点下班）',
  '计算 (15 + 7) * 3 的结果，然后告诉我这个数是否是偶数',
]

const AgentPage: React.FC = () => {
  const [input, setInput] = useState('')
  const { steps, status, error, handleStart, handleStop, handleReset } = useAgent()

  const handleSubmit = () => {
    if (!input.trim() || status === 'running') return
    handleStart(input.trim())
    setInput('')
  }

  const handleExampleClick = (task: string) => {
    if (status === 'running') return
    setInput(task)
    handleStart(task)
  }

  const isRunning = status === 'running'
  const moduleQuestions = interviewQuestions.filter((q) => q.moduleId === 7)

  return (
    <Layout title="AI Agent">
      <div className="px-4 py-4">
        {/* 输入区 */}
        <div className="mb-4">
          <label className="text-xs text-slate-400 mb-1 block">给 Agent 一个任务：</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="描述一个需要多步骤完成的任务..."
            className="tech-input w-full h-20 p-3 rounded-xl text-sm resize-none"
          />
        </div>

        {/* 示例任务 */}
        <div className="flex flex-wrap gap-2 mb-4">
          {EXAMPLE_TASKS.map((task) => (
            <button
              key={task}
              type="button"
              onClick={() => handleExampleClick(task)}
              disabled={isRunning}
              className="px-2.5 py-1 text-xs bg-slate-700/50 text-slate-300 rounded-lg border border-slate-600/50 disabled:opacity-40 text-left"
            >
              {task.length > 20 ? task.slice(0, 20) + '...' : task}
            </button>
          ))}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={handleSubmit}
            disabled={isRunning || !input.trim()}
            className="flex-1 h-11 btn-glow text-white rounded-xl text-sm font-medium active:scale-[0.98] transition-transform"
          >
            {isRunning ? '执行中...' : '开始执行'}
          </button>
          {isRunning && (
            <button
              onClick={handleStop}
              className="h-11 px-4 border border-rose-500/50 text-rose-400 rounded-xl text-sm"
            >
              中断
            </button>
          )}
          {steps.length > 0 && !isRunning && (
            <button
              onClick={handleReset}
              className="h-11 px-4 border border-slate-600 text-slate-300 rounded-xl text-sm"
            >
              重置
            </button>
          )}
        </div>

        {/* Agent 状态 */}
        {status !== 'idle' && (
          <div className="mb-3 flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded ${
              isRunning ? 'bg-indigo-500/20 text-indigo-400' :
              status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
              status === 'failed' ? 'bg-rose-500/20 text-rose-400' :
              'bg-slate-700 text-slate-400'
            }`}>
              {isRunning ? '● 执行中' :
               status === 'completed' ? '● 已完成' :
               status === 'failed' ? '● 已中断' :
               status === 'paused' ? '● 已暂停' : ''}
            </span>
            <span className="text-xs text-slate-500">{steps.length} 步</span>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-sm text-rose-400">
            {error}
          </div>
        )}

        {/* 执行时间线 */}
        <AgentTimeline steps={steps} />

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

export default AgentPage
