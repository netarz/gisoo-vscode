/** Session data: API messages plus the view the webview renders. Pure. */
import type { AssistantTurnView, PermissionMode, SessionView, SummaryTurnView, Todo, TurnView, UserTurnView } from '../shared/protocol';
import type { ChatMessage } from '../api/types';

export interface SessionData {
  id: string;
  title: string;
  model: string;
  mode: PermissionMode;
  createdAt: number;
  updatedAt: number;
  /** Conversation as sent to the API, without the system prompt (built fresh each run). */
  messages: ChatMessage[];
  turns: TurnView[];
  todos: Todo[];
  costUsd: number;
  /** Session-level "Always allow" command words. */
  allowedCommands: string[];
}

export function newId(prefix = 's'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createSession(model: string, mode: PermissionMode): SessionData {
  const now = Date.now();
  return { id: newId(), title: '', model, mode, createdAt: now, updatedAt: now, messages: [], turns: [], todos: [], costUsd: 0, allowedCommands: [] };
}

/** First line of the first user message, trimmed to 60 characters. */
export function titleFromText(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return '';
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}...` : line;
}

export function toSessionView(data: SessionData, running: boolean, queue: SessionView['queue'], contextUsed: number): SessionView {
  return {
    id: data.id,
    title: data.title,
    model: data.model,
    mode: data.mode,
    turns: data.turns,
    queue,
    todos: data.todos,
    running,
    costUsd: data.costUsd,
    contextUsed,
  };
}

export function userTurn(text: string, attachments: UserTurnView['attachments'], injected = false): UserTurnView {
  return { role: 'user', id: newId('u'), text, attachments, injected: injected || undefined, createdAt: Date.now() };
}

export function assistantTurn(model: string): AssistantTurnView {
  return { role: 'assistant', id: newId('a'), model, parts: [], streaming: true, hasCheckpoint: false, createdAt: Date.now() };
}

export function summaryTurn(text: string): SummaryTurnView {
  return { role: 'summary', id: newId('m'), text, createdAt: Date.now() };
}

/** Marks every turn as not streaming (after a crash or reload). */
export function settleTurns(turns: TurnView[]): TurnView[] {
  return turns.map((t) => {
    if (t.role !== 'assistant' || !t.streaming) return t;
    const parts = t.parts.map((p) => (p.kind === 'tool' && (p.call.status === 'running' || p.call.status === 'awaiting' || p.call.status === 'pending') ? { ...p, call: { ...p.call, status: 'cancelled' as const } } : p));
    return { ...t, parts, streaming: false, stopped: true };
  });
}
