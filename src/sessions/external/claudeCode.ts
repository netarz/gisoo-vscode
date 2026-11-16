/**
 * Claude Code chats: `<config>/projects/<encoded cwd>/<session id>.jsonl`, where the folder name
 * is the workspace path with every character that is not a letter or digit replaced by `-`.
 * The encoding is lossy, so the `cwd` inside the lines is checked as well. Read-only.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { asRecord, asString, COUNT_MAX_BYTES, headLines, oneLineTitle, parseJson, sameDir, scanLines, tailLines, timeOf, toolLine, toolResultLine, TurnBuilder } from './lines';
import type { ExternalSession, ExternalTranscript, ListOptions } from './types';

const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 256 * 1024;
/** How far a listing reads to find the first real user message. */
const FIRST_PROMPT_MAX_BYTES = 4 * 1024 * 1024;

export function claudeConfigDir(home: string, env: NodeJS.ProcessEnv = process.env): string {
  const custom = env.CLAUDE_CONFIG_DIR?.trim();
  return custom ? custom : path.join(home, '.claude');
}

/** `c:\Projects\foo` -> `c--Projects-foo`. */
export function encodeClaudeProject(dir: string): string {
  return dir.replace(/[\\/]+$/, '').replace(/[^A-Za-z0-9]/g, '-');
}

/** Project folders under `<config>/projects` that belong to `workspace` (case-insensitive). */
export async function claudeProjectDirs(configDir: string, workspace: string): Promise<string[]> {
  const root = path.join(configDir, 'projects');
  const wanted = encodeClaudeProject(workspace).toLowerCase();
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return [];
  }
  return names.filter((n) => n.toLowerCase() === wanted).map((n) => path.join(root, n));
}

const WRAPPER_START = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr|user-memory-input)\b/;

/** User text without injected reminders; empty when the whole message was tooling. */
export function cleanClaudeUserText(text: string): string {
  if (WRAPPER_START.test(text)) return '';
  const stripped = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (/^\[Request interrupted by user/.test(stripped)) return '';
  return stripped;
}

interface ClaudeLine {
  kind: 'user' | 'assistant' | 'title' | 'other';
  /** For titles: 3 custom, 2 ai, 1 summary. */
  titleRank?: number;
  title?: string;
  cwd?: string;
  /** Real user text (user lines only). */
  userText?: string;
  record?: Record<string, unknown>;
}

function classify(line: string | undefined): ClaudeLine {
  const o = parseJson(line);
  if (!o) return { kind: 'other' };
  const type = asString(o.type);
  const cwd = asString(o.cwd);
  if (type === 'custom-title' && asString(o.customTitle)) return { kind: 'title', titleRank: 3, title: asString(o.customTitle) };
  if (type === 'ai-title' && asString(o.aiTitle)) return { kind: 'title', titleRank: 2, title: asString(o.aiTitle) };
  if (type === 'summary' && asString(o.summary)) return { kind: 'title', titleRank: 1, title: asString(o.summary) };
  if (type !== 'user' && type !== 'assistant') return { kind: 'other', cwd };
  if (o.isSidechain === true || o.isMeta === true) return { kind: 'other', cwd };
  if (type === 'user') {
    const content = asRecord(o.message)?.content;
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) text = content.map((b) => (asRecord(b)?.type === 'text' ? asString(asRecord(b)?.text) ?? '' : '')).filter(Boolean).join('\n');
    return { kind: 'user', cwd, userText: cleanClaudeUserText(text), record: o };
  }
  return { kind: 'assistant', cwd, record: o };
}

function pickTitle(lines: ClaudeLine[], current: { rank: number; title: string }): void {
  for (const l of lines) {
    if (l.kind === 'title' && l.title && (l.titleRank ?? 0) >= current.rank) {
      current.rank = l.titleRank ?? 0;
      current.title = l.title;
    }
  }
}

/** Reads the summary of one transcript, or undefined when it is not a chat in `workspace`. */
export async function summarizeClaudeFile(file: string, workspace: string): Promise<ExternalSession | undefined> {
  const stat = await fs.stat(file);
  const head = (await headLines(file, HEAD_BYTES)).map(classify);
  const cwd = head.find((l) => l.cwd)?.cwd;
  if (cwd && !sameDir(cwd, workspace)) return undefined;
  const title = { rank: 0, title: '' };
  pickTitle(head, title);
  let firstPrompt = head.find((l) => l.kind === 'user' && l.userText)?.userText;
  if (!firstPrompt && stat.size > HEAD_BYTES) {
    await scanLines(file, (line) => {
      const l = classify(line);
      if (l.kind === 'user' && l.userText) {
        firstPrompt = l.userText;
        return true;
      }
      return false;
    }, FIRST_PROMPT_MAX_BYTES);
  }
  if (!firstPrompt) return undefined;
  if (stat.size > HEAD_BYTES) pickTitle((await tailLines(file, TAIL_BYTES, stat.size)).map(classify), title);
  let messageCount: number | undefined;
  if (stat.size <= COUNT_MAX_BYTES) {
    const transcript = await readClaudeTranscript(file);
    messageCount = transcript.turns.length + transcript.omitted;
  }
  const id = path.basename(file, '.jsonl');
  return {
    source: 'claude-code',
    id,
    title: oneLineTitle(title.title || firstPrompt),
    updatedAt: stat.mtimeMs,
    messageCount,
    filePath: file,
  };
}

/** Newest chats for `workspace`, at most `limit`. */
export async function listClaudeSessions(configDir: string, workspace: string, options: ListOptions = {}, summarize = summarizeClaudeFile): Promise<ExternalSession[]> {
  const limit = options.limit ?? 50;
  const files: Array<{ file: string; mtime: number }> = [];
  for (const dir of await claudeProjectDirs(configDir, workspace)) {
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      try {
        const st = await fs.stat(file);
        if (st.isFile() && st.size > 0) files.push({ file, mtime: st.mtimeMs });
      } catch {
        // vanished
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const out: ExternalSession[] = [];
  for (const { file } of files) {
    if (out.length >= limit) break;
    try {
      const item = await summarize(file, workspace);
      if (item) out.push(item);
    } catch {
      // unreadable file: skip
    }
  }
  return out;
}

function assistantText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const raw of content) {
    const b = asRecord(raw);
    if (!b) continue;
    if (b.type === 'text' && asString(b.text)) parts.push(asString(b.text) as string);
    else if (b.type === 'tool_use') parts.push(toolLine(asString(b.name) ?? 'tool', b.input));
    // thinking and redacted_thinking are dropped
  }
  return parts.join('\n');
}

function toolResultText(block: Record<string, unknown>): string {
  const content = block.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => {
      const r = asRecord(c);
      if (r?.type === 'text') return asString(r.text) ?? '';
      if (r?.type === 'image') return '[image]';
      return '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

/** The whole chat as plain text turns (streamed; safe on very large files). */
export async function readClaudeTranscript(file: string): Promise<ExternalTranscript> {
  const builder = new TurnBuilder();
  const title = { rank: 0, title: '' };
  let firstPrompt = '';
  let skippedLines = 0;
  await scanLines(file, (line) => {
    if (line === undefined) {
      skippedLines++;
      return;
    }
    const l = classify(line);
    if (l.kind === 'title') {
      pickTitle([l], title);
      return;
    }
    const o = l.record;
    if (!o) return;
    const at = timeOf(o.timestamp);
    const content = asRecord(o.message)?.content;
    if (l.kind === 'assistant') {
      builder.add('assistant', assistantText(content), at);
      return;
    }
    if (Array.isArray(content)) {
      for (const raw of content) {
        const b = asRecord(raw);
        if (b?.type === 'tool_result') builder.add('assistant', toolResultLine(toolResultText(b)), at);
      }
    }
    if (l.userText) {
      if (!firstPrompt) firstPrompt = l.userText;
      builder.add('user', l.userText, at);
    }
  });
  const { turns, omitted } = builder.finish();
  return {
    source: 'claude-code',
    id: path.basename(file, '.jsonl'),
    title: oneLineTitle(title.title || firstPrompt || path.basename(file, '.jsonl')),
    turns,
    omitted,
    skippedLines,
  };
}
