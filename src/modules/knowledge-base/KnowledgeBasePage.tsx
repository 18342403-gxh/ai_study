/**
 * 知识库主页面 — Dify 风格
 * 深色 + 紫色渐变 + 精细化商业 UI
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { LeftOutline, ContentOutline, SearchOutline } from 'antd-mobile-icons'
import { useNavigate } from 'react-router-dom'

import MarkdownRenderer from '../../components/MarkdownRenderer'
import KbDocUpload from './KbDocUpload'
import KbDocList from './KbDocList'
import KbCitationCard from './KbCitationCard'
import type { KbDocument, KbCitation } from './types'

const API_BASE = 'http://localhost:3001/api'

const KnowledgeBasePage: React.FC = () => {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'docs' | 'chat'>('docs')
  const [documents, setDocuments] = useState<KbDocument[]>([])
  const [query, setQuery] = useState('')
  const [isQuerying, setIsQuerying] = useState(false)
  const [answer, setAnswer] = useState('')
  const [citations, setCitations] = useState<KbCitation[]>([])
  const [error, setError] = useState('')
  const [isCitationsExpanded, setIsCitationsExpanded] = useState(false)
  const answerRef = useRef<HTMLDivElement>(null)

  // 加载文档列表
  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/documents`)
      if (res.ok) {
        const data = await res.json()
        setDocuments(data)
      }
    } catch {
      // 后端未启动时静默
    }
  }, [])

  useEffect(() => { fetchDocuments() }, [fetchDocuments])

  // 轮询 processing 状态
  useEffect(() => {
    const hasProcessing = documents.some((d) => d.status === 'processing')
    if (!hasProcessing) return
    const timer = setInterval(fetchDocuments, 3000)
    return () => clearInterval(timer)
  }, [documents, fetchDocuments])

  const handleDeleteDoc = useCallback(async (docId: string) => {
    await fetch(`${API_BASE}/documents/${docId}`, { method: 'DELETE' })
    setDocuments((prev) => prev.filter((d) => d.id !== docId))
  }, [])

  const handleUploadComplete = useCallback(() => { fetchDocuments() }, [fetchDocuments])

  // 知识问答（SSE 流式）
  const handleQuery = useCallback(async () => {
    if (!query.trim() || isQuerying) return
    setIsQuerying(true)
    setAnswer('')
    setCitations([])
    setError('')
    setIsCitationsExpanded(false)

    try {
      const res = await fetch(`${API_BASE}/kb/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || '问答失败')
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('无法获取响应流')

      const decoder = new TextDecoder()
      let buffer = ''
      let fullAnswer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'citations') { setCitations(parsed.citations); continue }
            if (parsed.type === 'error') { setError(parsed.error); continue }
            const content = parsed.choices?.[0]?.delta?.content
            if (content) {
              fullAnswer += content
              setAnswer(fullAnswer)
              answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
            }
          } catch { /* 非 JSON 跳过 */ }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '问答失败')
    } finally {
      setIsQuerying(false)
    }
  }, [query, isQuerying])

  // 统计
  const totalDocs = documents.length
  const readyDocs = documents.filter((d) => d.status === 'ready').length
  const totalChunks = documents.reduce((sum, d) => sum + (d.chunk_count || 0), 0)
  const hasReadyDocs = readyDocs > 0

  return (
    <div className="h-screen flex flex-col tech-gradient-bg">
      {/* 顶部栏 */}
      <header className="shrink-0 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 mb-3">
          <button type="button" onClick={() => navigate(-1)} className="text-slate-400">
            <LeftOutline />
          </button>
          <div className="flex-1">
            <h1 className="text-base font-semibold gradient-text">知识库</h1>
            <p className="text-xs text-slate-500">企业级文档问答系统</p>
          </div>
          <ContentOutline className="text-indigo-400 text-lg" />
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="glass-card rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-indigo-300">{totalDocs}</div>
            <div className="text-xs text-slate-500">文档数</div>
          </div>
          <div className="glass-card rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-cyan-300">{totalChunks}</div>
            <div className="text-xs text-slate-500">知识块</div>
          </div>
          <div className="glass-card rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-emerald-300">{readyDocs}</div>
            <div className="text-xs text-slate-500">可用</div>
          </div>
        </div>

        {/* Tab */}
        <div className="flex bg-slate-800/60 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab('docs')}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === 'docs'
                ? 'bg-indigo-500/40 text-indigo-200 shadow-sm'
                : 'text-slate-400'
            }`}
          >
            文档管理
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === 'chat'
                ? 'bg-indigo-500/40 text-indigo-200 shadow-sm'
                : 'text-slate-400'
            }`}
          >
            智能问答
          </button>
        </div>
      </header>

      {/* 内容区 */}
      <main className="flex-1 overflow-y-auto px-4 pb-6">
        {activeTab === 'docs' && (
          <div className="pt-3">
            <KbDocUpload apiBase={API_BASE} onComplete={handleUploadComplete} />
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400 font-medium">已上传文档</span>
                <span className="text-xs text-slate-600">{totalDocs} 个</span>
              </div>
              <KbDocList documents={documents} onDelete={handleDeleteDoc} />
            </div>
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="pt-3">
            {/* 搜索/提问区 */}
            <div className="relative mb-4">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                <SearchOutline fontSize={14} />
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleQuery()
                }}
                placeholder={hasReadyDocs ? '基于知识库提问...' : '请先上传文档'}
                disabled={!hasReadyDocs}
                className="tech-input w-full h-11 pl-9 pr-20 rounded-xl text-sm disabled:opacity-40"
              />
              <button
                onClick={handleQuery}
                disabled={isQuerying || !query.trim() || !hasReadyDocs}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-3 btn-glow text-white rounded-lg text-xs disabled:opacity-30"
              >
                {isQuerying ? '检索中' : '提问'}
              </button>
            </div>

            {/* 空状态 */}
            {!hasReadyDocs && !answer && (
              <div className="text-center py-12">
                <ContentOutline className="text-3xl text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-400">上传文档后即可开始智能问答</p>
                <p className="text-xs text-slate-600 mt-1">支持 PDF、TXT、Markdown 格式</p>
              </div>
            )}

            {/* 错误 */}
            {error && (
              <div className="mb-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400">
                {error}
              </div>
            )}

            {/* 回答区域 */}
            {(answer || isQuerying) && (
              <div className="space-y-3" ref={answerRef}>
                {/* 用户问题 */}
                <div className="flex justify-end">
                  <div className="max-w-[85%] px-3 py-2 bg-indigo-500/60 text-white text-sm rounded-2xl rounded-br-md">
                    {query}
                  </div>
                </div>

                {/* AI 回答 */}
                <div className="glass-card rounded-2xl rounded-bl-md p-4">
                  {isQuerying && !answer && (
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                      <span className="text-xs text-slate-400">正在检索知识库...</span>
                    </div>
                  )}
                  {answer && (
                    <div className="text-sm text-slate-200">
                      <MarkdownRenderer content={answer} />
                    </div>
                  )}
                </div>

                {/* 引用来源 */}
                {citations.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setIsCitationsExpanded(!isCitationsExpanded)}
                      className="text-xs text-indigo-400 mb-2 flex items-center gap-1"
                    >
                      <span>{isCitationsExpanded ? '▼' : '▶'}</span>
                      <span>引用来源 ({citations.length})</span>
                    </button>
                    {isCitationsExpanded && (
                      <div className="space-y-2">
                        {citations.map((c) => (
                          <KbCitationCard key={c.index} citation={c} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

export default KnowledgeBasePage
