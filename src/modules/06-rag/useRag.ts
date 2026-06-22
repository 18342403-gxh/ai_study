/**
 * 知识点 6.5：RAG 问答 Hook
 *
 * 学习要点：
 * - 前端模拟 RAG：把文档分块拼入 System Prompt
 * - 简单的文本相关度匹配（关键词命中）
 * - 构造带引用的回答结构
 *
 * 面试相关：
 * - RAG 的完整架构
 * - 前端如何实现简单的文本检索
 */

import { useState, useCallback } from 'react'

import { chatCompletion } from '../../services/ai'
import type { RagDocument, DocumentChunk, Citation, RagAnswer } from './types'

interface UseRagReturn {
  isProcessing: boolean
  answer: RagAnswer | null
  error: string
  handleAsk: (query: string, documents: RagDocument[]) => Promise<void>
}

/**
 * 📝 面试考点：简单的文本相关度计算
 * 实际项目中用向量相似度（余弦相似度），这里用关键词/字符命中模拟
 * 中文没有空格分隔，采用逐字符和短语匹配
 */
const calculateRelevance = (query: string, chunk: string): number => {
  const queryLower = query.toLowerCase()
  const chunkLower = chunk.toLowerCase()

  // 策略1：完整查询在块中出现
  if (chunkLower.includes(queryLower)) {
    return 1.0
  }

  // 策略2：将查询拆为2-4字的片段，计算命中率
  const fragments: string[] = []
  for (let len = Math.min(4, queryLower.length); len >= 2; len--) {
    for (let i = 0; i <= queryLower.length - len; i++) {
      fragments.push(queryLower.slice(i, i + len))
    }
  }

  if (fragments.length === 0) {
    // 查询太短，直接判断包含关系
    return chunkLower.includes(queryLower) ? 0.8 : 0
  }

  // 计算命中的片段比例
  const hitCount = fragments.filter((f) => chunkLower.includes(f)).length
  return hitCount / fragments.length
}

/**
 * 📝 面试考点：检索最相关的 Top-K 个文档块
 * 实际项目中这一步由向量数据库完成（如 Pinecone、pgvector）
 */
const retrieveRelevantChunks = (
  query: string,
  documents: RagDocument[],
  topK: number = 3
): { chunk: DocumentChunk; source: string; score: number }[] => {
  const scored: { chunk: DocumentChunk; source: string; score: number }[] = []

  for (const doc of documents) {
    if (doc.status !== 'ready') continue
    for (const chunk of doc.chunks) {
      const score = calculateRelevance(query, chunk.content)
      // 相关度大于 0.1 才认为有关联（中文片段匹配分数偏低）
      if (score > 0.1) {
        scored.push({ chunk, source: doc.name, score })
      }
    }
  }

  // 如果没有任何命中，退而取所有块的前几个（保证至少有上下文）
  if (scored.length === 0) {
    for (const doc of documents) {
      if (doc.status !== 'ready') continue
      for (const chunk of doc.chunks.slice(0, topK)) {
        scored.push({ chunk, source: doc.name, score: 0.1 })
      }
    }
  }

  // 按相关度降序，取 Top-K
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

export const useRag = (): UseRagReturn => {
  const [isProcessing, setIsProcessing] = useState(false)
  const [answer, setAnswer] = useState<RagAnswer | null>(null)
  const [error, setError] = useState('')

  const handleAsk = useCallback(async (query: string, documents: RagDocument[]) => {
    if (!query.trim() || isProcessing) return

    setIsProcessing(true)
    setError('')
    setAnswer(null)

    try {
      // 检索相关文档块
      const relevant = retrieveRelevantChunks(query, documents)

      // 📝 面试考点：将检索到的文档块拼入 System Prompt（"穷人版 RAG"）
      const contextText = relevant.length > 0
        ? relevant.map((r, i) => `[${i + 1}] ${r.chunk.content}`).join('\n\n')
        : '（未找到相关文档内容）'

      const systemPrompt = `你是一个知识库问答助手。请根据以下参考文档来回答用户的问题。
如果参考文档中包含答案，请基于文档内容回答并在末尾标注引用编号如[1][2]。
如果文档中没有相关信息，请诚实告知用户。

参考文档：
${contextText}`

      const response = await chatCompletion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
      })

      const answerContent = response.choices[0]?.message?.content || '未能生成回答'

      // 构造引用信息
      const citations: Citation[] = relevant.map((r, i) => ({
        chunkId: r.chunk.id,
        content: r.chunk.content,
        source: r.source,
        score: r.score,
        chunkIndex: i + 1,
      }))

      setAnswer({ answer: answerContent, citations })
    } catch (err) {
      setError(err instanceof Error ? err.message : '问答失败')
    } finally {
      setIsProcessing(false)
    }
  }, [isProcessing])

  return { isProcessing, answer, error, handleAsk }
}
