export interface RagDocument {
  id: string;
  name: string;
  size: number;
  type: string;
  status: 'processing' | 'ready' | 'error';
  chunk_count: number;
  created_at: number;
  updated_at: number;
}

export interface RagIngestResult {
  documentId: string;
  name: string;
  chunkCount: number;
}

export interface RagQueryRequest {
  query: string;
  documentIds?: string[];
  topK?: number;
  stream?: boolean;
  systemPrompt?: string;
}

export interface RagSource {
  index: number;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface RagQueryResult {
  answer: string;
  sources: RagSource[];
}

export type RagStreamEvent =
  | { type: 'retrieval'; sources: Array<{ index: number; content: string; score: number }> }
  | { type: 'delta'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
