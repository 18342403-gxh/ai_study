export const API_BASE_URL =
  (typeof window !== 'undefined' && window.location?.hostname)
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : 'http://127.0.0.1:3001';

export const API_ENDPOINTS = {
  HEALTH: '/api/health',
  CHAT_COMPLETIONS: '/api/chat/completions',
  CHAT_STREAM: '/api/chat/completions',

  // Sessions
  SESSIONS: '/api/sessions',
  SESSION_MESSAGES: '/api/sessions/:id/messages',

  // RAG
  RAG_DOCUMENTS: '/api/rag/documents',
  RAG_QUERY: '/api/rag/query',
  RAG_DOCUMENT: '/api/rag/documents/:id',

  // Tools
  TOOLS_LIST: '/api/tools/list',
  TOOLS_EXECUTE: '/api/tools/execute',

  // Agent
  AGENT_RUN: '/api/agent/run',
  AGENT_STATUS: '/api/agent/status/:threadId',
  AGENT_PAUSE: '/api/agent/:threadId/pause',
  AGENT_RESUME: '/api/agent/:threadId/resume',
  AGENT_ROLLBACK: '/api/agent/:threadId/rollback',

  // Generator
  GENERATOR_RUN: '/api/generator/run',
  GENERATOR_JOBS: '/api/generator/jobs',
  GENERATOR_JOB: '/api/generator/jobs/:id',
  GENERATOR_RESUME: '/api/generator/jobs/:id/resume',

  // Knowledge Base (legacy)
  KB: '/api/kb',
  KB_QUERY: '/api/kb/query',
  KB_DOCUMENTS: '/api/kb/documents',
} as const;

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export function buildUrl(endpoint: string, params?: Record<string, string>): string {
  let url = endpoint;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url = url.replace(`:${key}`, encodeURIComponent(value));
    }
  }
  return url;
}
