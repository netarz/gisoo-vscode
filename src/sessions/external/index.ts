/**
 * Chats from other AI coding tools for the open folder, listed lazily and imported on request.
 * Everything stays on this machine: a chat is only read here and copied into a Gisoo session.
 */
import * as fs from 'node:fs/promises';
import type { ChatMessage } from '../../api/types';
import type { PermissionMode } from '../../shared/protocol';
import type { SessionData } from '../../agent/session';
import { assistantTurn, createSession, userTurn } from '../../agent/session';
import { claudeConfigDir, listClaudeSessions, readClaudeTranscript, summarizeClaudeFile } from './claudeCode';
import { codexHome, listCodexSessions, readCodexIndex, readCodexTranscript, summarizeCodexFile, type CodexMeta } from './codex';
import { SOURCE_LABELS, type ExternalSession, type ExternalSource, type ExternalTranscript } from './types';

export * from './types';

export function originKey(source: ExternalSource, id: string): string {
  return `${source}:${id}`;
}

interface Cached {
  mtime: number;
  size: number;
  item: ExternalSession | undefined;
}

export interface ExternalChatsOptions {
  home: string;
  env?: NodeJS.ProcessEnv;
  limit?: number;
}

export class ExternalChats {
  private readonly summaries = new Map<string, Cached>();
  private readonly codexMeta = new Map<string, CodexMeta>();
  /** `source:id` -> file, from the last listing. */
  private readonly files = new Map<string, string>();

  constructor(private readonly options: ExternalChatsOptions) {}

  /** Wraps a summarizer with an mtime/size cache so reopening the panel is cheap. */
  private cached<A extends unknown[]>(fn: (file: string, ...rest: A) => Promise<ExternalSession | undefined>) {
    return async (file: string, ...rest: A): Promise<ExternalSession | undefined> => {
      const st = await fs.stat(file);
      const hit = this.summaries.get(file);
      if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.item;
      const item = await fn(file, ...rest);
      this.summaries.set(file, { mtime: st.mtimeMs, size: st.size, item });
      return item;
    };
  }

  /** Chats for the given folders, newest first, per source. */
  async list(workspaces: string[]): Promise<ExternalSession[]> {
    const env = this.options.env ?? process.env;
    const limit = this.options.limit ?? 50;
    const out: ExternalSession[] = [];
    const claudeDir = claudeConfigDir(this.options.home, env);
    const codexDir = codexHome(this.options.home, env);
    for (const workspace of workspaces) {
      const [claude, codex] = await Promise.all([
        listClaudeSessions(claudeDir, workspace, { limit }, this.cached(summarizeClaudeFile)).catch(() => []),
        listCodexSessions(codexDir, workspace, { limit }, this.codexMeta, this.cached(summarizeCodexFile)).catch(() => []),
      ]);
      out.push(...claude, ...codex);
    }
    const seen = new Set<string>();
    const unique = out.filter((item) => {
      const key = originKey(item.source, item.id);
      if (seen.has(key)) return false;
      seen.add(key);
      this.files.set(key, item.filePath);
      return true;
    });
    return unique.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Reads one listed chat in full. Only ids from a previous listing are accepted. */
  async read(source: ExternalSource, id: string): Promise<ExternalTranscript | undefined> {
    const file = this.files.get(originKey(source, id));
    if (!file) return undefined;
    if (source === 'claude-code') return readClaudeTranscript(file);
    const names = await readCodexIndex(codexHome(this.options.home, this.options.env ?? process.env));
    return readCodexTranscript(file, names.get(id));
  }
}

/** What the model is told once, at the top of the imported history. */
export function importPreamble(source: ExternalSource): string {
  return `(This conversation was started in ${SOURCE_LABELS[source]} and imported into Gisoo. Lines in square brackets summarise tool calls and results from that tool; they are history only. Use your own tools for any new work.)`;
}

/** Turns an external chat into a new Gisoo session with the same history. */
export function transcriptToSession(transcript: ExternalTranscript, model: string, mode: PermissionMode, notice: string): SessionData {
  const session = createSession(model, mode);
  const label = SOURCE_LABELS[transcript.source];
  session.title = `${transcript.title} · ${label}`;
  session.origin = originKey(transcript.source, transcript.id);
  const messages: ChatMessage[] = [];
  const first = transcript.turns.find((t) => t.at)?.at;
  if (first) session.createdAt = first;
  const preamble = importPreamble(transcript.source) + (transcript.omitted ? `\n(${transcript.omitted} earlier messages were too long to carry over and were left out.)` : '');
  for (const turn of transcript.turns) {
    const at = turn.at ?? Date.now();
    if (turn.role === 'user') {
      const view = userTurn(turn.text, []);
      view.createdAt = at;
      session.turns.push(view);
      messages.push({ role: 'user', content: messages.length ? turn.text : `${preamble}\n\n${turn.text}` });
    } else {
      if (!messages.length) messages.push({ role: 'user', content: preamble });
      const view = assistantTurn(label);
      view.streaming = false;
      view.createdAt = at;
      view.parts.push({ kind: 'text', text: turn.text });
      session.turns.push(view);
      messages.push({ role: 'assistant', content: turn.text });
    }
  }
  // A closing note tells the user the next message continues here.
  let last = session.turns[session.turns.length - 1];
  if (!last || last.role !== 'assistant') {
    const view = assistantTurn(label);
    view.streaming = false;
    session.turns.push(view);
    last = view;
  }
  if (last.role === 'assistant') last.parts.push({ kind: 'notice', level: 'info', text: notice });
  session.messages = messages;
  session.updatedAt = Date.now();
  return session;
}
