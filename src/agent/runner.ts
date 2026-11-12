/**
 * SessionController: the agent loop behind the chat view (SPEC section 5) plus sessions, queue and
 * steer, approvals, checkpoints, slash commands and sub-agents (SPEC-phase2 section 8).
 *
 * One controller owns one current session at a time. It talks to the webview only through
 * HostToWebview messages (the `post` dependency) and receives WebviewToHost messages via `handle`.
 * API keys never pass through here: the client reads them from AuthService on each request.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { agentCatalogue, findAgent, loadAgentDefinitions, type AgentDefinition } from '../agents/definitions';
import { graphPromptSection } from '../graph';
import { previewManager } from '../preview/manager';
import { WEB_WORK_PROMPT } from '../preview/tools';
import { GisooError, type GisooClient } from '../api/client';
import { addUsage, estimateCostUsd, formatUsd, usageFromWire } from '../api/cost';
import { catalogue, DEFAULT_MODEL, fallbackModel } from '../api/models';
import type { ChatMessage, ChatRequest, ContentPart, ToolCall } from '../api/types';
import type { AuthService } from '../auth/service';
import { userSetting, type GisooSettings } from '../config';
import { detectInitSources, initPrompt } from '../context/claude';
import { expandCommand, findCommand } from '../context/commands';
import type { ContextProvider } from '../context/provider';
import { Checkpoints } from '../edits/checkpoints';
import type { SessionStore } from '../sessions/store';
import {
  Links,
  NoticeCodes,
  type AgentInfo,
  type AgentStatus,
  type AssistantTurnView,
  type Attachment,
  type HostToWebview,
  type MessageDelivery,
  type ModelInfo,
  type PermissionMode,
  type QueuedMessage,
  type SlashCommandInfo,
  type ToolCallView,
  type ToolStatus,
  type UiLanguage,
  type Usage,
  type WebviewToHost,
} from '../shared/protocol';
import type { RegisteredTool, ToolVisibility } from '../tools';
import { commandPrefixWord, decide, PLAN_MODE_DENIAL, type PermissionSettings } from '../tools/permissions';
import { defaultShell, runShell } from '../tools/process';
import { parseToolArguments, toDefinition, truncateResult, type PreparedEdit, type Tool, type ToolContext, type ToolResult } from '../tools/types';
import { formatWithLineNumbers, primaryRoot, readText, relativeToWorkspace, resolvePath, workspaceRoots } from '../tools/workspace';
import { baseInitState, fileAttachment, selectionAttachment } from '../ui/chatViewProvider';
import { hostStr, SLASH_DESCRIPTIONS, str, type HostStringKey, type StringKey } from '../ui/strings';
import { applyCompaction, contextShare, needsCompaction, splitForCompaction, SUMMARY_PROMPT, transcriptForSummary } from './context';
import { buildSystemPrompt, PROJECT_INSTRUCTION_FILES, PROJECT_INSTRUCTIONS_MAX_CHARS, Prompts, type PromptEnvironment } from './prompt';
import { appendStepResults, injectedUserMessage, MessageQueue } from './queue';
import { assistantTurn, createSession, newId, summaryTurn, titleFromText, toSessionView, userTurn, type SessionData } from './session';

type ToolRegistry = typeof import('../tools');

export interface SessionControllerDeps {
  client: GisooClient;
  /** The tool registry module (`import * as tools from '../tools'`). */
  tools: ToolRegistry;
  store: SessionStore;
  post: (message: HostToWebview) => void;
  getSettings: () => GisooSettings;
  context: vscode.ExtensionContext;
  auth: AuthService;
  /** Instruction files, memory, custom commands and skills (SPEC-phase2 §1–3, §7). Optional for tests. */
  workspaceContext?: ContextProvider;
}

const INPUT_DISPLAY_MAX = 4_000;
const OUTPUT_DISPLAY_MAX = 8_000;
const DIFF_DISPLAY_MAX = 20_000;
const ATTACHMENT_MAX_CHARS = 40_000;
const DIFF_PROMPT_MAX_CHARS = 60_000;
const PROGRESS_THROTTLE_MS = 150;
const DEFAULT_MAX_STEPS = 60;
const AGENT_HISTORY_MAX = 30;
const STOPPED_RESULT = 'Stopped by the user.';
/** Scheme of the read-only transcript documents opened from the agents panel. */
const AGENT_DOC_SCHEME = 'gisoo-agent';
const TRANSCRIPT_PART_MAX = 6_000;
const AGENT_FILE_NAME = /^[a-z0-9][a-z0-9-]{1,39}$/;

function agentDocUri(id: string): vscode.Uri {
  return vscode.Uri.from({ scheme: AGENT_DOC_SCHEME, path: `/${id}.md` });
}

function agentTemplate(name: string): string {
  return [
    '---',
    `name: ${name}`,
    'description: What this agent does and when the main agent should hand work to it.',
    '# model: a Gisoo model id; leave out to inherit the chat model',
    '# tools: read_file, search_text, find_files, list_directory, symbols, graph_query',
    '---',
    '',
    'You are a focused sub-agent. Describe the job, its limits and the shape of the report here.',
    '',
  ].join('\n');
}

type Outcome = 'done' | 'stopped' | 'error';

interface TurnState {
  view: AssistantTurnView;
  startedAt: number;
  usage?: Usage;
}

interface StreamResult {
  text: string;
  toolCalls: ToolCall[];
  usage?: Usage;
  finishReason: string | null;
}

interface StreamSink {
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
}

/** Where a batch of tool calls runs: the parent turn, or a sub-agent inside it. */
interface ExecScope {
  turn: AssistantTurnView;
  signal: AbortSignal;
  depth: number;
  /** Sub-agents: the only tool names they may call. */
  allowed?: ReadonlySet<string>;
  titlePrefix?: string;
  onStep?: (label: string) => void;
}

interface CallEntry {
  index: number;
  call: ToolCall;
  view: ToolCallView;
  registered?: RegisteredTool;
  input: Record<string, unknown>;
  failure?: string;
}

/** The ToolContext handed to tools, with what the `task` tool needs to nest a loop. */
interface RunnerToolContext extends ToolContext {
  callId: string;
  turn: AssistantTurnView;
  depth: number;
}

interface TaskInput {
  prompt?: unknown;
  agent?: unknown;
  model?: unknown;
}

interface AgentRun {
  info: AgentInfo;
  controller: AbortController;
  /** Started from the agents panel (retry), not from a task tool call. */
  standalone?: boolean;
}

/** What `agent.open` and `agent.retry` need after an agent has finished. */
interface AgentRecord {
  prompt: string;
  agentName?: string;
  model: string;
  messages: ChatMessage[];
}

interface Approval {
  decision: 'accept' | 'reject' | 'always';
  note?: string;
}

interface Injected {
  message: ChatMessage;
  items: QueuedMessage[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAborted(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof GisooError && error.code === 'aborted');
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function firstLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function prettyInput(raw: string): string {
  let text = raw;
  try {
    text = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // not JSON: show as-is
  }
  return text.length > INPUT_DISPLAY_MAX ? `${text.slice(0, INPUT_DISPLAY_MAX)}\n[...]` : text;
}

function isRunnerContext(ctx: ToolContext): ctx is RunnerToolContext {
  const c = ctx as Partial<RunnerToolContext>;
  return typeof c.callId === 'string' && typeof c.depth === 'number' && typeof c.turn === 'object' && c.turn !== null;
}

/** Limits how many sub-agents run at once; the limit is read live from settings. */
class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: () => number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    while (this.active >= Math.max(1, this.limit())) {
      if (signal.aborted) throw new GisooError('Stopped', 'aborted');
      await new Promise<void>((resolve) => {
        const wake = (): void => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = (): void => {
          const i = this.waiting.indexOf(wake);
          if (i >= 0) this.waiting.splice(i, 1);
          resolve();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        this.waiting.push(wake);
      });
    }
    if (signal.aborted) throw new GisooError('Stopped', 'aborted');
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiting.shift()?.();
    };
  }
}

export class SessionController implements vscode.Disposable {
  private readonly client: GisooClient;
  private readonly tools: ToolRegistry;
  private readonly store: SessionStore;
  private readonly post: (message: HostToWebview) => void;
  private readonly getSettings: () => GisooSettings;
  private readonly context: vscode.ExtensionContext;
  private readonly auth: AuthService;
  private readonly workspaceContext: ContextProvider | undefined;

  private session: SessionData;
  private models: ModelInfo[];
  private modelsLoaded = false;
  private definitions: AgentDefinition[] = [];
  private initialised = false;
  private untrustedNoticeShown = false;

  private running = false;
  private abort: AbortController | undefined;
  private task: Promise<void> | undefined;
  private canRetry = false;
  private taskCostUsd = 0;

  /** Messages injected at the next model-call boundary. */
  private readonly steer: MessageQueue;
  /** Messages that wait until the task has finished. */
  private readonly later: MessageQueue;
  private readonly checkpoints = new Checkpoints();
  private readonly pendingApprovals = new Map<string, (value: Approval | undefined) => void>();
  private readonly pendingAnswers = new Map<string, (value: string | undefined) => void>();
  private readonly progressTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly agents = new Map<string, AgentRun>();
  private agentHistory: AgentInfo[] = [];
  private readonly agentRecords = new Map<string, AgentRecord>();
  private readonly transcriptChanged = new vscode.EventEmitter<vscode.Uri>();
  private readonly semaphore: Semaphore;
  private readonly disposers: Array<() => void> = [];

  constructor(deps: SessionControllerDeps) {
    this.client = deps.client;
    this.tools = deps.tools;
    this.store = deps.store;
    this.post = deps.post;
    this.getSettings = deps.getSettings;
    this.context = deps.context;
    this.auth = deps.auth;
    this.workspaceContext = deps.workspaceContext;

    const settings = this.getSettings();
    this.session = createSession(settings.model.trim() || DEFAULT_MODEL, settings.permissionMode);
    this.models = [fallbackModel(this.session.model)];
    this.steer = new MessageQueue(() => this.postQueue());
    this.later = new MessageQueue(() => this.postQueue());
    this.semaphore = new Semaphore(() => this.getSettings().maxParallelAgents);
    this.disposers.push(this.tools.registerTool(this.taskTool(), { readOnly: true, needsApproval: false }));
    const transcripts = vscode.workspace.registerTextDocumentContentProvider(AGENT_DOC_SCHEME, {
      onDidChange: this.transcriptChanged.event,
      provideTextDocumentContent: (uri) => this.agentTranscript(uri.path.replace(/^\/+/, '').replace(/\.md$/, '')),
    });
    this.disposers.push(() => transcripts.dispose(), () => this.transcriptChanged.dispose());
    if (this.workspaceContext) {
      const sub = this.workspaceContext.onDidReload(() => this.post({ type: 'slashCommands', items: this.slashCommands() }));
      this.disposers.push(() => sub.dispose());
    }
  }

  dispose(): void {
    this.stop();
    this.cancelPending();
    for (const timer of this.progressTimers.values()) clearTimeout(timer);
    this.progressTimers.clear();
    for (const d of this.disposers.splice(0)) d();
  }

  // -- Webview messages --------------------------------------------------------------------------

  /** Returns false for messages the controller does not own. */
  async handle(msg: WebviewToHost): Promise<boolean> {
    switch (msg.type) {
      case 'ready':
        await this.onReady();
        return true;
      case 'send':
        await this.onSend(msg.text, msg.attachments ?? [], msg.delivery);
        return true;
      case 'queue.edit':
        if (!this.steer.edit(msg.id, msg.text)) this.later.edit(msg.id, msg.text);
        return true;
      case 'queue.remove':
        if (!this.steer.remove(msg.id)) this.later.remove(msg.id);
        return true;
      case 'stop':
        this.stop();
        return true;
      case 'retry':
        await this.retry();
        return true;
      case 'session.new':
        await this.newSession();
        return true;
      case 'session.open':
        await this.openSession(msg.id);
        return true;
      case 'session.delete':
        await this.deleteSession(msg.id);
        return true;
      case 'session.list':
        await this.postSessions();
        return true;
      case 'model.set':
        await this.setModel(msg.id);
        return true;
      case 'models.refresh':
        await this.loadModels(true);
        return true;
      case 'mode.set':
        this.setMode(msg.mode);
        return true;
      case 'approval':
        this.pendingApprovals.get(msg.callId)?.({ decision: msg.decision, note: msg.note });
        return true;
      case 'answer':
        this.pendingAnswers.get(msg.callId)?.(msg.answer);
        return true;
      case 'diff.open':
        await this.openDiff(msg.callId);
        return true;
      case 'checkpoint.restore':
        await this.restoreCheckpoint(msg.turnId);
        return true;
      case 'plan.start':
        await this.planStart();
        return true;
      case 'agent.stop':
        this.stopAgent(msg.id);
        return true;
      case 'agent.open':
        await this.openAgent(msg.id);
        return true;
      case 'agent.retry':
        await this.retryAgent(msg.id);
        return true;
      case 'preview.open':
        await this.openPreview(msg.path);
        return true;
      case 'memory.open':
        await this.openMemory();
        return true;
      case 'context.reload':
        await this.reloadContext();
        return true;
      default:
        return false;
    }
  }

  private async onReady(): Promise<void> {
    if (!this.initialised) {
      this.initialised = true;
      if (!this.session.turns.length && !this.running) {
        const latest = await this.store.latestId();
        const data = latest ? await this.store.load(latest) : undefined;
        if (data && !this.running && !this.session.turns.length) this.session = data;
      }
      await this.reloadDefinitions();
      await this.workspaceContext?.reload().catch(() => undefined);
    }
    const sessions = await this.store.list();
    this.post({
      type: 'init',
      state: {
        ...baseInitState(this.auth, this.context),
        models: this.modelList(),
        session: this.view(),
        sessions,
        slashCommands: this.slashCommands(),
        contextFiles: this.workspaceContext?.contextFiles() ?? [],
      },
    });
    this.post({ type: 'sessions', items: sessions });
    this.post({ type: 'agents', items: this.agentList() });
    if (!this.modelsLoaded) void this.loadModels(false);
  }

  private async onSend(text: string, attachments: Attachment[], delivery?: MessageDelivery): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed && !attachments.length) return;
    if (this.running) {
      (delivery === 'queue' ? this.later : this.steer).add(trimmed, attachments);
      return;
    }
    if (trimmed.startsWith('#') && this.workspaceContext) {
      await this.quickMemory(trimmed);
      return;
    }
    if (trimmed.startsWith('/') && (await this.slash(trimmed, attachments))) return;
    this.launch({ text: trimmed, attachments });
  }

  // -- Memory and context (SPEC-phase2 §1–2) -------------------------------------------------------

  /** `#text`: saves a memory file and does not start a run. */
  private async quickMemory(text: string): Promise<void> {
    const ctx = this.workspaceContext;
    if (!ctx) return;
    try {
      const saved = await ctx.quickMemory(text);
      this.toast('info', this.t('memory.saved', saved.name));
    } catch (error) {
      const message = describeError(error);
      this.toast('warning', message === 'empty' ? this.t('memory.empty') : this.t('memory.saveFailed', message));
    }
  }

  private async openMemory(): Promise<void> {
    const ctx = this.workspaceContext;
    if (!ctx) return;
    try {
      const file = await ctx.openMemory();
      this.toast('info', this.t('memory.opened', relativeToWorkspace(file)));
    } catch (error) {
      this.toast('error', this.t('memory.openFailed', describeError(error)));
    }
  }

  private async reloadContext(): Promise<void> {
    const ctx = this.workspaceContext;
    if (!ctx) return;
    await this.reloadDefinitions();
    await ctx.reload();
    this.post({ type: 'slashCommands', items: this.slashCommands() });
    this.toast('info', this.t('context.reloaded'));
  }

  private launch(initial?: { text: string; attachments: Attachment[] }): void {
    if (this.running) return;
    this.task = this.run(initial);
  }

  // -- The task -----------------------------------------------------------------------------------

  private async run(initial?: { text: string; attachments: Attachment[] }): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.canRetry = false;
    this.taskCostUsd = 0;
    const abort = new AbortController();
    this.abort = abort;
    const session = this.session;
    let outcome: Outcome = 'error';
    this.post({ type: 'running', running: true });
    try {
      if (!(await this.auth.hasKey())) {
        this.toast('warning', this.t('notice.signInFirst'));
        if (initial) this.post({ type: 'prefill', text: initial.text, send: false, attachments: initial.attachments });
        return;
      }
      await this.reloadDefinitions();
      await this.workspaceContext?.refreshIfChanged().catch(() => undefined);
      if (initial) await this.addUserMessage(session, initial.text, initial.attachments);
      const leftover = await this.drainSteer(session);
      if (leftover) this.applyInjected(session, leftover);
      outcome = await this.taskLoop(session, abort.signal);
    } catch (error) {
      this.toast('error', describeError(error));
    } finally {
      this.running = false;
      if (this.abort === abort) this.abort = undefined;
      this.cancelPending();
      this.post({ type: 'running', running: false });
      await this.persist(session);
    }
    if (outcome === 'done') this.drainLater();
  }

  private async taskLoop(session: SessionData, signal: AbortSignal): Promise<Outcome> {
    const maxSteps = clampInt(userSetting<number>('maxSteps'), DEFAULT_MAX_STEPS, 1, 1_000);
    let steps = 0;
    let turn = this.beginTurn(session);
    const finish = (outcome: Outcome): Outcome => {
      this.endTurn(turn, outcome === 'stopped');
      return outcome;
    };

    if (!vscode.workspace.isTrusted && !this.untrustedNoticeShown) {
      this.untrustedNoticeShown = true;
      this.notice(turn.view, 'info', this.t('notice.untrusted'));
    }

    while (true) {
      if (signal.aborted) return finish('stopped');
      const settings = this.getSettings();
      if (steps >= maxSteps) {
        this.notice(turn.view, 'warning', this.t('error.maxSteps'), NoticeCodes.maxSteps);
        this.canRetry = true;
        return finish('error');
      }
      if (settings.maxCostPerTask > 0 && this.taskCostUsd >= settings.maxCostPerTask) {
        this.notice(turn.view, 'warning', this.t('error.maxCost', formatUsd(settings.maxCostPerTask)), NoticeCodes.maxCost);
        this.canRetry = true;
        return finish('error');
      }

      const model = this.modelInfo(session.model);
      if (needsCompaction(session.messages, model.contextLength)) await this.compact(session, signal, turn.view);
      if (signal.aborted) return finish('stopped');

      const system = await this.systemPrompt(session.mode);
      const defs = this.tools.toolDefinitions(this.visibility());
      const request: ChatRequest = {
        model: session.model,
        messages: [{ role: 'system', content: system }, ...session.messages],
        stream: true,
        stream_options: { include_usage: true },
        tools: defs.length ? defs : undefined,
        tool_choice: defs.length ? 'auto' : undefined,
        parallel_tool_calls: true,
      };

      let result: StreamResult;
      try {
        const view = turn.view;
        result = await this.stream(request, signal, {
          onText: (text) => this.appendDelta(view, 'text', text),
          onThinking: (text) => this.appendDelta(view, 'thinking', text),
        });
      } catch (error) {
        if (isAborted(error, signal)) return finish('stopped');
        this.errorNotice(turn.view, error);
        this.canRetry = true;
        return finish('error');
      }
      steps++;
      if (result.usage) {
        turn.usage = addUsage(turn.usage, result.usage);
        this.addCost(session, result.usage);
      }
      session.messages.push({
        role: 'assistant',
        content: result.text || null,
        tool_calls: result.toolCalls.length ? result.toolCalls : undefined,
      });

      if (!result.toolCalls.length) {
        const injected = signal.aborted ? undefined : await this.drainSteer(session);
        if (!injected) {
          await this.persist(session);
          return finish('done');
        }
        this.endTurn(turn, false);
        session.messages.push(injected.message);
        this.applyInjected(session, injected);
        turn = this.beginTurn(session);
        await this.persist(session);
        continue;
      }

      const results = await this.executeCalls(result.toolCalls, { turn: turn.view, signal, depth: 0 });
      const injected = signal.aborted ? undefined : await this.drainSteer(session);
      session.messages = appendStepResults(session.messages, results, injected?.message);
      if (injected) {
        this.endTurn(turn, false);
        this.applyInjected(session, injected);
        turn = this.beginTurn(session);
      }
      await this.persist(session);
    }
  }

  private beginTurn(session: SessionData): TurnState {
    const view = assistantTurn(session.model);
    session.turns.push(view);
    this.post({ type: 'turn.add', turn: view });
    return { view, startedAt: Date.now() };
  }

  private endTurn(state: TurnState, stopped: boolean): void {
    const { view } = state;
    if (!view.streaming) return;
    for (const part of view.parts) {
      if (part.kind !== 'tool') continue;
      const s = part.call.status;
      if (s === 'pending' || s === 'running' || s === 'awaiting') {
        part.call.status = 'cancelled';
        this.postTool(view, part.call);
      }
    }
    view.streaming = false;
    view.stopped = stopped || undefined;
    view.usage = state.usage;
    view.durationMs = Date.now() - state.startedAt;
    view.hasCheckpoint = this.checkpoints.has(view.id);
    this.post({ type: 'turn.end', turnId: view.id, usage: view.usage, durationMs: view.durationMs, stopped, hasCheckpoint: view.hasCheckpoint });
  }

  private appendDelta(view: AssistantTurnView, kind: 'text' | 'thinking', text: string): void {
    const last = view.parts[view.parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else view.parts.push({ kind, text });
    this.post({ type: 'turn.delta', turnId: view.id, kind, text });
  }

  private notice(view: AssistantTurnView, level: 'info' | 'warning' | 'error', text: string, code?: string): void {
    view.parts.push({ kind: 'notice', level, text, code });
    this.post({ type: 'turn.notice', turnId: view.id, level, text, code });
  }

  /** Streams one completion; the sink receives deltas, the result holds the stitched tool calls. */
  private async stream(request: ChatRequest, signal: AbortSignal, sink: StreamSink): Promise<StreamResult> {
    let text = '';
    let toolCalls: ToolCall[] = [];
    let usage: Usage | undefined;
    let finishReason: string | null = null;
    for await (const ev of this.client.chat(request, signal)) {
      if (ev.kind === 'text') {
        text += ev.text;
        sink.onText?.(ev.text);
      } else if (ev.kind === 'reasoning') {
        sink.onThinking?.(ev.text);
      } else if (ev.kind === 'usage') {
        usage = usageFromWire(ev.usage);
      } else if (ev.kind === 'done') {
        toolCalls = ev.toolCalls.filter((c) => c.function.name);
        finishReason = ev.finishReason;
      }
    }
    if (usage) usage.costUsd = estimateCostUsd(usage, this.modelInfo(request.model));
    return { text, toolCalls, usage, finishReason };
  }

  private addCost(session: SessionData, usage: Usage): void {
    const cost = usage.costUsd ?? 0;
    session.costUsd += cost;
    this.taskCostUsd += cost;
    this.post({ type: 'cost', costUsd: session.costUsd, contextUsed: this.contextUsed(session) });
  }

  private errorNotice(view: AssistantTurnView, error: unknown): void {
    if (!(error instanceof GisooError)) {
      this.notice(view, 'error', this.t('error.badRequest', describeError(error).slice(0, 300)));
      return;
    }
    switch (error.code) {
      case 'insufficient_credit':
        this.notice(view, 'error', `${this.t('error.insufficientCredit')} ${Links.addCredit}`, NoticeCodes.insufficientCredit);
        return;
      case 'invalid_api_key':
        this.notice(view, 'error', this.t('error.invalidKey'), NoticeCodes.invalidKey);
        void this.auth.refresh();
        return;
      case 'rate_limited':
        this.notice(view, 'error', this.t('error.rateLimited'), NoticeCodes.rateLimited);
        return;
      case 'network':
        this.notice(view, 'error', this.t('error.network'), NoticeCodes.network);
        return;
      case 'server':
        this.notice(view, 'error', this.t('error.server'), NoticeCodes.server);
        return;
      case 'timeout':
        this.notice(view, 'error', this.t('error.timeout'), NoticeCodes.timeout);
        return;
      case 'model_not_found':
        this.notice(view, 'error', this.t('error.modelNotFound'), NoticeCodes.modelNotFound);
        return;
      case 'aborted':
        return;
      default:
        this.notice(view, 'error', this.t('error.badRequest', error.message.slice(0, 300)));
        return;
    }
  }

  // -- Compaction ---------------------------------------------------------------------------------

  private async compact(session: SessionData, signal: AbortSignal, view?: AssistantTurnView): Promise<boolean> {
    const split = splitForCompaction(session.messages);
    if (!split.older.length) return false;
    let summary: StreamResult;
    try {
      summary = await this.stream(
        {
          model: session.model,
          messages: [
            { role: 'system', content: SUMMARY_PROMPT },
            { role: 'user', content: transcriptForSummary(split.older) },
          ],
          stream: true,
          stream_options: { include_usage: true },
        },
        signal,
        {},
      );
    } catch {
      return false; // the next model call reports the real error
    }
    const text = summary.text.trim();
    if (!text) return false;
    if (summary.usage) this.addCost(session, summary.usage);
    session.messages = applyCompaction(split, text);
    const note = summaryTurn(text);
    const at = view ? session.turns.indexOf(view) : -1;
    if (at >= 0) session.turns.splice(at, 0, note);
    else session.turns.push(note);
    this.post({ type: 'session', session: this.view(session) });
    if (view) this.notice(view, 'info', this.t('notice.compacted'));
    return true;
  }

  /** `/compact` while idle: runs the summariser under the stop button. */
  private async compactNow(): Promise<void> {
    if (this.running) {
      this.toast('warning', this.t('notice.busy'));
      return;
    }
    const session = this.session;
    const abort = new AbortController();
    this.running = true;
    this.abort = abort;
    this.post({ type: 'running', running: true });
    try {
      if (!(await this.auth.hasKey())) {
        this.toast('warning', this.t('notice.signInFirst'));
        return;
      }
      const done = await this.compact(session, abort.signal);
      if (done) this.toast('info', this.t('notice.compacted'));
    } finally {
      this.running = false;
      if (this.abort === abort) this.abort = undefined;
      this.post({ type: 'running', running: false });
      await this.persist(session);
    }
  }

  // -- Tool execution -----------------------------------------------------------------------------

  /** Runs the calls of one model step: read-only tools in parallel first, the rest one by one. */
  private async executeCalls(calls: ToolCall[], scope: ExecScope): Promise<ChatMessage[]> {
    const entries = calls.map((call, index) => this.prepareCall(call, index, scope));
    const results = new Array<ChatMessage>(entries.length);
    const isParallel = (e: CallEntry): boolean => Boolean(e.registered?.readOnly) && !e.failure;
    await Promise.all(
      entries.filter(isParallel).map(async (e) => {
        results[e.index] = await this.runCall(e, scope);
      }),
    );
    for (const e of entries) {
      if (!isParallel(e)) results[e.index] = await this.runCall(e, scope);
    }
    return results;
  }

  private prepareCall(call: ToolCall, index: number, scope: ExecScope): CallEntry {
    const name = call.function.name;
    const registered = this.tools.toolByName(name);
    let input: Record<string, unknown> = {};
    let failure: string | undefined;
    try {
      const parsed: unknown = parseToolArguments(call.function.arguments);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
      else if (parsed !== undefined && parsed !== null) failure = `The arguments of ${name} must be a JSON object.`;
    } catch (error) {
      failure = `Invalid JSON in the arguments of ${name}: ${describeError(error)}`;
    }
    if (!registered) failure = `Unknown tool: ${name}. Use only the tools provided in this conversation.`;
    let title = name;
    if (registered && !failure) {
      try {
        title = registered.tool.title(input) || name;
      } catch {
        title = name;
      }
    }
    const used = new Set(scope.turn.parts.flatMap((p) => (p.kind === 'tool' ? [p.call.id] : [])));
    const id = used.has(call.id) ? `${call.id}_${newId('c')}` : call.id;
    const view: ToolCallView = { id, name, title: `${scope.titlePrefix ?? ''}${title}`, status: 'pending', input: prettyInput(call.function.arguments) };
    scope.turn.parts.push({ kind: 'tool', call: view });
    this.postTool(scope.turn, view);
    scope.onStep?.(title);
    return { index, call, view, registered, input, failure };
  }

  private async runCall(entry: CallEntry, scope: ExecScope): Promise<ChatMessage> {
    const { call, view } = entry;
    const turn = scope.turn;
    const finish = (result: ToolResult, status: ToolStatus): ChatMessage => {
      view.status = status;
      const display = result.display ?? result.content;
      view.output = display.length > OUTPUT_DISPLAY_MAX ? `${display.slice(0, OUTPUT_DISPLAY_MAX)}\n[...]` : display;
      if (result.view?.title) view.title = `${scope.titlePrefix ?? ''}${result.view.title}`;
      if (result.view?.edit) view.edit = { ...result.view.edit, diff: result.view.edit.diff.slice(0, DIFF_DISPLAY_MAX) };
      if (result.view?.command) view.command = result.view.command;
      if (result.view?.question) view.question = result.view.question;
      this.postTool(turn, view);
      return { role: 'tool', tool_call_id: call.id, content: truncateResult(result.content) };
    };

    if (entry.failure) return finish({ content: entry.failure, isError: true }, 'error');
    const registered = entry.registered;
    if (!registered) return finish({ content: `Unknown tool: ${call.function.name}`, isError: true }, 'error');
    const { tool } = registered;
    if (scope.signal.aborted) return finish({ content: STOPPED_RESULT }, 'cancelled');

    // A sub-agent's grant narrows the visible set; it never widens it (plan mode, trust and
    // web_fetch switches may change while the sub-agent runs).
    if (scope.allowed && !scope.allowed.has(tool.name)) {
      return finish({ content: `The tool ${tool.name} is not available to this sub-agent.`, isError: true }, 'error');
    }
    if (!this.tools.visibleTools(this.visibility()).some((r) => r.tool.name === tool.name)) {
      if (this.session.mode === 'plan') return finish({ content: PLAN_MODE_DENIAL, isError: true }, 'rejected');
      return finish({ content: `The tool ${tool.name} is not available right now.`, isError: true }, 'error');
    }

    const ctx = this.toolContext(entry, scope);
    const command = tool.permission === 'command' ? String(entry.input.command ?? '') : undefined;
    let decision = decide(tool.permission, this.permissionSettings(), command);
    if (decision === 'allow' && tool.permission === 'edit' && !vscode.workspace.isTrusted) decision = 'ask';
    if (decision === 'allow' && registered.needsApproval && (tool.permission === 'read' || tool.permission === 'none')) decision = 'ask';
    if (decision === 'deny') {
      const text = this.session.mode === 'plan' ? PLAN_MODE_DENIAL : `The tool ${tool.name} is not allowed here.`;
      return finish({ content: text, isError: true }, 'rejected');
    }

    let prepared: PreparedEdit | undefined;
    let acceptNote: string | undefined;
    if (decision === 'ask') {
      if (tool.prepare) {
        try {
          prepared = await tool.prepare(entry.input, ctx);
          view.edit = {
            path: prepared.relativePath,
            added: prepared.added,
            removed: prepared.removed,
            diff: prepared.diff.slice(0, DIFF_DISPLAY_MAX),
            isNewFile: prepared.isNewFile,
          };
        } catch (error) {
          if (scope.signal.aborted) return finish({ content: STOPPED_RESULT }, 'cancelled');
          return finish({ content: describeError(error), isError: true }, 'error');
        }
      }
      if (command !== undefined) {
        const cwd = typeof entry.input.cwd === 'string' && entry.input.cwd.trim() ? entry.input.cwd.trim() : '.';
        view.command = { command, cwd };
      }
      view.status = 'awaiting';
      this.postTool(turn, view);
      scope.onStep?.(`waiting: ${view.title}`);
      const answer = await this.waitFor(this.pendingApprovals, view.id, scope.signal);
      if (!answer) return finish({ content: STOPPED_RESULT }, 'cancelled');
      const note = answer.note?.trim();
      if (answer.decision === 'reject') {
        const what = tool.permission === 'command' ? 'command' : tool.permission === 'edit' ? 'edit' : 'action';
        const text = `The user rejected this ${what}.${note ? ` Note from the user: ${note}` : ''}`;
        return finish({ content: text, isError: true }, 'rejected');
      }
      acceptNote = note;
      if (answer.decision === 'always') {
        if (tool.permission === 'command' && command) {
          const word = commandPrefixWord(command);
          if (word && !this.session.allowedCommands.includes(word)) this.session.allowedCommands.push(word);
        } else if (tool.permission === 'edit') {
          this.setMode('autoEdit');
        }
      }
    }

    view.status = 'running';
    this.postTool(turn, view);
    scope.onStep?.(view.title);
    try {
      const result = await tool.run(entry.input, ctx, prepared);
      if (acceptNote) result.content = `${result.content}\n\nNote from the user: ${acceptNote}`;
      return finish(result, result.isError ? 'error' : 'done');
    } catch (error) {
      if (scope.signal.aborted) return finish({ content: STOPPED_RESULT }, 'cancelled');
      return finish({ content: describeError(error), isError: true }, 'error');
    }
  }

  private toolContext(entry: CallEntry, scope: ExecScope): RunnerToolContext {
    const { view } = entry;
    const turn = scope.turn;
    let progress = '';
    return {
      signal: scope.signal,
      callId: view.id,
      turn,
      depth: scope.depth,
      onProgress: (text) => {
        progress = (progress + text).slice(-OUTPUT_DISPLAY_MAX);
        view.output = progress;
        this.postToolThrottled(turn, view);
      },
      askUser: async (question, options) => {
        view.question = { text: question, options };
        view.status = 'awaiting';
        this.postTool(turn, view);
        const answer = await this.waitFor(this.pendingAnswers, view.id, scope.signal);
        if (answer === undefined) throw new GisooError('Stopped', 'aborted');
        view.question = { text: question, options, answer };
        view.status = 'running';
        this.postTool(turn, view);
        return answer;
      },
      setTodos: (todos) => {
        this.session.todos = todos;
        this.post({ type: 'todos', todos });
      },
      checkpoint: (absolutePath, previous) => {
        this.checkpoints.record(turn.id, absolutePath, previous);
        turn.hasCheckpoint = true;
      },
      settings: { webFetchEnabled: this.getSettings().webFetchEnabled },
    };
  }

  private waitFor<T>(map: Map<string, (value: T | undefined) => void>, key: string, signal: AbortSignal): Promise<T | undefined> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve(undefined);
        return;
      }
      const onAbort = (): void => {
        map.delete(key);
        resolve(undefined);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      map.set(key, (value) => {
        signal.removeEventListener('abort', onAbort);
        map.delete(key);
        resolve(value);
      });
    });
  }

  private cancelPending(): void {
    for (const resolve of [...this.pendingApprovals.values()]) resolve(undefined);
    for (const resolve of [...this.pendingAnswers.values()]) resolve(undefined);
    this.pendingApprovals.clear();
    this.pendingAnswers.clear();
  }

  private postTool(turn: AssistantTurnView, view: ToolCallView): void {
    const timer = this.progressTimers.get(view.id);
    if (timer) {
      clearTimeout(timer);
      this.progressTimers.delete(view.id);
    }
    this.post({ type: 'turn.tool', turnId: turn.id, call: view });
  }

  private postToolThrottled(turn: AssistantTurnView, view: ToolCallView): void {
    if (this.progressTimers.has(view.id)) return;
    this.progressTimers.set(
      view.id,
      setTimeout(() => {
        this.progressTimers.delete(view.id);
        this.post({ type: 'turn.tool', turnId: turn.id, call: view });
      }, PROGRESS_THROTTLE_MS),
    );
  }

  private permissionSettings(): PermissionSettings {
    const configured = userSetting<unknown>('allowedCommands');
    const allowedCommands = Array.isArray(configured) ? configured.filter((c): c is string => typeof c === 'string') : [];
    return { mode: this.session.mode, allowedCommands, sessionAllowed: this.session.allowedCommands, webFetchEnabled: this.getSettings().webFetchEnabled };
  }

  private visibility(): ToolVisibility {
    return { mode: this.session.mode, webFetchEnabled: this.getSettings().webFetchEnabled, workspaceTrusted: vscode.workspace.isTrusted };
  }

  // -- Sub-agents (the `task` tool) ----------------------------------------------------------------

  private taskTool(): Tool {
    const tool: Tool<TaskInput> = {
      name: 'task',
      description:
        'Delegate one self-contained piece of work (searching or reading the codebase, research, a review) to a sub-agent. ' +
        'It starts with a fresh context, read-only tools and your prompt, and returns a short report; it cannot talk to the user. ' +
        'Give it a complete, specific prompt. Several task calls in one reply run in parallel. ' +
        'Set "agent" to the name of a defined agent from the catalogue when one fits.',
      permission: 'read',
      readOnly: true,
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The complete task for the sub-agent, including what to report back' },
          agent: { type: 'string', description: 'Name of a defined agent (optional)' },
          model: { type: 'string', description: 'Model id for the sub-agent (optional)' },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
      title: (input) => {
        const name = typeof input.agent === 'string' && input.agent.trim() ? ` ${input.agent.trim()}` : '';
        const prompt = typeof input.prompt === 'string' ? firstLine(input.prompt) : '';
        return `Agent${name}: ${prompt.slice(0, 100)}`;
      },
      run: (input, ctx) => this.runTask(input, ctx),
    };
    return tool as unknown as Tool;
  }

  private async runTask(input: TaskInput, ctx: ToolContext): Promise<ToolResult> {
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt) return { content: 'prompt is required', isError: true };
    if (!isRunnerContext(ctx)) return { content: 'The task tool only works inside a Gisoo chat session.', isError: true };
    if (ctx.depth > 0) return { content: 'Sub-agents cannot start further sub-agents. Do the work yourself with your tools.', isError: true };
    const agentName = typeof input.agent === 'string' ? input.agent.trim() : '';
    const def = agentName ? findAgent(this.definitions, agentName) : undefined;
    if (agentName && !def) {
      const names = this.definitions.map((d) => d.name).join(', ') || '(none)';
      return { content: `Unknown agent "${agentName}". Defined agents: ${names}. Omit "agent" to use the default sub-agent.`, isError: true };
    }
    const settings = this.getSettings();
    const session = this.session;
    const info: AgentInfo = {
      id: newId('g'),
      parentId: ctx.callId,
      sessionId: session.id,
      name: def?.name ?? 'task',
      model: this.pickAgentModel(input.model, def, settings),
      status: 'waiting',
      startedAt: Date.now(),
      tokens: 0,
      costUsd: 0,
      lastStep: firstLine(prompt).slice(0, 120),
    };
    const controller = new AbortController();
    const onParentAbort = (): void => controller.abort();
    if (ctx.signal.aborted) controller.abort();
    else ctx.signal.addEventListener('abort', onParentAbort, { once: true });
    const run: AgentRun = { info, controller };
    this.agents.set(info.id, run);
    this.agentRecords.set(info.id, { prompt, agentName: def?.name, model: info.model, messages: [] });
    this.postAgent(info);
    let release: (() => void) | undefined;
    try {
      release = await this.semaphore.acquire(controller.signal);
      info.status = 'running';
      this.postAgent(info);
      const report = await this.subLoop(run, def, prompt, ctx, settings.maxAgentTurns);
      this.finishAgent(info, 'done');
      return { content: report || '(the sub-agent returned no text)', display: report || undefined };
    } catch (error) {
      if (controller.signal.aborted) {
        this.finishAgent(info, 'stopped');
        return { content: 'The sub-agent was stopped before it finished.', isError: true };
      }
      const reason = describeError(error);
      this.finishAgent(info, 'failed', reason);
      return { content: `The sub-agent failed: ${reason}`, isError: true };
    } finally {
      release?.();
      ctx.signal.removeEventListener('abort', onParentAbort);
      this.agents.delete(info.id);
    }
  }

  private async subLoop(run: AgentRun, def: AgentDefinition | undefined, prompt: string, parent: Pick<RunnerToolContext, 'turn'>, maxTurns: number): Promise<string> {
    const { info, controller } = run;
    const signal = controller.signal;
    const session = this.session;
    const allowed = this.subAgentTools(def);
    const defs = allowed.map((r) => toDefinition(r.tool));
    const allowedNames = new Set(allowed.map((r) => r.tool.name));
    const system = await this.subSystemPrompt(def);
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ];
    const record = this.agentRecords.get(info.id);
    if (record) record.messages = messages;
    const touch = (step: string): void => {
      info.lastStep = step.slice(0, 200);
      this.postAgent(info);
    };
    const scope: ExecScope = { turn: parent.turn, signal, depth: 1, allowed: allowedNames, titlePrefix: `[${info.name}] `, onStep: touch };
    let lastText = '';
    for (let step = 0; step < maxTurns; step++) {
      if (signal.aborted) throw new GisooError('Stopped', 'aborted');
      // The task's cost limit covers its sub-agents too; parallel agents share the same total.
      const limit = this.getSettings().maxCostPerTask;
      if (limit > 0 && this.taskCostUsd >= limit) {
        const note = `[The sub-agent stopped: the task reached its cost limit (gisoo.maxCostPerTask = ${formatUsd(limit)}).]`;
        return lastText ? `${lastText}\n\n${note}` : note;
      }
      touch('thinking');
      const request: ChatRequest = {
        model: info.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        tools: defs.length ? defs : undefined,
        tool_choice: defs.length ? 'auto' : undefined,
        parallel_tool_calls: true,
      };
      const result = await this.stream(request, signal, {});
      if (result.usage) {
        info.tokens += result.usage.promptTokens + result.usage.completionTokens;
        info.costUsd += result.usage.costUsd ?? 0;
        this.addCost(session, result.usage);
      }
      messages.push({ role: 'assistant', content: result.text || null, tool_calls: result.toolCalls.length ? result.toolCalls : undefined });
      if (result.text.trim()) lastText = result.text.trim();
      if (!result.toolCalls.length) return lastText;
      messages.push(...(await this.executeCalls(result.toolCalls, scope)));
    }
    return lastText
      ? `${lastText}\n\n[The sub-agent reached its turn limit (${maxTurns}) and may not have finished.]`
      : `[The sub-agent reached its turn limit (${maxTurns}) without a final answer.]`;
  }

  /** Read-only tools by default; a definition's `tools` list replaces that set. Never task, ask_user or todo_write. */
  private subAgentTools(def: AgentDefinition | undefined): RegisteredTool[] {
    const granted = new Set((def?.tools ?? []).map((t) => t.trim()).filter(Boolean));
    return this.tools.visibleTools(this.visibility()).filter((r) => {
      const name = r.tool.name;
      if (name === 'task' || name === 'ask_user' || name === 'todo_write') return false;
      if (def?.tools) return granted.has(name);
      return r.readOnly && (r.tool.permission === 'read' || r.tool.permission === 'none');
    });
  }

  private async subSystemPrompt(def: AgentDefinition | undefined): Promise<string> {
    const base = buildSystemPrompt({
      env: this.promptEnvironment(),
      mode: 'ask',
      projectInstructions: this.workspaceContext ? undefined : await this.projectInstructions(),
      contextSections: this.workspaceContext?.promptSections(),
      webFetchEnabled: this.getSettings().webFetchEnabled,
    });
    const parts = [
      base,
      [
        '## Sub-agent',
        'You are a sub-agent started by the main Gisoo agent to do one task. You cannot talk to the user: do not ask questions; make reasonable assumptions and state them.',
        'Only the tools listed in this request exist for you (todo_write and ask_user are not available).',
        'When you are done, reply with a concise report of what you found or did: file paths, line numbers, facts and the final answer. That reply is all the main agent will see.',
      ].join('\n'),
    ];
    if (def?.prompt.trim()) parts.push(`## Agent instructions (${def.name})\n${def.prompt.trim()}`);
    const graph = graphPromptSection();
    if (graph) parts.push(graph);
    return parts.join('\n\n');
  }

  private pickAgentModel(requested: unknown, def: AgentDefinition | undefined, settings: GisooSettings): string {
    const known = (id: string | undefined): string | undefined => {
      const clean = id?.trim();
      if (!clean) return undefined;
      return !this.modelsLoaded || this.models.some((m) => m.id === clean) ? clean : undefined;
    };
    return known(typeof requested === 'string' ? requested : undefined) ?? known(def?.model) ?? known(settings.subagentModel) ?? this.session.model;
  }

  private postAgent(info: AgentInfo): void {
    this.post({ type: 'agentUpdate', item: { ...info } });
    this.transcriptChanged.fire(agentDocUri(info.id));
  }

  private finishAgent(info: AgentInfo, status: AgentStatus, lastStep?: string): void {
    info.status = status;
    info.endedAt = Date.now();
    if (lastStep) info.lastStep = lastStep.slice(0, 200);
    else if (status === 'done') info.lastStep = undefined;
    this.postAgent(info);
    this.agentHistory.push(info);
    if (this.agentHistory.length > AGENT_HISTORY_MAX) this.agentHistory.splice(0, this.agentHistory.length - AGENT_HISTORY_MAX);
    const keep = new Set([...this.agentHistory.map((a) => a.id), ...this.agents.keys()]);
    for (const id of [...this.agentRecords.keys()]) if (!keep.has(id)) this.agentRecords.delete(id);
  }

  private findAgentInfo(id: string): AgentInfo | undefined {
    return this.agents.get(id)?.info ?? this.agentHistory.find((a) => a.id === id);
  }

  private hostT(key: HostStringKey, ...args: Array<string | number>): string {
    return hostStr(this.language, key, ...args);
  }

  /** Markdown transcript behind the read-only `gisoo-agent:` document (prompt, steps, results). */
  private agentTranscript(id: string): string {
    const info = this.findAgentInfo(id);
    if (!info) return this.hostT('host.agents.noTranscript');
    const record = this.agentRecords.get(id);
    const clip = (text: string): string => (text.length > TRANSCRIPT_PART_MAX ? `${text.slice(0, TRANSCRIPT_PART_MAX)}\n[...]` : text);
    const elapsed = Math.round(((info.endedAt ?? Date.now()) - info.startedAt) / 1000);
    const lines: string[] = [
      `# ${this.hostT('host.agents.transcriptTitle')}: ${info.name}`,
      '',
      `- id: ${info.id}${info.parentId ? `  (parent call ${info.parentId})` : ''}`,
      `- model: ${info.model}`,
      `- status: ${this.hostT(`host.agents.status.${info.status}`)}`,
      `- started: ${new Date(info.startedAt).toISOString()}  elapsed: ${elapsed} s`,
      `- tokens: ${info.tokens}  cost: ${formatUsd(info.costUsd) || '$0.00'}`,
    ];
    if (info.lastStep) lines.push(`- last step: ${info.lastStep}`);
    if (!record) {
      lines.push('', this.hostT('host.agents.noTranscript'), '');
      return lines.join('\n');
    }
    lines.push('', '## Prompt', '', record.prompt, '', '## Transcript', '');
    const callNames = new Map<string, string>();
    for (const m of record.messages) {
      if (m.role === 'system') continue;
      if (m.role === 'user') {
        if (m.content === record.prompt) continue;
        lines.push('### user', '', clip(typeof m.content === 'string' ? m.content : '(content parts)'), '');
        continue;
      }
      if (m.role === 'assistant') {
        lines.push('### assistant', '');
        if (typeof m.content === 'string' && m.content.trim()) lines.push(clip(m.content.trim()), '');
        for (const call of m.tool_calls ?? []) {
          callNames.set(call.id, call.function.name);
          lines.push(`- tool call \`${call.function.name}\``, '', '```json', clip(prettyInput(call.function.arguments)), '```', '');
        }
        continue;
      }
      const name = callNames.get(m.tool_call_id ?? '') ?? 'tool';
      lines.push(`### result of \`${name}\``, '', '```', clip(typeof m.content === 'string' ? m.content : '(content parts)'), '```', '');
    }
    return lines.join('\n');
  }

  private async openAgent(id: string): Promise<void> {
    if (!this.findAgentInfo(id)) {
      this.toast('info', this.hostT('host.agents.noTranscript'));
      return;
    }
    const uri = agentDocUri(id);
    this.transcriptChanged.fire(uri);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  /** Runs a finished agent again with the same prompt and definition, inside a new assistant turn. */
  private async retryAgent(id: string): Promise<void> {
    const original = this.findAgentInfo(id);
    const record = this.agentRecords.get(id);
    if (!original || !record) {
      this.toast('info', this.hostT('host.agents.noTranscript'));
      return;
    }
    if (this.agents.has(id) || this.running) {
      this.toast('warning', this.hostT('host.agents.retryBusy'));
      return;
    }
    if (!(await this.auth.hasKey())) {
      this.toast('warning', this.t('notice.signInFirst'));
      return;
    }
    await this.reloadDefinitions();
    const def = record.agentName ? findAgent(this.definitions, record.agentName) : undefined;
    const session = this.session;
    const turn = assistantTurn(session.model);
    session.turns.push(turn);
    this.post({ type: 'turn.add', turn });
    const info: AgentInfo = {
      id: newId('g'),
      sessionId: session.id,
      name: original.name,
      model: record.model,
      status: 'waiting',
      startedAt: Date.now(),
      tokens: 0,
      costUsd: 0,
      lastStep: firstLine(record.prompt).slice(0, 120),
    };
    const controller = new AbortController();
    const run: AgentRun = { info, controller, standalone: true };
    this.agents.set(info.id, run);
    this.agentRecords.set(info.id, { prompt: record.prompt, agentName: record.agentName, model: record.model, messages: [] });
    this.postAgent(info);
    this.toast('info', this.hostT('host.agents.retried', info.name));
    let release: (() => void) | undefined;
    let report: string;
    try {
      release = await this.semaphore.acquire(controller.signal);
      info.status = 'running';
      this.postAgent(info);
      report = await this.subLoop(run, def, record.prompt, { turn }, this.getSettings().maxAgentTurns);
      this.finishAgent(info, 'done');
    } catch (error) {
      if (controller.signal.aborted) {
        this.finishAgent(info, 'stopped');
        report = STOPPED_RESULT;
      } else {
        report = describeError(error);
        this.finishAgent(info, 'failed', report);
      }
    } finally {
      release?.();
      this.agents.delete(info.id);
    }
    turn.parts.push({ kind: 'text', text: `**${info.name}**\n\n${report || '(the sub-agent returned no text)'}` });
    turn.streaming = false;
    turn.stopped = info.status === 'stopped';
    turn.durationMs = Date.now() - info.startedAt;
    this.post({ type: 'turn.add', turn });
    await this.persist(session);
  }

  private async openPreview(target: string): Promise<void> {
    try {
      const { url, relative } = await previewManager().urlFor(target);
      await previewManager().open(url);
      this.toast('info', this.hostT('host.preview.opened', relative));
    } catch (error) {
      this.toast('error', describeError(error));
    }
  }

  /** `/agents new <name>`: writes .gisoo/agents/<name>.md from a template (trusted workspace only). */
  private async scaffoldAgent(rawName: string): Promise<void> {
    const name = rawName.trim().toLowerCase();
    const root = primaryRoot();
    if (!root || !vscode.workspace.isTrusted) {
      this.toast('warning', this.hostT('host.agents.scaffoldUntrusted'));
      return;
    }
    if (!AGENT_FILE_NAME.test(name)) {
      this.toast('warning', this.hostT('host.agents.scaffoldBadName'));
      return;
    }
    const dir = path.join(root, '.gisoo', 'agents');
    const file = path.join(dir, `${name}.md`);
    const rel = relativeToWorkspace(file);
    let exists = true;
    try {
      await fs.access(file);
    } catch {
      exists = false;
    }
    if (exists) {
      this.toast('warning', this.hostT('host.agents.scaffoldExists', name, rel));
    } else {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, agentTemplate(name), { encoding: 'utf8', flag: 'wx' });
      await this.reloadDefinitions();
      this.toast('info', this.hostT('host.agents.scaffolded', name, rel));
    }
    await vscode.window.showTextDocument(vscode.Uri.file(file));
  }

  private agentList(): AgentInfo[] {
    return [...this.agentHistory, ...[...this.agents.values()].map((a) => a.info)].map((a) => ({ ...a }));
  }

  private stopAgent(id: string): void {
    const run = this.agents.get(id);
    if (!run) {
      this.toast('info', this.t('agent.notFound'));
      return;
    }
    run.controller.abort();
    this.toast('info', this.t('agent.stopped'));
  }

  // -- Prompt and messages ------------------------------------------------------------------------

  private promptEnvironment(): PromptEnvironment {
    const editor = vscode.window.activeTextEditor;
    const isFile = editor?.document.uri.scheme === 'file';
    return {
      os: `${os.platform()} ${os.release()}`,
      shell: String(defaultShell()),
      workspaceFolders: workspaceRoots(),
      activeFile: editor && isFile ? relativeToWorkspace(editor.document.uri.fsPath) : undefined,
      selection: editor && isFile && !editor.selection.isEmpty ? { startLine: editor.selection.start.line + 1, endLine: editor.selection.end.line + 1 } : undefined,
      gitBranch: this.gitBranch(),
      date: new Date().toISOString().slice(0, 10),
      editorLanguage: editor && isFile ? editor.document.languageId : undefined,
    };
  }

  private gitBranch(): string | undefined {
    try {
      type GitApi = { repositories: Array<{ state: { HEAD?: { name?: string } } }> };
      const ext = vscode.extensions.getExtension<{ getAPI(version: number): GitApi }>('vscode.git');
      if (!ext?.isActive) return undefined;
      return ext.exports.getAPI(1).repositories[0]?.state.HEAD?.name;
    } catch {
      return undefined;
    }
  }

  private async projectInstructions(): Promise<{ file: string; content: string } | undefined> {
    const root = primaryRoot();
    if (!root || !vscode.workspace.isTrusted) return undefined;
    for (const file of PROJECT_INSTRUCTION_FILES) {
      try {
        const content = await readText(path.join(root, file));
        if (content && content.trim()) return { file, content: content.slice(0, PROJECT_INSTRUCTIONS_MAX_CHARS) };
      } catch {
        // unreadable: try the next one
      }
    }
    return undefined;
  }

  private async systemPrompt(mode: PermissionMode): Promise<string> {
    const settings = this.getSettings();
    const custom = userSetting<unknown>('customInstructions');
    let prompt = buildSystemPrompt({
      env: this.promptEnvironment(),
      mode,
      projectInstructions: this.workspaceContext ? undefined : await this.projectInstructions(),
      contextSections: this.workspaceContext?.promptSections(),
      customInstructions: typeof custom === 'string' ? custom : undefined,
      webFetchEnabled: settings.webFetchEnabled,
    });
    if (this.definitions.length) {
      prompt += `\n\n## Sub-agents\nThe task tool starts a sub-agent with a fresh context. Defined agents (pass the name as "agent"):\n${agentCatalogue(this.definitions)}`;
    }
    prompt += `\n\n${WEB_WORK_PROMPT}`;
    const graph = graphPromptSection();
    if (graph) prompt += `\n\n${graph}`;
    if (!vscode.workspace.isTrusted) {
      prompt += '\n\n## Untrusted workspace\nrun_command is not available and every edit needs the user\'s approval.';
    }
    return prompt;
  }

  private async addUserMessage(session: SessionData, text: string, attachments: Attachment[]): Promise<void> {
    if (!session.title) session.title = titleFromText(text) || titleFromText(attachments.map((a) => a.label).join(', '));
    session.messages.push(await this.userMessage(session, text, attachments));
    const turn = userTurn(text, attachments);
    session.turns.push(turn);
    this.post({ type: 'turn.add', turn });
  }

  private async userMessage(session: SessionData, text: string, attachments: Attachment[]): Promise<ChatMessage> {
    const vision = this.modelInfo(session.model).vision;
    const extra = await this.renderAttachments(attachments, vision);
    const body = extra ? `${text}\n\n${extra}` : text;
    const images = vision ? attachments.filter((a) => a.kind === 'image' && a.dataUri) : [];
    if (!images.length) return { role: 'user', content: body };
    const parts: ContentPart[] = [{ type: 'text', text: body }];
    for (const image of images) parts.push({ type: 'image_url', image_url: { url: image.dataUri ?? '' } });
    return { role: 'user', content: parts };
  }

  /** File and selection attachments as fenced blocks; images are only noted when the model cannot see them. */
  private async renderAttachments(attachments: Attachment[], vision: boolean): Promise<string> {
    const blocks: string[] = [];
    for (const a of attachments) {
      if (a.kind === 'image') {
        if (!vision) blocks.push(`[image "${a.label}" omitted: this model cannot see images]`);
        continue;
      }
      if (!a.path) continue;
      try {
        const resolved = await resolvePath(a.path);
        const content = await readText(resolved.absolute);
        if (content === null) {
          blocks.push(`<file path="${resolved.relative}">(file not found)</file>`);
          continue;
        }
        let body = content;
        let range = '';
        if (a.kind === 'selection' && a.startLine) {
          const end = a.endLine ?? a.startLine;
          body = formatWithLineNumbers(content.split('\n').slice(a.startLine - 1, end).join('\n'), a.startLine);
          range = ` lines="${a.startLine}-${end}"`;
        }
        if (body.length > ATTACHMENT_MAX_CHARS) body = `${body.slice(0, ATTACHMENT_MAX_CHARS)}\n[truncated]`;
        blocks.push(`<file path="${resolved.relative}"${range}>\n${body}\n</file>`);
      } catch (error) {
        blocks.push(`<file path="${a.path}">(could not read: ${describeError(error)})</file>`);
      }
    }
    return blocks.join('\n\n');
  }

  private async drainSteer(session: SessionData): Promise<Injected | undefined> {
    const items = this.steer.drain();
    if (!items.length) return undefined;
    const vision = this.modelInfo(session.model).vision;
    const rendered = new WeakMap<Attachment[], string>();
    for (const q of items) rendered.set(q.attachments, await this.renderAttachments(q.attachments, vision));
    return { message: injectedUserMessage(items, (a) => rendered.get(a) ?? ''), items };
  }

  /** Adds the injected user turns to the view (the API message is appended by the caller). */
  private applyInjected(session: SessionData, injected: Injected): void {
    if (session.messages[session.messages.length - 1] !== injected.message) session.messages.push(injected.message);
    for (const q of injected.items) {
      const turn = userTurn(q.text, q.attachments, true);
      session.turns.push(turn);
      this.post({ type: 'turn.add', turn });
    }
  }

  private drainLater(): void {
    const next = this.later.peek()[0];
    if (!next || this.running) return;
    this.later.remove(next.id);
    void this.onSend(next.text, next.attachments);
  }

  // -- Stop and retry -----------------------------------------------------------------------------

  private stop(): void {
    this.abort?.abort();
    for (const run of this.agents.values()) run.controller.abort();
  }

  private async stopAndWait(): Promise<void> {
    this.stop();
    await this.task;
  }

  private async retry(): Promise<void> {
    if (this.running) {
      this.toast('warning', this.t('notice.busy'));
      return;
    }
    const last = this.session.messages[this.session.messages.length - 1];
    if (!this.canRetry || !last || last.role === 'assistant') {
      this.toast('info', this.t('notice.nothingToRetry'));
      return;
    }
    this.launch();
  }

  // -- Sessions -----------------------------------------------------------------------------------

  private async persist(session: SessionData): Promise<void> {
    if (!session.turns.length) return;
    session.updatedAt = Date.now();
    try {
      await this.store.save(session);
    } catch {
      // storage problems must not break the loop
    }
  }

  private switchTo(session: SessionData): void {
    this.session = session;
    this.checkpoints.clear();
    this.steer.clear();
    this.later.clear();
    this.agentHistory = [];
    this.canRetry = false;
    this.post({ type: 'session', session: this.view() });
    this.post({ type: 'mode', mode: session.mode });
    this.post({ type: 'models', models: this.modelList(), current: session.model });
    this.post({ type: 'agents', items: this.agentList() });
  }

  private async newSession(): Promise<void> {
    await this.stopAndWait();
    await this.persist(this.session);
    this.switchTo(createSession(this.session.model, this.session.mode));
    await this.postSessions();
  }

  private async openSession(id: string): Promise<void> {
    if (id === this.session.id) {
      this.post({ type: 'session', session: this.view() });
      return;
    }
    const data = await this.store.load(id);
    if (!data) {
      await this.postSessions();
      return;
    }
    await this.stopAndWait();
    await this.persist(this.session);
    this.switchTo(data);
    await this.postSessions();
  }

  private async deleteSession(id: string): Promise<void> {
    await this.store.delete(id);
    if (id === this.session.id) {
      await this.stopAndWait();
      this.switchTo(createSession(this.session.model, this.session.mode));
    }
    await this.postSessions();
  }

  private async postSessions(): Promise<void> {
    this.post({ type: 'sessions', items: await this.store.list() });
  }

  private async setModel(id: string): Promise<void> {
    const clean = id.trim();
    if (!clean) return;
    this.session.model = clean;
    this.post({ type: 'models', models: this.modelList(), current: clean });
    this.post({ type: 'cost', costUsd: this.session.costUsd, contextUsed: this.contextUsed(this.session) });
    try {
      await vscode.workspace.getConfiguration('gisoo').update('model', clean, vscode.ConfigurationTarget.Global);
    } catch {
      // settings may be read-only here
    }
    await this.persist(this.session);
  }

  private setMode(mode: PermissionMode): void {
    if (this.session.mode === mode) return;
    this.session.mode = mode;
    this.post({ type: 'mode', mode });
    void this.persist(this.session);
  }

  private async planStart(): Promise<void> {
    if (this.running) {
      this.toast('warning', this.t('notice.busy'));
      return;
    }
    this.setMode('ask');
    this.launch({ text: Prompts.planGo, attachments: [] });
  }

  private async restoreCheckpoint(turnId: string): Promise<void> {
    if (this.running) {
      this.toast('warning', this.t('notice.busy'));
      return;
    }
    const turns = this.session.turns;
    const at = turns.findIndex((t) => t.id === turnId);
    if (at < 0 || !this.checkpoints.has(turnId)) {
      this.toast('info', this.t('notice.noCheckpoint'));
      return;
    }
    // Later turns may have touched the same files: undo from the newest back to this one.
    let count = 0;
    for (let i = turns.length - 1; i >= at; i--) {
      const turn = turns[i];
      if (turn.role !== 'assistant' || !this.checkpoints.has(turn.id)) continue;
      count += await this.checkpoints.restore(turn.id);
      turn.hasCheckpoint = false;
    }
    this.post({ type: 'session', session: this.view() });
    this.toast('info', this.t('notice.restoredFiles', count));
    await this.persist(this.session);
  }

  private async openDiff(callId: string): Promise<void> {
    const call = this.findCall(callId);
    if (!call?.edit?.diff) {
      this.toast('warning', hostStr(this.language, 'host.cannotOpen', call?.edit?.path ?? 'diff'));
      return;
    }
    const doc = await vscode.workspace.openTextDocument({ content: call.edit.diff, language: 'diff' });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  private findCall(callId: string): ToolCallView | undefined {
    for (const turn of this.session.turns) {
      if (turn.role !== 'assistant') continue;
      for (const part of turn.parts) if (part.kind === 'tool' && part.call.id === callId) return part.call;
    }
    return undefined;
  }

  // -- Models -------------------------------------------------------------------------------------

  private async loadModels(force: boolean): Promise<void> {
    if (this.modelsLoaded && !force) {
      this.post({ type: 'models', models: this.modelList(), current: this.session.model });
      return;
    }
    try {
      const list = catalogue(await this.client.models());
      if (list.length) {
        this.models = list;
        this.modelsLoaded = true;
      }
    } catch {
      // keep the fallback list; the picker is never empty
    }
    this.post({ type: 'models', models: this.modelList(), current: this.session.model });
  }

  private modelInfo(id: string): ModelInfo {
    return this.models.find((m) => m.id === id) ?? fallbackModel(id);
  }

  private modelList(): ModelInfo[] {
    const current = this.session.model;
    return this.models.some((m) => m.id === current) ? this.models : [fallbackModel(current), ...this.models];
  }

  // -- Slash commands -----------------------------------------------------------------------------

  private slashCommands(): SlashCommandInfo[] {
    const lang = this.language;
    const builtin = Object.entries(SLASH_DESCRIPTIONS).map(([name, entry]) => ({ name, description: entry[lang], source: 'builtin' as const }));
    return [...builtin, ...(this.workspaceContext?.slashCommands() ?? [])];
  }

  /** Returns true when the text was a built-in or custom command and has been handled. */
  private async slash(text: string, attachments: Attachment[]): Promise<boolean> {
    const m = /^\/([a-z0-9][a-z0-9_:.-]*)(?:\s+([\s\S]*))?$/i.exec(text);
    if (!m) return false;
    const command = m[1].toLowerCase();
    const arg = (m[2] ?? '').trim();
    switch (command) {
      case 'new':
        await this.newSession();
        return true;
      case 'compact':
        await this.compactNow();
        return true;
      case 'model':
        if (!arg) {
          this.toast('info', this.t('notice.useModelPicker'));
          return true;
        }
        await this.setModel(arg);
        this.toast('info', this.t('notice.modelSet', arg));
        return true;
      case 'plan':
        this.setMode('plan');
        if (arg) this.launch({ text: arg, attachments });
        return true;
      case 'review': {
        const diff = await this.gitDiff();
        const prompt = diff ? Prompts.review(diff) : Prompts.reviewNoDiff;
        this.launch({ text: arg ? `${prompt}\n\n${arg}` : prompt, attachments });
        return true;
      }
      case 'explain': {
        const target = selectionAttachment() ?? fileAttachment();
        if (!target) {
          this.toast('warning', this.t('notice.noActiveFile'));
          return true;
        }
        this.launch({ text: arg ? `${Prompts.explain}\n\n${arg}` : Prompts.explain, attachments: [...attachments, target] });
        return true;
      }
      case 'tests': {
        const target = fileAttachment();
        if (!target?.path) {
          this.toast('warning', this.t('notice.noActiveFile'));
          return true;
        }
        const prompt = Prompts.tests(target.path);
        this.launch({ text: arg ? `${prompt}\n\n${arg}` : prompt, attachments: [...attachments, target] });
        return true;
      }
      case 'init': {
        const root = primaryRoot();
        const prompt = root && vscode.workspace.isTrusted ? initPrompt(await detectInitSources(root)) : Prompts.init;
        this.launch({ text: arg ? `${prompt}\n\n${arg}` : prompt, attachments });
        return true;
      }
      case 'memory':
        await this.openMemory();
        return true;
      case 'skills': {
        const sub = /^install\s+([\s\S]+)$/i.exec(arg);
        if (sub) {
          await vscode.commands.executeCommand('gisoo.installSkill', sub[1].trim());
          return true;
        }
        await this.workspaceContext?.refreshIfChanged().catch(() => undefined);
        const skills = this.workspaceContext?.skillList() ?? [];
        const lines = skills.map((s) => `- **${s.name}**${s.description ? `: ${s.description}` : ''} (${s.scope}, ${s.source}, ${relativeToWorkspace(s.dir)})`);
        this.localReply(lines.length ? `**${this.t('skills.title')}**\n\n${lines.join('\n')}\n\n${this.t('skills.installHint')}` : this.t('skills.none'));
        return true;
      }
      case 'cost': {
        const info = this.modelInfo(this.session.model);
        const priced = info.inputPerMillion !== undefined && info.outputPerMillion !== undefined;
        const used = `${Math.round(this.contextUsed(this.session) * 100)}%`;
        const text = priced || this.session.costUsd > 0 ? this.t('cost.session', formatUsd(this.session.costUsd) || '$0.00', used) : this.t('cost.unknown');
        this.localReply(text);
        return true;
      }
      case 'agents': {
        const scaffold = /^new(?:\s+(\S+))?\s*$/i.exec(arg);
        if (scaffold) {
          if (scaffold[1]) await this.scaffoldAgent(scaffold[1]);
          else this.toast('info', this.hostT('host.agents.scaffoldUsage'));
          return true;
        }
        await this.reloadDefinitions();
        const lines = this.definitions.map((d) => `- **${d.name}**${d.description ? `: ${d.description}` : ''} (${d.scope}, ${relativeToWorkspace(d.path)})`);
        this.localReply(lines.length ? `**${this.t('agents.title')}**\n\n${lines.join('\n')}` : this.t('agents.none'));
        this.post({ type: 'agents.show' });
        return true;
      }
      case 'help': {
        const all = this.slashCommands();
        const line = (c: SlashCommandInfo): string => `- \`/${c.name}\`: ${c.description}`;
        const builtin = all.filter((c) => c.source === 'builtin').map(line);
        const custom = all.filter((c) => c.source !== 'builtin').map(line);
        const parts = [`**${this.t('help.title')}**\n\n${builtin.join('\n')}`];
        if (custom.length) parts.push(`**${this.t('help.custom')}**\n\n${custom.join('\n')}`);
        this.localReply(parts.join('\n\n'));
        return true;
      }
      default: {
        const custom = this.workspaceContext ? findCommand(this.workspaceContext.customCommands(), command) : undefined;
        if (!custom) return false;
        const expanded = expandCommand(custom, arg);
        if (!expanded) return false;
        this.launch({ text: expanded, attachments });
        return true;
      }
    }
  }

  /** A finished assistant turn produced locally (no model call, not part of the API conversation). */
  private localReply(markdown: string): void {
    const turn = assistantTurn(this.session.model);
    turn.parts.push({ kind: 'text', text: markdown });
    turn.streaming = false;
    turn.durationMs = 0;
    this.session.turns.push(turn);
    this.post({ type: 'turn.add', turn });
    void this.persist(this.session);
  }

  private async gitDiff(): Promise<string> {
    const cwd = primaryRoot();
    if (!cwd || !vscode.workspace.isTrusted) return '';
    try {
      const result = await runShell('git diff', { cwd, timeoutMs: 20_000 });
      if (result.exitCode !== 0) return '';
      return result.output.trim().slice(0, DIFF_PROMPT_MAX_CHARS);
    } catch {
      return '';
    }
  }

  // -- Helpers ------------------------------------------------------------------------------------

  private async reloadDefinitions(): Promise<void> {
    try {
      this.definitions = await loadAgentDefinitions({
        workspaceRoots: workspaceRoots(),
        compatClaude: this.getSettings().compatClaude,
        workspaceTrusted: vscode.workspace.isTrusted,
      });
    } catch {
      this.definitions = [];
    }
  }

  private view(session: SessionData = this.session): ReturnType<typeof toSessionView> {
    return toSessionView(session, this.running && session === this.session, this.queueItems(), this.contextUsed(session));
  }

  private contextUsed(session: SessionData): number {
    return contextShare(session.messages, this.modelInfo(session.model).contextLength);
  }

  private queueItems(): QueuedMessage[] {
    return [
      ...this.steer.peek().map((q) => ({ ...q, delivery: 'steer' as const })),
      ...this.later.peek().map((q) => ({ ...q, delivery: 'queue' as const })),
    ];
  }

  private postQueue(): void {
    this.post({ type: 'queue', queue: this.queueItems() });
  }

  private toast(level: 'info' | 'warning' | 'error', text: string): void {
    this.post({ type: 'toast', level, text });
  }

  private get language(): UiLanguage {
    return this.getSettings().language;
  }

  private t(key: StringKey, ...args: Array<string | number>): string {
    return str(this.language, key, ...args);
  }
}
