export type GeneratorPhase =
  | 'idle'
  | 'clarify'
  | 'retrieve'
  | 'generate'
  | 'preview'
  | 'iterate'
  | 'completed'
  | 'failed';

export type GeneratorStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export interface GeneratorState {
  jobId: string;
  phase: GeneratorPhase;
  status: GeneratorStatus;
  userInput: string;
  clarifiedInput?: string;
  retrievedTemplates?: Array<{ id: string; name: string; similarity: number }>;
  generatedCode?: string;
  previewResult?: { success: boolean; errors: string[] };
  iterationCount: number;
  maxIterations: number;
  error?: string;
}

export interface GeneratorStreamEvent {
  type:
    | 'state_init'
    | 'state_update'
    | 'phase_start'
    | 'phase_complete'
    | 'templates_found'
    | 'code_stream'
    | 'code_complete'
    | 'preview_errors'
    | 'clarify_needed'
    | 'generation_complete'
    | 'generation_failed'
    | 'stream_end';
  phase?: GeneratorPhase;
  message?: string;
  state?: GeneratorState;
  templates?: Array<{ id: string; name: string; similarity: number; preview: string }>;
  delta?: string;
  code?: string;
  errors?: string[];
  questions?: string[];
  iterations?: number;
  reason?: string;
  bestCode?: string;
  knownIssues?: string[];
  [key: string]: unknown;
}

export interface GeneratorJob {
  id: string;
  input: string;
  status: GeneratorStatus;
  state_json?: string;
  created_at: number;
  updated_at: number;
}
