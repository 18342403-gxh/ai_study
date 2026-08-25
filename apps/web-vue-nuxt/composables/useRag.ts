/**
 * useRag — RAG 文档管理 Composable
 * 
 * 连接 BFF /api/rag 系列接口
 * 支持文档上传、列表、删除、RAG 查询
 */

import { ref, computed } from 'vue'
import type { RagDocument, RagIngestResult, RagQueryResult, RagStreamEvent } from '@ai-study/shared'

const documents = ref<RagDocument[]>([])
const isLoading = ref(false)
const isUploading = ref(false)
const isDeleting = ref(false)
const lastResult = ref<RagQueryResult | null>(null)
const streamingAnswer = ref('')
const streamingSources = ref<RagQueryResult['sources']>([])
const error = ref<string | null>(null)

export function useRag() {
  const config = useRuntimeConfig()
  const bffUrl = config.public.bffUrl || 'http://localhost:3001'
  const baseUrl = `${bffUrl}/api/rag`

  const loadDocuments = async () => {
    isLoading.value = true
    error.value = null
    try {
      const res = await fetch(`${baseUrl}/documents`)
      if (!res.ok) throw new Error(`获取文档列表失败: ${res.status}`)
      documents.value = await res.json()
    } catch (err) {
      error.value = err instanceof Error ? err.message : '请求失败'
    } finally {
      isLoading.value = false
    }
  }

  const uploadDocument = async (file: File): Promise<RagIngestResult | null> => {
    isUploading.value = true
    error.value = null
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('name', file.name)

      const res = await fetch(`${baseUrl}/documents`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText || `上传失败: ${res.status}`)
      }
      const result: RagIngestResult = await res.json()
      await loadDocuments()
      return result
    } catch (err) {
      error.value = err instanceof Error ? err.message : '上传失败'
      return null
    } finally {
      isUploading.value = false
    }
  }

  const deleteDocument = async (id: string): Promise<boolean> => {
    isDeleting.value = true
    error.value = null
    try {
      const res = await fetch(`${baseUrl}/documents/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(`删除失败: ${res.status}`)
      documents.value = documents.value.filter((d) => d.id !== id)
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : '删除失败'
      return false
    } finally {
      isDeleting.value = false
    }
  }

  const queryRagStream = async (
    query: string,
    documentIds?: string[],
    topK: number = 4,
    abortSignal?: AbortSignal
  ) => {
    streamingAnswer.value = ''
    streamingSources.value = []
    error.value = null

    try {
      const res = await fetch(`${baseUrl}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          documentIds,
          topK,
          stream: true,
        }),
        signal: abortSignal,
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText || `RAG 查询失败: ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('无法获取响应流')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        buffer += chunk

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const event: RagStreamEvent = JSON.parse(data)
            handleEvent(event)
          } catch {}
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      error.value = err instanceof Error ? err.message : 'RAG 查询失败'
    }
  }

  const handleEvent = (event: RagStreamEvent) => {
    switch (event.type) {
      case 'retrieval':
        if (event.sources) {
          streamingSources.value = event.sources.map((s) => ({
            index: s.index,
            content: s.content,
            score: s.score,
          }))
        }
        break
      case 'delta':
        if (event.content) {
          streamingAnswer.value += event.content
        }
        break
      case 'error':
        error.value = event.message
        break
      case 'done':
        lastResult.value = {
          answer: streamingAnswer.value,
          sources: streamingSources.value,
        }
        break
    }
  }

  const queryRag = async (
    query: string,
    documentIds?: string[],
    topK: number = 4
  ): Promise<RagQueryResult | null> => {
    error.value = null
    streamingAnswer.value = ''
    streamingSources.value = []

    try {
      const res = await fetch(`${baseUrl}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          documentIds,
          topK,
          stream: false,
        }),
      })
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText || `RAG 查询失败: ${res.status}`)
      }
      const result: RagQueryResult = await res.json()
      lastResult.value = result
      return result
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'RAG 查询失败'
      return null
    }
  }

  const clearResult = () => {
    lastResult.value = null
    streamingAnswer.value = ''
    streamingSources.value = []
    error.value = null
  }

  return {
    documents,
    isLoading,
    isUploading,
    isDeleting,
    lastResult,
    streamingAnswer,
    streamingSources,
    error,
    loadDocuments,
    uploadDocument,
    deleteDocument,
    queryRag,
    queryRagStream,
    clearResult,
  }
}
