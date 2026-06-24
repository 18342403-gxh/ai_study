/**
 * 知识库主页面
 * 企业级 RAG 知识库：文档管理 + 向量问答
 * 连接 Node BFF 后端（http://localhost:3001）
 */

import { useState, useEffect, useCallback } from 'react'

import Layout from '../../components/Layout'
import MarkdownRenderer from '../../components/MarkdownRenderer'
import KbDocUpload from './KbDocUpload'
import KbDocList from './KbDocList'
import KbCitationCard from './KbCitationCard'
import type { KbDocument, KbCitation } from './types'

const API_BASE = 'http://localhost:3001/api'

const KnowledgeBasePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'docs' | 'chat'>('docs')
  const [documents, setDocuments] = useState<KbDocument[]>([])
  const [query, setQuery] = useState('')
  const [isQuerying, setIsQuerying] = useState(false)
  const [answer, setAnswer] = useState('')
  const [citations, setCitations] = useState<KbCitation[]>([])
  const [error, setError] = useState('')

  // 加载文档列表
  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/documents`)
      if (res.ok) {
        const data = await res.json()
        setDocuments(data)
      }
    } catch {
      // 后端未启动时静默处理
    }
  }, [])

  // 页面加载和上传完成后刷新列表
  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  // 定时刷新（检查 processing 状态的文档是否已完成）
  useEffect(() => {
    const hasProcessing = documents.some((d) => d.status === 'processing')
    if (!hasProcessing) return

    const timer = setInterval(fetchDocuments, 3000)
    return () => clearInterval(timer)
  }, [documents, fetchDocuments])

  // 删除文档
  const handleDeleteDoc = useCallback(async (docId: string) => {
    try {
      await fetch(`${API_BASE}/documents/${docId}`, { method: 'DELETE' })
      setDocuments((prev) => prev.filter((d) => d.id !== docId))
    } catch {
      setError('删除失败')
    }
  }, [])

  // 上传完成回调
  const handleUploadComplete = useCallback(() => {
    fetchDocuments()
  }, [fetchDocuments])

  // 知识库问答（流式）
  const handleQuery = useCallback(async () => {
    if (!query.trim() || isQuerying) return

    setIsQuerying(true)
    setAnswer('')
    setCitations([])
    setError('')

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

      // 解析 SSE 流
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

            // 处理引用数据（第一个 SSE 事件）
            if (parsed.type === 'citations') {
              setCitations(parsed.citations)
              continue
            }

            // 处理错误
            if (parsed.type === 'error') {
              setError(parsed.error)
              continue
            }

            // 处理流式文本内容
            const content = parsed.choices?.[0]?.delta?.content
            if (content) {
              fullAnswer += content
              setAnswer(fullAnswer)
            }
          } catch {
            // 非 JSON 行跳过
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '问答失败')
    } finally {
      setIsQuerying(false)
    }
  }, [query, isQuerying])

  const hasDocuments = documents.length > 0
  const hasReadyDocs = documents.some((d) => d.status === 'ready')

  return (
    <Layout title="知识库" showBack={true}>
      <div className="px-4 py-4">
        {/* Tab 切换 */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setActiveTab('docs')}
            className={`flex-1 h-9 rounded-lg text-xs transition-colors ${
              activeTab === 'docs'
                ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/50'
                : 'bg-slate-700/50 text-slate-400 border border-slate-600/50'
            }`}
          >
            文档管理 ({documents.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`flex-1 h-9 rounded-lg text-xs transition-colors ${
              activeTab === 'chat'
                ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/50'
                : 'bg-slate-700/50 text-slate-400 border border-slate-600/50'
            }`}
          >
            知识问答
          </button>
        </div>

        {/* 文档管理 Tab */}
        {activeTab === 'docs' && (
          <div>
            <KbDocUpload apiBase={API_BASE} onComplete={handleUploadComplete} />
            <div className="mt-4">
              <KbDocList documents={documents} onDelete={handleDeleteDoc} />
            </div>
          </div>
        )}

        {/* 知识问答 Tab */}
        {activeTab === 'chat' && (
          <div>
            {!hasReadyDocs && (
              <div className="glass-card rounded-xl p-4 text-center mb-4">
                <p className="text-sm text-slate-400">
                  {hasDocuments ? '文档正在处理中，请稍候...' : '请先上传文档，再进行知识问答'}
                </p>
              </div>
            )}

            {/* 问答输入 */}
            <div className="mb-4">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    handleQuery()
                  }
                }}
                placeholder="基于知识库提问..."
                disabled={!hasReadyDocs}
                className="tech-input w-full h-20 p-3 rounded-xl text-sm resize-none disabled:opacity-40"
              />
              <button
                onClick={handleQuery}
                disabled={isQuerying || !query.trim() || !hasReadyDocs}
                className="mt-2 w-full h-11 btn-glow text-white rounded-xl text-sm font-medium disabled:opacity-40"
              >
                {isQuerying ? '检索回答中...' : '提问'}
              </button>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-sm text-rose-400">
                {error}
              </div>
            )}

            {/* 回答展示 */}
            {answer && (
              <div className="mb-4 glass-card rounded-xl p-4">
                <div className="text-xs text-indigo-400 mb-2">回答</div>
                <div className="text-sm text-slate-200">
                  <MarkdownRenderer content={answer} />
                </div>
              </div>
            )}

            {/* 引用来源 */}
            {citations.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-slate-400">引用来源：</div>
                {citations.map((citation) => (
                  <KbCitationCard key={citation.index} citation={citation} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}

export default KnowledgeBasePage
