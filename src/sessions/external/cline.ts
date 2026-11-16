/**
 * Cline, Roo Code and Kilo Code (VS Code extensions that share one task format):
 * `<user data>/User/globalStorage/<extension>/tasks/<task id>/`. The conversation shown in the panel is
 * `ui_messages.json`; the model's own history, `api_conversation_history.json`, starts with the task and an
 * `<environment_details>` block that names the working directory ("# Current Working Directory (...) Files").
 * That line is the only place the folder is recorded, so a task without it is never listed. Read-only.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { asRecord, asString, oneLineTitle, sameDir, timeOf, TurnBuilder } from './lines';
import type { ExternalSession, ExternalSource, ExternalTranscript, ListOptions } from './types';

/** The part of `api_conversation_history.json` searched for the working directory. */
const CWD_HEAD_BYTES = 1024 * 1024;
const MAX_UI_BYTES = 48 * 1024 * 1024;
/** Newest tasks looked at per listing, so a huge history cannot make the panel slow. */
const MAX_EXAMINED = 300;

export type ClineSource = Extract<ExternalSource, 'cline' | 'roo-code' | 'kilo-code'>;

/** VS Code extension ids per tool. */
export const CLINE_EXTENSIONS: Record<ClineSource, string[]> = {
  cline: ['saoudrizwan.claude-dev'],
  'roo-code': ['rooveterinaryinc.roo-cline'],
  'kilo-code': ['kilocode.kilo-code'],
};

const UI_FILES = ['ui_messages.json', 'claude_messages.json'];
const CWD_PATTERN = /# Current Working Directory \(((?:[^)\\]|\\.|\)(?! Files))*)\) Files/;

function decode(raw: string): string {
  try {
    const value: unknown = JSON.parse(`"${raw}"`);
    return typeof value === 'string' ? value : raw;
  } catch {
    return raw;
  }
}

/** The working directory a task ran in, read from the start of its API history. */
export async function readClineCwd(taskDir: string): Promise<string | undefined> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(path.join(taskDir, 'api_conversation_history.json'), 'r');
  } catch {
    return undefined;
  }
  try {
    const buffer = Buffer.alloc(CWD_HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, CWD_HEAD_BYTES, 0);
    const match = CWD_PATTERN.exec(buffer.subarray(0, bytesRead).toString('utf8'));
    return match ? decode(match[1]).trim() || undefined : undefined;
  } finally {
    await handle.close();
  }
}

async function uiFileOf(taskDir: string): Promise<string | undefined> {
  for (const name of UI_FILES) {
    const file = path.join(taskDir, name);
    try {
      if ((await fs.stat(file)).isFile()) return file;
    } catch {
      // try the next name
    }
  }
  return undefined;
}

function stripTask(text: string): string {
  return text.replace(/^\s*<task>\s*/, '').replace(/\s*<\/task>\s*$/, '').trim();
}

function stripThinking(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
}

/** A follow-up question is plain text in Cline and JSON (`{ question, suggest }`) in Roo and Kilo. */
function followupText(text: string): string {
  try {
    const parsed = asRecord(JSON.parse(text));
    return asString(parsed?.question) ?? text;
  } catch {
    return text;
  }
}

export interface ClineParsed {
  title: string;
  turns: ExternalTranscript['turns'];
  omitted: number;
}

/** Turns the panel messages of a task into user and assistant text; tool calls, commands and API logs are dropped. */
export async function readClineMessages(uiFile: string): Promise<ClineParsed | undefined> {
  const stat = await fs.stat(uiFile);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_UI_BYTES) return undefined;
  let list: unknown;
  try {
    list = JSON.parse(await fs.readFile(uiFile, 'utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(list)) return undefined;
  const builder = new TurnBuilder();
  let firstPrompt = '';
  let sawTask = false;
  for (const raw of list) {
    const m = asRecord(raw);
    if (!m || m.partial === true) continue;
    const text = asString(m.text);
    if (!text?.trim()) continue;
    const at = timeOf(m.ts);
    if (m.type === 'say') {
      const say = asString(m.say);
      if ((say === 'text' && !sawTask) || say === 'task') {
        sawTask = true;
        const task = stripTask(text);
        if (task && !firstPrompt) firstPrompt = task;
        builder.add('user', task, at);
      } else if (say === 'user_feedback') {
        builder.add('user', text, at);
      } else if (say === 'text' || say === 'completion_result') {
        builder.add('assistant', stripThinking(text), at);
      }
    } else if (m.type === 'ask' && m.ask === 'followup') {
      builder.add('assistant', followupText(text), at);
    }
  }
  const { turns, omitted } = builder.finish();
  return { title: oneLineTitle(firstPrompt || 'Untitled task'), turns, omitted };
}

/** Summary of one task, or undefined when it did not run in `workspace` (or its folder is unknown). */
export async function summarizeClineFile(file: string, workspace: string, source: ClineSource): Promise<ExternalSession | undefined> {
  const taskDir = path.dirname(file);
  const cwd = await readClineCwd(taskDir);
  if (!cwd || !sameDir(cwd, workspace)) return undefined;
  const stat = await fs.stat(file);
  const parsed = await readClineMessages(file);
  if (!parsed || !parsed.turns.some((t) => t.role === 'user')) return undefined;
  return {
    source,
    id: path.basename(taskDir),
    title: parsed.title,
    updatedAt: stat.mtimeMs,
    messageCount: parsed.turns.length + parsed.omitted,
    filePath: file,
  };
}

export async function readClineTranscript(file: string, source: ClineSource): Promise<ExternalTranscript> {
  const id = path.basename(path.dirname(file));
  const parsed = await readClineMessages(file);
  return { source, id, title: parsed?.title ?? id, turns: parsed?.turns ?? [], omitted: parsed?.omitted ?? 0, skippedLines: 0 };
}

/** `tasks` folders to look in for one tool, given the VS Code user data folders and optional extra roots. */
export function clineTaskRoots(userDirs: string[], source: ClineSource, extraRoots: string[] = []): string[] {
  const roots = userDirs.flatMap((dir) => CLINE_EXTENSIONS[source].map((id) => path.join(dir, 'globalStorage', id, 'tasks')));
  return [...roots, ...extraRoots];
}

export async function listClineSessions(
  taskRoots: string[],
  workspace: string,
  source: ClineSource,
  options: ListOptions = {},
  summarize: (file: string, workspace: string, source: ClineSource) => Promise<ExternalSession | undefined> = summarizeClineFile,
): Promise<ExternalSession[]> {
  const limit = options.limit ?? 50;
  const files: Array<{ file: string; mtime: number }> = [];
  for (const root of taskRoots) {
    let names: string[];
    try {
      names = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const file = await uiFileOf(path.join(root, name));
      if (!file) continue;
      try {
        const st = await fs.stat(file);
        if (st.size > 0) files.push({ file, mtime: st.mtimeMs });
      } catch {
        // vanished
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const out: ExternalSession[] = [];
  for (const { file } of files.slice(0, MAX_EXAMINED)) {
    if (out.length >= limit) break;
    try {
      const item = await summarize(file, workspace, source);
      if (item) out.push(item);
    } catch {
      // unreadable task: skip
    }
  }
  return out;
}
