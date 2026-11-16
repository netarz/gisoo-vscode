/**
 * Codex chats: `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`. The first line is a
 * `session_meta` record whose payload carries the `cwd`; messages are `response_item` records.
 * Thread names live in `<CODEX_HOME>/session_index.jsonl`. Read-only.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { asRecord, asString, COUNT_MAX_BYTES, headLines, oneLineTitle, parseJson, sameDir, scanLines, tailLines, timeOf, toolLine, toolResultLine, TurnBuilder } from './lines';
import type { ExternalSession, ExternalTranscript, ListOptions } from './types';

const META_HEAD_BYTES = 8 * 1024;
const META_FALLBACK_BYTES = 64 * 1024;
const FIRST_PROMPT_MAX_BYTES = 4 * 1024 * 1024;
const INDEX_MAX_BYTES = 4 * 1024 * 1024;
const PARALLEL = 16;

export function codexHome(home: string, env: NodeJS.ProcessEnv = process.env): string {
  const custom = env.CODEX_HOME?.trim();
  return custom ? custom : path.join(home, '.codex');
}

const ID_IN_NAME = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

export function codexIdFromFile(file: string): string {
  return ID_IN_NAME.exec(file)?.[1] ?? path.basename(file, '.jsonl');
}

/** What the start of a rollout says: its folder, and whether it is a sub-agent thread. */
export interface CodexMeta {
  cwd?: string;
  subagent: boolean;
}

function decodeJsonString(raw: string): string | undefined {
  try {
    const value: unknown = JSON.parse(`"${raw}"`);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the cwd from the head of a rollout without parsing its (large) first line. */
export async function readCodexMeta(file: string): Promise<CodexMeta> {
  const handle = await fs.open(file, 'r');
  let head = '';
  try {
    const buffer = Buffer.alloc(META_HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, META_HEAD_BYTES, 0);
    head = buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
  const subagent = /"source"\s*:\s*\{\s*"subagent"/.test(head);
  const match = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(head);
  if (match) return { cwd: decodeJsonString(match[1]), subagent };
  // Older rollouts carry the folder only inside <environment_context>.
  const more = (await headLines(file, META_FALLBACK_BYTES)).join('\n');
  const env = /<cwd>([^<]+)<\/cwd>/.exec(more.replace(/\\n/g, '\n'));
  return { cwd: env ? decodeJsonString(env[1]) ?? env[1] : undefined, subagent };
}

/** id -> thread name, last entry wins. */
export async function readCodexIndex(home: string): Promise<Map<string, string>> {
  const file = path.join(home, 'session_index.jsonl');
  const names = new Map<string, string>();
  let lines: string[];
  try {
    lines = await tailLines(file, INDEX_MAX_BYTES);
  } catch {
    return names;
  }
  for (const line of lines) {
    const o = parseJson(line);
    const id = asString(o?.id);
    const name = asString(o?.thread_name);
    if (id && name?.trim()) names.set(id, name.trim());
  }
  return names;
}

/** Rollout files, newest first (by their dated folders and names). */
export async function codexRollouts(home: string): Promise<string[]> {
  const root = path.join(home, 'sessions');
  const out: string[] = [];
  const sortedDirs = async (dir: string): Promise<string[]> => {
    try {
      return (await fs.readdir(dir)).filter((n) => /^\d+$/.test(n)).sort((a, b) => Number(b) - Number(a));
    } catch {
      return [];
    }
  };
  for (const year of await sortedDirs(root)) {
    for (const month of await sortedDirs(path.join(root, year))) {
      for (const day of await sortedDirs(path.join(root, year, month))) {
        const dir = path.join(root, year, month, day);
        let names: string[] = [];
        try {
          names = await fs.readdir(dir);
        } catch {
          continue;
        }
        names.filter((n) => n.startsWith('rollout-') && n.endsWith('.jsonl')).sort().reverse().forEach((n) => out.push(path.join(dir, n)));
      }
    }
  }
  return out;
}

const INJECTED_WRAPPER = /^\s*<([A-Za-z_][\w-]*)\b[^>]*>[\s\S]*<\/\1>\s*$/;

/** A user text part Codex injected itself (instructions, environment, image markers). */
export function isInjectedCodexText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.startsWith('# AGENTS.md instructions')) return true;
  if (/^<\/?image\b/i.test(t)) return true;
  if (/^<(environment_context|user_instructions|permissions|INSTRUCTIONS|skills_instructions|turn_aborted|user_shell_command)\b/i.test(t)) return true;
  return INJECTED_WRAPPER.test(t);
}

/** The real words of a user message, or '' when the whole message was injected. */
export function codexUserText(content: unknown): string {
  if (typeof content === 'string') return isInjectedCodexText(content) ? '' : content.trim();
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  let images = 0;
  for (const raw of content) {
    const b = asRecord(raw);
    if (!b) continue;
    if (b.type === 'input_image') images++;
    const text = asString(b.text);
    if ((b.type === 'input_text' || b.type === 'text') && text && !isInjectedCodexText(text)) parts.push(text.trim());
  }
  if (!parts.length) return '';
  if (images) parts.push(images === 1 ? '[1 image attached]' : `[${images} images attached]`);
  return parts.join('\n');
}

function outputText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c) => {
    const r = asRecord(c);
    return r && (r.type === 'output_text' || r.type === 'text') ? asString(r.text) ?? '' : '';
  }).filter(Boolean).join('\n');
}

function callOutput(output: unknown): string {
  if (typeof output === 'string') {
    const parsed = parseJson(output);
    const inner = asString(parsed?.output);
    return inner ?? output;
  }
  const r = asRecord(output);
  if (r) return asString(r.output) ?? asString(r.content) ?? outputText(r.content);
  return outputText(output);
}

/** Applies one rollout line to the builder; returns the user text it added, if any. */
function applyCodexLine(o: Record<string, unknown>, builder: TurnBuilder): string | undefined {
  if (o.type !== 'response_item') return undefined;
  const p = asRecord(o.payload);
  if (!p) return undefined;
  const at = timeOf(o.timestamp);
  switch (p.type) {
    case 'message': {
      if (p.role === 'user') {
        const text = codexUserText(p.content);
        if (text) builder.add('user', text, at);
        return text || undefined;
      }
      if (p.role === 'assistant') builder.add('assistant', outputText(p.content), at);
      return undefined;
    }
    case 'function_call':
      builder.add('assistant', toolLine(asString(p.name) ?? 'tool', p.arguments), at);
      return undefined;
    case 'custom_tool_call':
      builder.add('assistant', toolLine(asString(p.name) ?? 'tool', p.input), at);
      return undefined;
    case 'local_shell_call': {
      const action = asRecord(p.action);
      builder.add('assistant', toolLine('shell', { command: action?.command }), at);
      return undefined;
    }
    case 'web_search_call': {
      const action = asRecord(p.action);
      builder.add('assistant', toolLine('web_search', { query: action?.query }), at);
      return undefined;
    }
    case 'function_call_output':
    case 'custom_tool_call_output':
    case 'local_shell_call_output':
      builder.add('assistant', toolResultLine(callOutput(p.output)), at);
      return undefined;
    default:
      return undefined; // reasoning and everything else is dropped
  }
}

export async function readCodexTranscript(file: string, title?: string): Promise<ExternalTranscript> {
  const builder = new TurnBuilder();
  let firstPrompt = '';
  let skippedLines = 0;
  await scanLines(file, (line) => {
    if (line === undefined) {
      skippedLines++;
      return;
    }
    const o = parseJson(line);
    if (!o) return;
    const text = applyCodexLine(o, builder);
    if (text && !firstPrompt) firstPrompt = text;
  });
  const { turns, omitted } = builder.finish();
  const id = codexIdFromFile(file);
  return { source: 'codex', id, title: oneLineTitle(title || firstPrompt || id), turns, omitted, skippedLines };
}

async function firstCodexPrompt(file: string): Promise<string> {
  let found = '';
  const scratch = new TurnBuilder();
  await scanLines(file, (line) => {
    const o = parseJson(line);
    const text = o ? applyCodexLine(o, scratch) : undefined;
    if (text) {
      found = text;
      return true;
    }
    return false;
  }, FIRST_PROMPT_MAX_BYTES);
  return found;
}

export async function summarizeCodexFile(file: string, names: Map<string, string>): Promise<ExternalSession | undefined> {
  const stat = await fs.stat(file);
  const id = codexIdFromFile(file);
  let messageCount: number | undefined;
  let title = names.get(id) ?? '';
  if (stat.size <= COUNT_MAX_BYTES) {
    const transcript = await readCodexTranscript(file, title);
    if (!transcript.turns.some((t) => t.role === 'user')) return undefined;
    messageCount = transcript.turns.length + transcript.omitted;
    title = transcript.title;
  } else if (!title) {
    title = await firstCodexPrompt(file);
    if (!title) return undefined;
  }
  return { source: 'codex', id, title: oneLineTitle(title), updatedAt: stat.mtimeMs, messageCount, filePath: file };
}

/**
 * Newest Codex chats whose cwd is `workspace`. `metaCache` keeps each rollout's cwd across calls
 * (rollouts only grow at the end, so the head never changes).
 */
export async function listCodexSessions(home: string, workspace: string, options: ListOptions = {}, metaCache = new Map<string, CodexMeta>(), summarize = summarizeCodexFile): Promise<ExternalSession[]> {
  const limit = options.limit ?? 50;
  const files = await codexRollouts(home);
  const matches: string[] = [];
  for (let i = 0; i < files.length && matches.length < limit; i += PARALLEL) {
    const batch = files.slice(i, i + PARALLEL);
    const metas = await Promise.all(batch.map(async (file) => {
      let meta = metaCache.get(file);
      if (!meta) {
        try {
          meta = await readCodexMeta(file);
        } catch {
          meta = { subagent: true };
        }
        metaCache.set(file, meta);
      }
      return meta;
    }));
    batch.forEach((file, k) => {
      const m = metas[k];
      if (!m.subagent && m.cwd && sameDir(m.cwd, workspace)) matches.push(file);
    });
  }
  if (!matches.length) return [];
  const names = await readCodexIndex(home);
  const out: ExternalSession[] = [];
  for (const file of matches.slice(0, limit)) {
    try {
      const item = await summarize(file, names);
      if (item) out.push(item);
    } catch {
      // unreadable: skip
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
