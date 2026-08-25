export interface Session {
  id: string;
  title: string;
  model?: string;
  system_prompt?: string;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata?: string;
  created_at: number;
}

export interface SessionListResponse {
  sessions: Session[];
}

export interface SessionDetailResponse {
  session: Session;
  messages: Message[];
}
