/**
 * 知识点 7.8：Agent 主页面
 *
 * 功能：
 * - 任务输入（发送后才清空）
 * - 示例任务快捷按钮
 * - 执行时间线实时展示
 * - 最终回答流式打字机效果
 * - 中断/重置操作
 */

import { useState, useRef, useEffect } from 'react'

import Layout from '../../components/Layout'
import MarkdownRenderer from '../../components/MarkdownRenderer'
import InterviewCard from '../../components/InterviewCard'
import AgentTimeline from './AgentTimeline'
import { useAgent } from './useAgent'
import { interviewQuestions } from '../../data/interview-questions'

const EXAMPLE_TASKS = [
  '帮我查一下北京和上海的天气，对比哪个更适合出门',
  '现在几点了？帮我算一下距离18点下班还有多久',
  '计算 (15 + 7) * 3 的结果，告诉我这个数是否是偶数',
]

const AgentPage: React.FC = () => {
  const [input, setInput] = useState('')
  const { steps, status, error, streamingContent, handleStart, handleStop, handleReset } = useAgent()
  const bottomRef = useRef<HTMLDivElement>(null)

  const isRunning = status === 'running'
  const isCompleted = status === 'completed'

  // 步骤变化时自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps.length, streamingContent])

  // 发送任务 — 只在这里清空输入
  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed || isRunning) return
    handleStart(trimmed)
    setInput('')
  }

  const handleExampleClick = (task: string) => {
    if (isRunning) return
    handleStart(task)
  }

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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder="描述一个需要多步骤完成的任务...&#10;例如：查两个城市的天气并对比"
            className="tech-input w-full h-24 p-3 rounded-xl text-sm resize-none"
            disabled={isRunning}
          />
        </div>

        {/* 示例任务 */}
        {!isRunning && steps.length === 0 && (
          <div className="mb-4">
            <div className="text-xs text-slate-500 mb-2">试试这些任务：</div>
            <div className="space-y-2">
              {EXAMPLE_TASKS.map((task) => (
                <button
                  key={task}
                  type="button"
                  onClick={() => handleExampleClick(task)}
                  className="w-full px-3 py-2.5 text-left text-xs bg-slate-700/30 text-slate-300 rounded-lg border border-slate-600/30 active:scale-[0.98] transition-transform"
                >
                  {task}
                </button>
              ))}
            </div>
          </div>
        )}

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
          {(isCompleted || status === 'failed') && (
            <button
              onClick={handleReset}
              className="h-11 px-4 border border-slate-600 text-slate-300 rounded-xl text-sm"
            >
              重置
            </button>
          )}
        </div>

        {/* Agent 状态指示器 */}
        {status !== 'idle' && (
          <div className="mb-3 flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              isRunning ? 'bg-indigo-400 animate-pulse' :
              isCompleted ? 'bg-emerald-400' :
              'bg-rose-400'
            }`} />
            <span className={`text-xs ${
              isRunning ? 'text-indigo-400' :
              isCompleted ? 'text-emerald-400' :
              'text-rose-400'
            }`}>
              {isRunning ? '执行中' :
               isCompleted ? '已完成' :
               '已中断'}
            </span>
            <span className="text-xs text-slate-500 ml-auto">{steps.length} 步</span>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-sm text-rose-400">
            {error}
          </div>
        )}

        {/* 执行时间线 */}
        {steps.length > 0 && (
          <div className="mb-4">
            <AgentTimeline steps={steps} isStreaming={isRunning} />
          </div>
        )}

        {/* 最终回答（带打字机效果的独立展示区） */}
        {isCompleted && streamingContent && (
          <div className="mb-4 glass-card rounded-xl p-4">
            <div className="text-xs text-emerald-400 mb-2">最终回答</div>
            <div className="text-sm text-slate-200">
              <MarkdownRenderer content={streamingContent} />
            </div>
          </div>
        )}

        {/* 滚动锚点 */}
        <div ref={bottomRef} />

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
