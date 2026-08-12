export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  documentCount: number;
}

export interface KbQueryRequest {
  knowledgeBaseId: string;
  query: string;
  topK?: number;
  includeEmbeddings?: boolean;
}

export interface KbQueryResult {
  chunks: Array<{
    content: string;
    documentName: string;
    similarity: number;
    page?: number;
  }>;
  total: number;
}
