/** Tool contract shared by every tool. Free of VS Code imports so the registry can be unit-tested. */
import type { ToolCallView, Todo } from '../shared/protocol';
import type { ToolDefinition } from '../api/types';
import type { ToolPermission } from './permissions';

export interface ToolResult {
  /** Text handed back to the model (truncated to 30k by the agent). */
  content: string;
  /** Display-only output (defaults to content). */
  display?: string;
  isError?: boolean;
  /** Extra view data (edit diff, command exit code, question). */
  view?: Partial<Pick<ToolCallView, 'edit' | 'command' | 'question' | 'title'>>;
}

export interface PreparedEdit {
  absolutePath: string;
  relativePath: string;
  oldContent: string | null;
  newContent: string;
  diff: string;
  added: number;
  removed: number;
  isNewFile: boolean;
}

/** What a tool may ask from the host while running. */
export interface ToolContext {
  signal: AbortSignal;
  /** Live output for command cards. */
  onProgress?: (text: string) => void;
  /** Pauses the run until the user answers (ask_user). */
  askUser: (question: string, options?: string[]) => Promise<string>;
  /** Replaces the visible plan. */
  setTodos: (todos: Todo[]) => void;
  /** Checkpoint a file before the first write in this turn. */
  checkpoint: (absolutePath: string, previous: string | null) => void;
  /** Settings the tools need. */
  settings: { webFetchEnabled: boolean };
}

export interface Tool<TInput = Record<string, unknown>> {
  name: string;
  description: string;
  permission: ToolPermission;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
  /** One-line title for the card, e.g. "Read src/app.ts (lines 1-200)". */
  title(input: TInput): string;
  /** Read-only tools without side effects may run in parallel. */
  readOnly: boolean;
  /** For edit tools: prepare the change (diff) before asking the user; applied by `run` after approval. */
  prepare?(input: TInput, ctx: ToolContext): Promise<PreparedEdit>;
  run(input: TInput, ctx: ToolContext, prepared?: PreparedEdit): Promise<ToolResult>;
}

export function toDefinition(tool: Tool<never>): ToolDefinition {
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

export const TOOL_RESULT_MAX_CHARS = 30_000;

export function truncateResult(text: string, max = TOOL_RESULT_MAX_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated: ${text.length - max} more characters not shown]`;
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed) as Record<string, unknown>;
}
