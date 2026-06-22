/**
 * 知识点 6.7/6.8：RAG 主页面
 *
 * 学习要点：
 * - 文档管理 + 问答功能组合
 * - 文档分块逻辑（按段落拆分）
 * - Tab 切换布局
 */

import { useState, useCallback } from 'react'

import Layout from '../../components/Layout'
import InterviewCard from '../../components/InterviewCard'
import DocumentUpload from './DocumentUpload'
import DocumentList from './DocumentList'
import CitationCard from './CitationCard'
import { useRag } from './useRag'
import { interviewQuestions } from '../../data/interview-questions'
import type { RagDocument, DocumentChunk } from './types'

/** 生成唯一 ID */
const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * 📝 面试考点：文档分块策略
 * 按段落分割，每块不超过 500 字符
 * 实际项目中会用更复杂的策略（重叠窗口、语义分割等）
 */
const splitIntoChunks = (content: string): DocumentChunk[] => {
  const paragraphs = content.split(/\n\n+/)
  const chunks: DocumentChunk[] = []
  let currentChunk = ''
  let index = 0

  for (const para of paragraphs) {
    if (currentChunk.length + para.length > 500) {
      if (currentChunk.trim()) {
        chunks.push({ id: generateId(), content: currentChunk.trim(), index })
        index++
      }
      currentChunk = para
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para
    }
  }
  // 最后一块
  if (currentChunk.trim()) {
    chunks.push({ id: generateId(), content: currentChunk.trim(), index })
  }

  return chunks
}

const RagPage: React.FC = () => {
  const [documents, setDocuments] = useState<RagDocument[]>([])
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'docs' | 'chat'>('docs')
  const { isProcessing, answer, error, handleAsk } = useRag()

  /** 文件读取完成后，分块并加入文档列表 */
  const handleFileLoaded = useCallback((name: string, content: string) => {
    const chunks = splitIntoChunks(content)
    const newDoc: RagDocument = {
      id: generateId(),
      name,
      size: content.length,
      status: 'ready',
      chunks,
      createdAt: Date.now(),
    }
    setDocuments((prev) => [...prev, newDoc])
  }, [])

  const handleDeleteDoc = useCallback((docId: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== docId))
  }, [])

  const handleSubmitQuery = useCallback(() => {
    if (!query.trim()) return
    handleAsk(query.trim(), documents)
  }, [query, documents, handleAsk])

  const moduleQuestions = interviewQuestions.filter((q) => q.moduleId === 6)
  const hasDocuments = documents.length > 0

  return (
    <Layout title="RAG 知识库">
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
            <DocumentUpload onFileLoaded={handleFileLoaded} />
            <div className="mt-4">
              <DocumentList documents={documents} onDelete={handleDeleteDoc} />
            </div>
          </div>
        )}

        {/* 知识问答 Tab */}
        {activeTab === 'chat' && (
          <div>
            {!hasDocuments && (
              <div className="glass-card rounded-xl p-4 text-center mb-4">
                <p className="text-sm text-slate-400">请先上传文档，再进行知识问答</p>
              </div>
            )}

            {/* 提问输入 */}
            <div className="mb-4">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="基于文档提问..."
                disabled={!hasDocuments}
                className="tech-input w-full h-20 p-3 rounded-xl text-sm resize-none disabled:opacity-40"
              />
              <button
                onClick={handleSubmitQuery}
                disabled={isProcessing || !query.trim() || !hasDocuments}
                className="mt-2 w-full h-11 btn-glow text-white rounded-xl text-sm font-medium disabled:opacity-40"
              >
                {isProcessing ? '检索中...' : '提问'}
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
              <div className="space-y-3">
                <div className="glass-card rounded-xl p-3">
                  <div className="text-xs text-slate-400 mb-1">回答：</div>
                  <div className="text-sm text-slate-200 whitespace-pre-wrap">
                    {answer.answer}
                  </div>
                </div>

                {/* 引用来源 */}
                {answer.citations.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-400 mb-2">引用来源：</div>
                    <div className="space-y-2">
                      {answer.citations.map((citation) => (
                        <CitationCard key={citation.chunkId} citation={citation} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
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

export default RagPage
