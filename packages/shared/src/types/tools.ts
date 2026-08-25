export interface ToolDefinition {
  name: string;
  description: string;
  schema?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}

export interface ToolInfo {
  id: string;
  name: string;
  description: string;
}

export interface ToolExecuteRequest {
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolExecuteResult {
  toolName: string;
  result: unknown;
  success?: boolean;
  error?: string;
}
