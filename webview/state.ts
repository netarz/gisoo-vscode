import type {
  AccountInfo,
  AgentInfo,
  AssistantPart,
  AssistantTurnView,
  HostToWebview,
  InitState,
  ModelInfo,
  PermissionMode,
  QueuedMessage,
  SessionSummary,
  SessionView,
  SlashCommandInfo,
  Todo,
  ToolCallView,
  TurnView,
  UiLanguage,
} from '../src/shared/protocol';

export interface Toast {
  id: number;
  level: 'info' | 'warning' | 'error';
  text: string;
}

export interface AppState {
  ready: boolean;
  language: UiLanguage;
  account: AccountInfo;
  models: ModelInfo[];
  session: SessionView;
  sessions: SessionSummary[];
  slashCommands: SlashCommandInfo[];
  showCost: boolean;
  version: string;
  toasts: Toast[];
  /** Pending files.search results keyed by requestId. */
  fileResults: { requestId: number; paths: string[] } | null;
  /** Text (and attachments) the host asked us to put into the input. */
  prefill: { text: string; send: boolean; attachments?: import('../src/shared/protocol').Attachment[]; seq: number } | null;
  /** Attachment pushed by the host (attach current file / selection). */
  attachSeq: number;
  attachQueue: import('../src/shared/protocol').Attachment[];
  focusSeq: number;
  /** Running and finished sub-agents (SPEC-phase2 §8), newest update last. */
  agents: AgentInfo[];
  /** Bumped when the host asks to open the agents panel. */
  agentsShowSeq: number;
}

export const emptySession: SessionView = {
  id: '',
  title: '',
  model: '',
  mode: 'ask',
  turns: [],
  queue: [],
  todos: [],
  running: false,
  costUsd: 0,
  contextUsed: 0,
};

export const initialState: AppState = {
  ready: false,
  language: 'en',
  account: { signedIn: false, baseUrl: '', region: 'global' },
  models: [],
  session: emptySession,
  sessions: [],
  slashCommands: [],
  showCost: true,
  version: '',
  toasts: [],
  fileResults: null,
  prefill: null,
  attachSeq: 0,
  attachQueue: [],
  focusSeq: 0,
  agents: [],
  agentsShowSeq: 0,
};

export type Action =
  | HostToWebview
  | { type: 'ui.toast.dismiss'; id: number }
  | { type: 'ui.toast'; level: Toast['level']; text: string }
  | { type: 'ui.attach.consumed' };

let toastSeq = 0;
let prefillSeq = 0;

function withSession(state: AppState, session: Partial<SessionView>): AppState {
  return { ...state, session: { ...state.session, ...session } };
}

function updateTurn(state: AppState, turnId: string, fn: (turn: AssistantTurnView) => AssistantTurnView): AppState {
  const turns = state.session.turns;
  const idx = turns.findIndex((turn) => turn.id === turnId && turn.role === 'assistant');
  if (idx < 0) {
    return state;
  }
  const next = turns.slice();
  next[idx] = fn(turns[idx] as AssistantTurnView);
  return withSession(state, { turns: next });
}

export function applyDelta(turn: AssistantTurnView, kind: 'text' | 'thinking', text: string): AssistantTurnView {
  const parts = turn.parts.slice();
  const last = parts[parts.length - 1];
  if (last && last.kind === kind) {
    parts[parts.length - 1] = { kind, text: last.text + text } as AssistantPart;
  } else {
    parts.push({ kind, text } as AssistantPart);
  }
  return { ...turn, parts };
}

function upsertTool(turn: AssistantTurnView, call: ToolCallView): AssistantTurnView {
  const parts = turn.parts.slice();
  const idx = parts.findIndex((part) => part.kind === 'tool' && part.call.id === call.id);
  if (idx >= 0) {
    parts[idx] = { kind: 'tool', call };
  } else {
    parts.push({ kind: 'tool', call });
  }
  return { ...turn, parts };
}

function pushToast(state: AppState, level: Toast['level'], text: string): AppState {
  const toast: Toast = { id: ++toastSeq, level, text };
  return { ...state, toasts: [...state.toasts.slice(-3), toast] };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'init': {
      const init: InitState = action.state;
      return {
        ...state,
        ready: true,
        language: init.language,
        account: init.account,
        models: init.models,
        session: init.session,
        slashCommands: init.slashCommands,
        showCost: init.showCost,
        version: init.version,
      };
    }
    case 'session':
      return { ...state, session: action.session };
    case 'sessions':
      return { ...state, sessions: action.items };
    case 'account':
      return { ...state, account: action.account };
    case 'models':
      return withSession({ ...state, models: action.models }, { model: action.current });
    case 'mode':
      return withSession(state, { mode: action.mode as PermissionMode });
    case 'running':
      return withSession(state, { running: action.running });
    case 'turn.add': {
      const turn: TurnView = action.turn;
      const existing = state.session.turns.findIndex((item) => item.id === turn.id);
      const turns = state.session.turns.slice();
      if (existing >= 0) {
        turns[existing] = turn;
      } else {
        turns.push(turn);
      }
      return withSession(state, { turns });
    }
    case 'turn.delta':
      return updateTurn(state, action.turnId, (turn) => applyDelta(turn, action.kind, action.text));
    case 'turn.tool':
      return updateTurn(state, action.turnId, (turn) => upsertTool(turn, action.call));
    case 'turn.notice':
      return updateTurn(state, action.turnId, (turn) => ({
        ...turn,
        parts: [...turn.parts, { kind: 'notice', level: action.level, text: action.text, code: action.code }],
      }));
    case 'turn.end':
      return updateTurn(state, action.turnId, (turn) => ({
        ...turn,
        streaming: false,
        usage: action.usage ?? turn.usage,
        durationMs: action.durationMs,
        stopped: action.stopped,
        hasCheckpoint: action.hasCheckpoint,
      }));
    case 'queue':
      return withSession(state, { queue: action.queue as QueuedMessage[] });
    case 'todos':
      return withSession(state, { todos: action.todos as Todo[] });
    case 'cost':
      return withSession(state, { costUsd: action.costUsd, contextUsed: action.contextUsed });
    case 'files.result':
      return { ...state, fileResults: { requestId: action.requestId, paths: action.paths } };
    case 'attach':
      return { ...state, attachSeq: state.attachSeq + 1, attachQueue: [...state.attachQueue, action.attachment] };
    case 'ui.attach.consumed':
      return { ...state, attachQueue: [] };
    case 'prefill':
      return { ...state, prefill: { text: action.text, send: action.send, attachments: action.attachments, seq: ++prefillSeq } };
    case 'focus':
      return { ...state, focusSeq: state.focusSeq + 1 };
    case 'toast':
      return pushToast(state, action.level, action.text);
    case 'ui.toast':
      return pushToast(state, action.level, action.text);
    case 'ui.toast.dismiss':
      return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) };
    case 'agents':
      return { ...state, agents: action.items };
    case 'agentUpdate': {
      const idx = state.agents.findIndex((item) => item.id === action.item.id);
      const agents = state.agents.slice();
      if (idx >= 0) {
        agents[idx] = action.item;
      } else {
        agents.push(action.item);
      }
      return { ...state, agents };
    }
    case 'agents.show':
      return { ...state, agentsShowSeq: state.agentsShowSeq + 1 };
    default:
      return state;
  }
}

/** The last assistant turn, if any. */
export function lastAssistantTurn(session: SessionView): AssistantTurnView | undefined {
  for (let i = session.turns.length - 1; i >= 0; i--) {
    const turn = session.turns[i];
    if (turn.role === 'assistant') {
      return turn;
    }
  }
  return undefined;
}
