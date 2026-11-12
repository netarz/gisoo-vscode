/**
 * Host <-> webview contract for Gisoo for VS Code.
 *
 * This file is the single source of truth. The extension host (src/) and the chat UI (webview/)
 * both import it. Do not post a message that is not declared here. Keep it free of runtime
 * imports so both bundles can include it.
 */

// ---------------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------------

export type PermissionMode = 'ask' | 'autoEdit' | 'plan';
export type Region = 'global' | 'iran';
export type UiLanguage = 'en' | 'fa';

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  contextLength: number;
  maxOutputTokens?: number;
  vision: boolean;
  reasoning: boolean;
  isFree: boolean;
  /** USD per 1M tokens. Undefined when the catalogue does not say. */
  inputPerMillion?: number;
  outputPerMillion?: number;
  cachedInputPerMillion?: number;
  recommended: boolean;
}

export interface AccountInfo {
  signedIn: boolean;
  /** e.g. "$4.21" exactly as /me returns it in balance.usd_display. Never a Toman amount. */
  balanceDisplay?: string;
  balanceUsd?: number;
  status?: string;
  projectName?: string;
  keyName?: string;
  keyPrefix?: string;
  spendLimitUsd?: number | null;
  spentUsd?: number;
  baseUrl: string;
  region: Region;
  /** Set when the last /me call failed (offline, 401...). */
  error?: string;
}

export interface Attachment {
  kind: 'file' | 'selection' | 'image';
  /** Workspace-relative path for file/selection. */
  path?: string;
  /** 1-based inclusive range for a selection. */
  startLine?: number;
  endLine?: number;
  /** For images: data URI (image/png|jpeg|webp|gif), max 5 MB. */
  dataUri?: string;
  /** Short label for the chip. */
  label: string;
}

export interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'done';
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  /** Estimated USD for this turn from /models pricing; undefined if pricing unknown. */
  costUsd?: number;
}

export type ToolStatus =
  | 'pending'        // model asked, not started
  | 'awaiting'       // waiting for the user's approval
  | 'running'
  | 'done'
  | 'error'
  | 'rejected'       // the user said no
  | 'cancelled';     // run stopped

export interface ToolCallView {
  id: string;
  name: string;
  /** One line, e.g. "Read src/app.ts (lines 1-200)". */
  title: string;
  status: ToolStatus;
  /** Pretty-printed JSON input (truncated to 4k for display). */
  input: string;
  /** Output for display (truncated to 8k). */
  output?: string;
  /** For write_file / edit_file. */
  edit?: {
    path: string;
    added: number;
    removed: number;
    /** Unified diff, truncated to 20k chars. */
    diff: string;
    isNewFile: boolean;
  };
  /** For run_command. */
  command?: {
    command: string;
    cwd: string;
    exitCode?: number | null;
  };
  /** For ask_user. */
  question?: {
    text: string;
    options?: string[];
    answer?: string;
  };
}

/** A piece of an assistant turn, in the order it happened. */
export type AssistantPart =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; call: ToolCallView }
  | { kind: 'notice'; level: 'info' | 'warning' | 'error'; text: string; code?: string };

export interface UserTurnView {
  role: 'user';
  id: string;
  text: string;
  attachments: Attachment[];
  /** true when it was queued during a run and injected mid-run. */
  injected?: boolean;
  createdAt: number;
}

export interface AssistantTurnView {
  role: 'assistant';
  id: string;
  model: string;
  parts: AssistantPart[];
  usage?: Usage;
  durationMs?: number;
  /** true while streaming. */
  streaming: boolean;
  stopped?: boolean;
  /** A checkpoint exists for this turn (it wrote files). */
  hasCheckpoint: boolean;
  createdAt: number;
}

export interface SummaryTurnView {
  role: 'summary';
  id: string;
  text: string;
  createdAt: number;
}

export type TurnView = UserTurnView | AssistantTurnView | SummaryTurnView;

/**
 * How a message sent during a run is delivered: `steer` is injected at the next model-call boundary
 * without stopping the task (default); `queue` waits until the task has finished and starts a new one.
 */
export type MessageDelivery = 'steer' | 'queue';

export interface QueuedMessage {
  id: string;
  text: string;
  attachments: Attachment[];
  delivery?: MessageDelivery;
}

export type AgentStatus = 'running' | 'waiting' | 'done' | 'failed' | 'stopped';

/** A sub-agent started by the `task` tool (or a background session). */
export interface AgentInfo {
  id: string;
  /** The tool call (or agent) that started it. */
  parentId?: string;
  sessionId: string;
  name: string;
  model: string;
  status: AgentStatus;
  startedAt: number;
  endedAt?: number;
  /** Prompt + completion tokens so far. */
  tokens: number;
  costUsd: number;
  /** One line: the last tool call or "thinking". */
  lastStep?: string;
}

export interface SessionView {
  id: string;
  title: string;
  model: string;
  mode: PermissionMode;
  turns: TurnView[];
  queue: QueuedMessage[];
  todos: Todo[];
  running: boolean;
  /** Total estimated USD for the session. */
  costUsd: number;
  /** Rough share of the model context in use, 0..1. */
  contextUsed: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  turnCount: number;
}

export interface SlashCommandInfo {
  name: string;          // without the slash
  description: string;   // already localised
  /** builtin, or a custom command from .gisoo/commands or .claude/commands (project or user). */
  source?: 'builtin' | 'project' | 'user';
}

/** An instruction, memory or skill file the agent loaded into its context. */
export interface ContextFileInfo {
  kind: 'instructions' | 'memory' | 'skill';
  scope: 'user' | 'project' | 'local';
  /** Short label, e.g. 'GISOO.md', 'CLAUDE.md (user)', 'Claude memory'. */
  label: string;
  /** Absolute path; the webview only shows it and sends it back in file.open. */
  path: string;
  /** Approximate tokens it adds to every request. */
  tokens: number;
}

export interface InitState {
  language: UiLanguage;
  account: AccountInfo;
  models: ModelInfo[];
  session: SessionView;
  /** Recent sessions for the history panel (also sent as a `sessions` message). */
  sessions?: SessionSummary[];
  slashCommands: SlashCommandInfo[];
  contextFiles: ContextFileInfo[];
  showCost: boolean;
  /** Localised UI strings keyed by id; the webview falls back to English keys. */
  strings: Record<string, string>;
  /** Product version for the footer of the account panel. */
  version: string;
}

// ---------------------------------------------------------------------------
// Webview -> host
// ---------------------------------------------------------------------------

export type WebviewToHost =
  | { type: 'ready' }
  /** While running, `delivery` decides between steering (default) and queueing until the task ends. */
  | { type: 'send'; text: string; attachments: Attachment[]; delivery?: MessageDelivery }
  | { type: 'queue.edit'; id: string; text: string }
  | { type: 'queue.remove'; id: string }
  | { type: 'stop' }
  | { type: 'retry' }
  | { type: 'session.new' }
  | { type: 'session.open'; id: string }
  | { type: 'session.delete'; id: string }
  | { type: 'session.list' }
  | { type: 'model.set'; id: string }
  | { type: 'models.refresh' }
  | { type: 'mode.set'; mode: PermissionMode }
  | { type: 'approval'; callId: string; decision: 'accept' | 'reject' | 'always'; note?: string }
  | { type: 'answer'; callId: string; answer: string }
  | { type: 'diff.open'; callId: string }
  | { type: 'file.open'; path: string; line?: number }
  | { type: 'checkpoint.restore'; turnId: string }
  | { type: 'files.search'; query: string; requestId: number }
  | { type: 'attach.activeFile' }
  | { type: 'attach.selection' }
  | { type: 'code.copy'; code: string }
  | { type: 'code.insert'; code: string }
  | { type: 'code.newFile'; code: string; language?: string }
  | { type: 'account.refresh' }
  | { type: 'auth.signIn' }
  | { type: 'auth.apiKey' }
  | { type: 'auth.enterCode' }
  | { type: 'auth.signOut' }
  | { type: 'link.open'; url: string }
  | { type: 'plan.start' }
  | { type: 'memory.open' }
  | { type: 'context.reload' }
  | { type: 'preview.open'; path: string }
  | { type: 'agent.stop'; id: string }
  /** Show one agent's transcript in a read-only editor. */
  | { type: 'agent.open'; id: string }
  /** Run a finished agent again with the same prompt and definition. */
  | { type: 'agent.retry'; id: string };

// ---------------------------------------------------------------------------
// Host -> webview
// ---------------------------------------------------------------------------

export type HostToWebview =
  | { type: 'init'; state: InitState }
  /** Replace the whole session (load, switch, after compaction, after restore). */
  | { type: 'session'; session: SessionView }
  | { type: 'sessions'; items: SessionSummary[] }
  | { type: 'account'; account: AccountInfo }
  | { type: 'models'; models: ModelInfo[]; current: string }
  | { type: 'mode'; mode: PermissionMode }
  | { type: 'running'; running: boolean }
  /** A turn was added (user turn, new assistant turn, summary). */
  | { type: 'turn.add'; turn: TurnView }
  /** Append text to the last part of the given kind in an assistant turn (creates it if needed). */
  | { type: 'turn.delta'; turnId: string; kind: 'text' | 'thinking'; text: string }
  /** Add or replace a tool call view inside an assistant turn (matched by call.id). */
  | { type: 'turn.tool'; turnId: string; call: ToolCallView }
  | { type: 'turn.notice'; turnId: string; level: 'info' | 'warning' | 'error'; text: string; code?: string }
  /** Turn finished (or stopped). */
  | { type: 'turn.end'; turnId: string; usage?: Usage; durationMs: number; stopped: boolean; hasCheckpoint: boolean }
  | { type: 'queue'; queue: QueuedMessage[] }
  | { type: 'todos'; todos: Todo[] }
  | { type: 'cost'; costUsd: number; contextUsed: number }
  | { type: 'files.result'; requestId: number; paths: string[] }
  | { type: 'attach'; attachment: Attachment }
  /** Put text into the input (e.g. from a code action) and optionally send it. */
  | { type: 'prefill'; text: string; send: boolean; attachments?: Attachment[] }
  | { type: 'focus' }
  | { type: 'toast'; level: 'info' | 'warning' | 'error'; text: string }
  | { type: 'context'; files: ContextFileInfo[] }
  | { type: 'slashCommands'; items: SlashCommandInfo[] }
  /** Full list of agents (on init / session switch). */
  | { type: 'agents'; items: AgentInfo[] }
  /** One agent started, progressed or finished. */
  | { type: 'agentUpdate'; item: AgentInfo }
  /** Open the agents panel (from `/agents` or a command). */
  | { type: 'agents.show' };

/** Error codes the host uses in notices so the UI can offer the right button. */
export const NoticeCodes = {
  insufficientCredit: 'insufficient_credit',
  invalidKey: 'invalid_api_key',
  rateLimited: 'rate_limited',
  network: 'network',
  server: 'server',
  maxSteps: 'max_steps',
  modelNotFound: 'model_not_found',
  maxCost: 'max_cost',
  timeout: 'timeout',
} as const;

export const Links = {
  addCredit: 'https://gisoo.pro/app/credit',
  keys: 'https://gisoo.pro/app/api/keys',
  page: 'https://gisoo.pro/vscode',
  docs: 'https://gisoo.pro/docs',
  repo: 'https://github.com/netarz/gisoo-vscode',
} as const;
