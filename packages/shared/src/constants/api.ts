export const API_BASE_URL =
  (typeof window !== 'undefined' && window.location?.hostname)
    ? `http://${window.location.hostname}:3000`
    : 'http://127.0.0.1:3000';

export const API_ENDPOINTS = {
  CHAT: '/api/chat',
  CHAT_STREAM: '/api/chat/stream',
  DOCUMENTS: '/api/documents',
  DOCUMENTS_UPLOAD: '/api/documents/upload',
  KB: '/api/kb',
  KB_QUERY: '/api/kb/query',
  KB_DOCUMENTS: '/api/kb/documents',
  TOOLS: '/api/tools',
} as const;

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;
