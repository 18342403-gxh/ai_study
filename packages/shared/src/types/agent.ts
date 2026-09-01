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
    | 'stream_end'
    | 'harness_check';
  node?: AgentPhase;
  delta?: string;
  message?: string;
  content?: string;
  name?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  state?: AgentState;
  /** Harness 检查结果 */
  harness?: HarnessCheckResult;
  [key: string]: unknown;
}

/** Harness 检查结果 */
export interface HarnessCheckResult {
  /** 检查点名称：input_safety | tool_policy | output_guardrail */
  name: 'input_safety' | 'tool_policy' | 'output_guardrail' | string;
  /** pass | block | warn */
  result: 'pass' | 'block' | 'warn';
  /** 具体说明 */
  reason?: string;
  /** 触发的规则名 */
  rule?: string;
  /** 时间戳 */
  timestamp?: number;
}
