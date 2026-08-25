export type AgentPhase =
  | 'idle'
  | 'think'
  | 'call_tools'
  | 'observe'
  | 'answer'
  | 'completed'
  | 'failed';

export type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export interface AgentState {
  threadId: string;
  phase: AgentPhase;
  status: AgentStatus;
  step: number;
  messageCount: number;
  lastAnswer?: string;
  error?: string;
}

export interface AgentStreamEvent {
  type:
    | 'state_init'
    | 'state_snapshot'
    | 'node_start'
    | 'node_complete'
    | 'on_chain_stream'
    | 'tool_call_start'
    | 'tool_call_end'
    | 'final_answer'
    | 'error'
    | 'stream_end';
  node?: AgentPhase;
  delta?: string;
  message?: string;
  content?: string;
  name?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  state?: AgentState;
  [key: string]: unknown;
}
