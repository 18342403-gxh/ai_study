/**
 * RAG 编排层：将 Loader → Splitter → Embeddings → VectorStore 串联
 * 对外暴露 ingest() 和 query() 两个核心方法
 */

import { loadFromFile, loadFromString, type LoadedDocument } from './loader.js'
import { createSplitter, type TextChunk } from './splitter.js'
import { createEmbeddings } from './embeddings.js'
import { createSqliteVectorStore, type VectorSearchResult } from './vectorStore.js'
import { randomUUID } from 'crypto'

export interface RAGIngestResult {
  documentId: string
  chunkCount: number
  chunks: TextChunk[]
}

export interface RAGQueryResult {
  answer: string
  sources: Array<{
    docId: string
    content: string
    score: number
  }>
  chunks: VectorSearchResult['doc'][]
}

export function createRAGService() {
  const embeddings = createEmbeddings()
  const vectorStore = createSqliteVectorStore()
  const splitter = createSplitter({ chunkSize: 500, chunkOverlap: 50 })

  return {
    /**
     * 入库流程：加载 → 分割 → 向量化 → 存储
     */
    async ingestFromFile(filePath: string, originalName?: string): Promise<RAGIngestResult> {
      const doc = await loadFromFile(filePath, originalName)
      return this.ingestDocument(doc)
    },

    async ingestFromFileWithId(filePath: string, originalName: string | undefined, documentId: string): Promise<RAGIngestResult> {
      const doc = await loadFromFile(filePath, originalName)
      return this.ingestDocumentWithId(doc, documentId)
    },

    async ingestFromText(text: string, name = 'inline.txt'): Promise<RAGIngestResult> {
      const doc = loadFromString(text, name)
      return this.ingestDocument(doc)
    },

    async ingestDocument(doc: LoadedDocument): Promise<RAGIngestResult> {
      const documentId = randomUUID()
      return this.ingestDocumentWithId(doc, documentId)
    },

    async ingestDocumentWithId(doc: LoadedDocument, documentId: string): Promise<RAGIngestResult> {
      const chunks = await splitter.splitDocument(doc)

      const texts = chunks.map((c) => c.content)
      const vectors = await embeddings.embedDocuments(texts)

      const vectorDocs = chunks.map((chunk, i) => ({
        id: chunk.id,
        content: chunk.content,
        metadata: chunk.metadata,
        embedding: vectors[i],
      }))

      await vectorStore.addDocuments(vectorDocs, documentId)

      return {
        documentId,
        chunkCount: chunks.length,
        chunks,
      }
    },

    /**
     * 检索流程：用户 query → embedding → 向量搜索
     */
    async search(query: string, k = 4, docId?: string): Promise<VectorSearchResult[]> {
      return vectorStore.similaritySearch(query, k, docId)
    },

    /**
     * 删除文档及其向量
     */
    async deleteDocument(documentId: string): Promise<number> {
      return vectorStore.deleteByDocId(documentId)
    },
  }
}

export type RAGService = ReturnType<typeof createRAGService>
