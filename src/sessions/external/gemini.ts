/**
 * Gemini CLI chats: `<GEMINI home>/tmp/<project>/chats/session-<time>-<id>.json`. Older versions name
 * the project folder with the SHA-256 of the project root; newer ones use a short name that
 * `<GEMINI home>/projects.json` maps to the root and that holds a `.project_root` file. Every chat
 * also records its `projectHash`. Messages are `user` and `gemini` records. Read-only.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { asRecord, asString, oneLineTitle, sameDir, timeOf, TurnBuilder } from './lines';
import type { ExternalSession, ExternalTranscript, ListOptions } from './types';

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const SMALL_FILE_BYTES = 64 * 1024;
/** Injected file contents follow this marker in a prompt that used `@path`. */
const REFERENCED_FILES = /\n?\s*--- Content from referenced files ---[\s\S]*$/;

type Json = Record<string, unknown>;

export function geminiHome(home: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = env.GEMINI_CLI_HOME?.trim() || home;
  return path.join(base, '.gemini');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The hashes a folder may have been recorded under: path spelling differs by platform and shell. */
export function geminiProjectHashes(workspace: string): Set<string> {
  const trimmed = workspace.replace(/[\\/]+$/, '') || workspace;
  const forms = new Set<string>([workspace, trimmed, trimmed.replace(/\\/g, '/'), trimmed.replace(/\//g, '\\')]);
  for (const form of [...forms]) {
    forms.add(form.toLowerCase());
    if (/^[A-Za-z]:/.test(form)) forms.add(form[0].toUpperCase() + form.slice(1));
  }
  return new Set([...forms].map(sha256));
}

async function readSmall(file: string): Promise<string | undefined> {
  try {
    const st = await fs.stat(file);
    if (!st.isFile() || st.size > SMALL_FILE_BYTES) return undefined;
    return await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Folders under `<gemini>/tmp` that belong to `workspace`. */
export async function geminiProjectDirs(geminiDir: string, workspace: string): Promise<string[]> {
  const root = path.join(geminiDir, 'tmp');
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return [];
  }
  const hashes = geminiProjectHashes(workspace);
  const slugs = new Set<string>();
  const registry = await readSmall(path.join(geminiDir, 'projects.json'));
  if (registry) {
    try {
      const projects = asRecord(asRecord(JSON.parse(registry))?.projects);
      for (const [dir, slug] of Object.entries(projects ?? {})) {
        if (typeof slug === 'string' && sameDir(dir, workspace)) slugs.add(slug);
      }
    } catch {
      // ignore a broken registry
    }
  }
  const out: string[] = [];
  for (const name of names) {
    const dir = path.join(root, name);
    let match = hashes.has(name.toLowerCase()) || slugs.has(name);
    if (!match) {
      const marker = await readSmall(path.join(dir, '.project_root'));
      match = marker !== undefined && sameDir(marker.trim(), workspace);
    }
    if (match) out.push(dir);
  }
  return out;
}

/** A prompt as plain text: a string, or an array of `{ text }` parts. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : asString(asRecord(p)?.text) ?? '')).filter(Boolean).join('\n');
  return asString(asRecord(content)?.text) ?? '';
}

interface GeminiRecord {
  sessionId?: string;
  summary?: string;
  messages: Json[];
}

/** A chat file: one JSON document, or (newer versions) one JSON record per line. */
export async function readGeminiRecord(file: string): Promise<GeminiRecord | undefined> {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FILE_BYTES) return undefined;
  const text = await fs.readFile(file, 'utf8');
  try {
    const doc = asRecord(JSON.parse(text));
    if (doc && Array.isArray(doc.messages)) {
      return { sessionId: asString(doc.sessionId), summary: asString(doc.summary), messages: doc.messages.map(asRecord).filter((m): m is Json => !!m) };
    }
  } catch {
    // not a single document: try line by line
  }
  const byId = new Map<string, Json>();
  const order: Json[] = [];
  let sessionId: string | undefined;
  let summary: string | undefined;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o: Json | undefined;
    try {
      o = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (!o) continue;
    const type = asString(o.type);
    if (type === 'user' || type === 'gemini') {
      const id = asString(o.id);
      const known = id ? byId.get(id) : undefined;
      if (known) Object.assign(known, o);
      else {
        order.push(o);
        if (id) byId.set(id, o);
      }
    } else {
      sessionId ??= asString(o.sessionId);
      summary = asString(o.summary) ?? summary;
    }
  }
  return order.length ? { sessionId, summary, messages: order } : undefined;
}

function parseGemini(record: GeminiRecord, fallbackId: string): { title: string; turns: ExternalTranscript['turns']; omitted: number } {
  const builder = new TurnBuilder();
  let firstPrompt = '';
  for (const m of record.messages) {
    const type = asString(m.type);
    if (type !== 'user' && type !== 'gemini') continue; // info, error, warning
    let text = contentText(m.content);
    if (type === 'user') {
      text = text.replace(REFERENCED_FILES, '');
      if (text.trim() && !firstPrompt) firstPrompt = text.trim();
    }
    builder.add(type === 'user' ? 'user' : 'assistant', text, timeOf(m.timestamp));
  }
  const { turns, omitted } = builder.finish();
  return { title: oneLineTitle(record.summary?.trim() || firstPrompt || fallbackId), turns, omitted };
}

function idOf(file: string): string {
  return path.basename(file).replace(/\.jsonl?$/, '');
}

export async function summarizeGeminiFile(file: string): Promise<ExternalSession | undefined> {
  const stat = await fs.stat(file);
  const record = await readGeminiRecord(file);
  if (!record) return undefined;
  const id = idOf(file);
  const parsed = parseGemini(record, id);
  if (!parsed.turns.some((t) => t.role === 'user')) return undefined;
  return { source: 'gemini-cli', id, title: parsed.title, updatedAt: stat.mtimeMs, messageCount: parsed.turns.length + parsed.omitted, filePath: file };
}

export async function readGeminiTranscript(file: string): Promise<ExternalTranscript> {
  const id = idOf(file);
  const record = await readGeminiRecord(file);
  const parsed = record ? parseGemini(record, id) : { title: id, turns: [], omitted: 0 };
  return { source: 'gemini-cli', id, title: parsed.title, turns: parsed.turns, omitted: parsed.omitted, skippedLines: 0 };
}

export async function listGeminiSessions(geminiDir: string, workspace: string, options: ListOptions = {}, summarize: (file: string) => Promise<ExternalSession | undefined> = summarizeGeminiFile): Promise<ExternalSession[]> {
  const limit = options.limit ?? 50;
  const files: Array<{ file: string; mtime: number }> = [];
  for (const project of await geminiProjectDirs(geminiDir, workspace)) {
    const dir = path.join(project, 'chats');
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
  files.sort((a, b) => b.mtime - a.mtime);
  const out: ExternalSession[] = [];
  for (const { file } of files) {
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
