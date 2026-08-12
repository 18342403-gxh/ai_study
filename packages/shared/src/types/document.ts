export interface Document {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: number;
  chunks: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  embedding?: number[];
  page?: number;
}

export interface UploadResponse {
  success: boolean;
  documentId: string;
  message?: string;
}
