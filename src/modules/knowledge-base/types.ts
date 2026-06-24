/** 知识库模块类型定义 */

export interface KbDocument {
  id: string
  name: string
  size: number
  type: string
  status: 'processing' | 'ready' | 'failed'
  chunk_count: number
  created_at: number
  updated_at: number
}

export interface KbCitation {
  index: number
  content: string
  source: string
  score: number
}
