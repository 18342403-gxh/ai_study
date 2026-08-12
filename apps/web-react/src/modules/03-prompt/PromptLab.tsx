/**
 * 知识点 3.3/3.8：Prompt 实验室页面
 */

import { useState, useEffect } from 'react'
import Layout from '../../components/Layout'
import InterviewCard from '../../components/InterviewCard'
import JsonRenderer from './JsonRenderer'
import { useConversation } from './useConversation'
import { presets } from './presets'
import { interviewQuestions } from '../../data/interview-questions'

const STORAGE_KEY = 'prompt-lab-custom-prompt'
const MAX_TOKENS_DISPLAY = 4000

const PromptLab: React.FC = () => {
  const [selectedPresetId, setSelectedPresetId] = useState('default')
  const [customPrompt, setCustomPrompt] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || ''
  })
  const [showEditor, setShowEditor] = useState(false)
  const [input, setInput] = useState('')

  const currentPreset = presets.find((p) => p.id === selectedPresetId)
  const activePrompt = showEditor ? customPrompt : (currentPreset?.systemPrompt || '')

  const { messages, isStreaming, error, tokenCount, send, stop, clear, setSystemPrompt } = useConversation(activePrompt)

  useEffect(() => {
    if (!showEditor && currentPreset) {
      setSystemPrompt(currentPreset.systemPrompt)
    }
  }, [selectedPresetId, showEditor, currentPreset, setSystemPrompt])

  const handleCustomPromptChange = (value: string) => {
    setCustomPrompt(value)
    localStorage.setItem(STORAGE_KEY, value)
  }

  const applyCustomPrompt = () => {
    if (customPrompt.trim()) {
      setSystemPrompt(customPrompt)
    }
  }

  const handleSend = () => {
    if (!input.trim() || isStreaming) return
    send(input.trim())
    setInput('')
  }

  const isJsonMode = selectedPresetId === 'json-output'
  const visibleMessages = messages.filter((m) => m.role !== 'system')
  const moduleQuestions = interviewQuestions.filter((q) => q.moduleId === 3)

  return (
    <Layout title="Prompt 工程">
      <div className="px-4 py-4">
        {/* 预设选择器 */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-slate-400">System Prompt 模板：</label>
            <button
              type="button"
              onClick={() => setShowEditor(!showEditor)}
              className="text-xs text-indigo-400"
            >
              {showEditor ? '使用预设' : '自定义编辑'}
            </button>
          </div>

          {!showEditor ? (
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedPresetId(preset.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                    selectedPresetId === preset.id
                      ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/50'
                      : 'bg-slate-700/50 text-slate-400 border border-slate-600/50'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          ) : (
            <div>
              <textarea
                value={customPrompt}
                onChange={(e) => handleCustomPromptChange(e.target.value)}
                placeholder="输入你的 System Prompt..."
                className="tech-input w-full h-32 p-3 rounded-xl text-xs resize-none"
              />
              <button
                type="button"
                onClick={applyCustomPrompt}
                className="mt-2 px-3 py-1.5 btn-glow text-white rounded-lg text-xs"
              >
                应用
              </button>
            </div>
          )}

          {!showEditor && currentPreset && (
            <div className="mt-2 p-2 bg-slate-800/50 rounded-lg max-h-20 overflow-y-auto border border-slate-700/50">
              <p className="text-xs text-slate-500 whitespace-pre-wrap line-clamp-3">
                {currentPreset.systemPrompt}
              </p>
            </div>
          )}
        </div>

        {/* Token 计数 */}
        <div className="mb-3 flex items-center gap-3">
          <span className="text-xs text-slate-500">
            Token 估算：<span className="font-medium text-slate-300">{tokenCount}</span> / {MAX_TOKENS_DISPLAY}
          </span>
          <button type="button" onClick={clear} className="text-xs text-rose-400 ml-auto">
            清空对话
          </button>
        </div>

        {/* 对话区域 */}
        <div className="mb-4 space-y-2 max-h-[300px] overflow-y-auto glass-card rounded-xl p-3">
          {visibleMessages.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">发送消息开始对话...</p>
          ) : (
            visibleMessages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${
                  msg.role === 'user'
                    ? 'bg-indigo-500/80 text-white'
                    : 'bg-slate-700/60 text-slate-200'
                }`}>
                  {msg.role === 'assistant' && isJsonMode ? (
                    <JsonRenderer content={msg.content} />
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                </div>
              </div>
            ))
          )}
          {isStreaming && (
            <div className="flex justify-start">
              <div className="px-3 py-2 bg-slate-700/60 rounded-xl text-sm text-slate-400">
                生成中...
              </div>
            </div>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-3 p-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-400">
            {error}
          </div>
        )}

        {/* 输入区 */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleSend()}
            placeholder="输入消息..."
            className="tech-input flex-1 h-11 px-3 rounded-xl text-sm"
          />
          {isStreaming ? (
            <button onClick={stop} className="h-11 px-4 border border-rose-500/50 text-rose-400 rounded-xl text-sm">
              停止
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="h-11 px-4 btn-glow text-white rounded-xl text-sm"
            >
              发送
            </button>
          )}
        </div>

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

export default PromptLab
