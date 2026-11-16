/**
 * GitHub Copilot Chat in VS Code: `<user data>/User/workspaceStorage/<hash>/chatSessions/<id>.json`
 * (older) or `.jsonl` (newer, a log of patches applied to a session object). The folder a hash belongs
 * to is in `<hash>/workspace.json`. Only local folders match: chats of a remote window are stored on
 * the machine that runs the window, with a `vscode-remote:` folder. Read-only.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { asRecord, asString, oneLineTitle, sameDir, timeOf, TurnBuilder } from './lines';
import type { ExternalSession, ExternalTranscript, ListOptions } from './types';
import { workspaceFolder } from './vscodeData';

/** Larger session files are not read at all. */
const MAX_FILE_BYTES = 24 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

type Json = Record<string, unknown>;

function child(node: unknown, key: string | number): unknown {
  if (Array.isArray(node) && typeof key === 'number') return node[key];
  if (node && typeof node === 'object' && !Array.isArray(node) && typeof key === 'string' && !FORBIDDEN_KEYS.has(key)) return (node as Json)[key];
  return undefined;
}

function assign(parent: unknown, key: string | number, value: unknown): void {
  if (Array.isArray(parent) && typeof key === 'number') parent[key] = value;
  else if (parent && typeof parent === 'object' && !Array.isArray(parent) && typeof key === 'string') (parent as Json)[key] = value;
}

/** Applies one patch of the `.jsonl` log: 0 snapshot, 1 set, 2 push, 3 delete. */
function applyPatch(state: Json | undefined, patch: Json): Json | undefined {
  const kind = patch.kind;
  if (kind === 0) return asRecord(patch.v) ?? state;
  const keys = patch.k;
  if (!state || !Array.isArray(keys) || !keys.length) return state;
  if (!keys.every((k) => (typeof k === 'string' && !FORBIDDEN_KEYS.has(k)) || (typeof k === 'number' && Number.isInteger(k) && k >= 0))) return state;
  // The rendered prompt and result of every request are large and never read.
  if (keys[0] === 'requests' && keys[2] === 'result') return state;
  let parent: unknown = state;
  for (const key of keys.slice(0, -1)) {
    parent = child(parent, key as string | number);
    if (!parent || typeof parent !== 'object') return state;
  }
  const last = keys[keys.length - 1] as string | number;
  if (kind === 1) {
    assign(parent, last, patch.v);
  } else if (kind === 2) {
    let target = child(parent, last);
    if (!Array.isArray(target)) {
      target = [];
      assign(parent, last, target);
    }
    const list = target as unknown[];
    if (typeof patch.i === 'number' && patch.i >= 0) list.length = Math.min(list.length, patch.i);
    if (Array.isArray(patch.v)) list.push(...(patch.v as unknown[]));
  } else if (kind === 3) {
    if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1);
    else if (parent && !Array.isArray(parent) && typeof last === 'string') delete (parent as Json)[last];
  }
  return state;
}

/** The session object stored in a chat file, or undefined when the file is unreadable. */
export async function readCopilotState(file: string): Promise<Json | undefined> {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FILE_BYTES) return undefined;
  const text = await fs.readFile(file, 'utf8');
  if (file.endsWith('.jsonl')) {
    let state: Json | undefined;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const patch = asRecord(JSON.parse(line));
        if (patch) state = applyPatch(state, patch);
      } catch {
        // a torn or foreign line: ignore
      }
    }
    return state;
  }
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function inlineName(item: Json): string {
  const ref = asRecord(item.inlineReference) ?? item;
  const name = asString(ref.name);
  if (name) return name;
  const p = asString(ref.fsPath) ?? asString(ref.path);
  return p ? path.basename(p) : '';
}

/** Markdown of one response; thinking, tool calls and edit groups are left out. */
function responseText(response: unknown): string {
  if (!Array.isArray(response)) return '';
  let out = '';
  let gap = false;
  for (const raw of response) {
    const item = asRecord(raw);
    if (!item) continue;
    const kind = asString(item.kind);
    let piece: string | undefined;
    if (!kind || kind === 'markdownContent') {
      piece = asString(item.value) ?? asString(asRecord(item.content)?.value);
    } else if (kind === 'inlineReference') {
      const name = inlineName(item);
      piece = name ? `\`${name}\`` : undefined;
    } else if (kind === 'codeblockUri' || kind === 'undoStop' || kind === 'mcpServersStarting') {
      continue;
    } else {
      gap = true; // tool call, thinking, edits: a paragraph break in the text around it
      continue;
    }
    if (!piece) continue;
    if (gap && out) out += '\n\n';
    gap = false;
    out += piece;
  }
  return out;
}

export interface CopilotParsed {
  title: string;
  turns: ExternalTranscript['turns'];
  omitted: number;
}

export function parseCopilotState(state: Json, fallbackId: string): CopilotParsed {
  const builder = new TurnBuilder();
  const requests = Array.isArray(state.requests) ? state.requests : [];
  let firstPrompt = '';
  for (const raw of requests) {
    const request = asRecord(raw);
    if (!request) continue;
    const prompt = (asString(asRecord(request.message)?.text) ?? '').trim();
    const at = timeOf(request.timestamp);
    if (prompt) {
      if (!firstPrompt) firstPrompt = prompt;
      builder.add('user', prompt, at);
    }
    const reply = responseText(request.response).trim();
    if (reply) builder.add('assistant', reply, timeOf(asRecord(request.modelState)?.completedAt) ?? at);
  }
  const { turns, omitted } = builder.finish();
  const custom = asString(state.customTitle)?.trim();
  return { title: oneLineTitle(custom || firstPrompt || fallbackId), turns, omitted };
}

function idOf(file: string): string {
  return path.basename(file).replace(/\.jsonl?$/, '');
}

export async function summarizeCopilotFile(file: string): Promise<ExternalSession | undefined> {
  const stat = await fs.stat(file);
  const state = await readCopilotState(file);
  if (!state) return undefined;
  const id = idOf(file);
  const parsed = parseCopilotState(state, id);
  if (!parsed.turns.some((t) => t.role === 'user')) return undefined;
  return { source: 'copilot', id, title: parsed.title, updatedAt: stat.mtimeMs, messageCount: parsed.turns.length + parsed.omitted, filePath: file };
}

export async function readCopilotTranscript(file: string): Promise<ExternalTranscript> {
  const id = idOf(file);
  const state = await readCopilotState(file);
  const parsed = state ? parseCopilotState(state, id) : { title: id, turns: [], omitted: 0 };
  return { source: 'copilot', id, title: parsed.title, turns: parsed.turns, omitted: parsed.omitted, skippedLines: 0 };
}

/** Chat files of every workspaceStorage entry that belongs to `workspace`, newest first. */
export async function copilotChatFiles(userDirs: string[], workspace: string): Promise<Array<{ file: string; mtime: number }>> {
  const files: Array<{ file: string; mtime: number }> = [];
  for (const userDir of userDirs) {
    const storage = path.join(userDir, 'workspaceStorage');
    let hashes: string[];
    try {
      hashes = await fs.readdir(storage);
    } catch {
      continue;
    }
    for (const hash of hashes) {
      const hashDir = path.join(storage, hash);
      const folder = await workspaceFolder(hashDir);
      if (!folder || !sameDir(folder, workspace)) continue;
      const dir = path.join(hashDir, 'chatSessions');
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!/\.jsonl?$/.test(name)) continue;
        const file = path.join(dir, name);
        try {
          const st = await fs.stat(file);
          if (st.isFile() && st.size > 0) files.push({ file, mtime: st.mtimeMs });
        } catch {
          // vanished
        }
      }
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime);
}

export async function listCopilotSessions(userDirs: string[], workspace: string, options: ListOptions = {}, summarize: (file: string) => Promise<ExternalSession | undefined> = summarizeCopilotFile): Promise<ExternalSession[]> {
  const limit = options.limit ?? 50;
  const out: ExternalSession[] = [];
  for (const { file } of await copilotChatFiles(userDirs, workspace)) {
    if (out.length >= limit) break;
    try {
      const item = await summarize(file);
      if (item) out.push(item);
    } catch {
      // unreadable file: skip
    }
  }
  return out;
}
