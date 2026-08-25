export interface ApiErrorResponse {
  error: {
    message: string;
    code: string;
    stack?: string;
  };
}

export interface StreamErrorEvent {
  type: 'error';
  message: string;
}

export interface StreamDoneEvent {
  type: 'done';
}
