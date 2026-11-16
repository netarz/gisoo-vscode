/**
 * Helpers for reading JSONL transcripts that can be hundreds of megabytes: the head and the tail
 * are read with positioned reads, and full passes stream line by line. Nothing here reads a whole
 * file into memory.
 */
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as readline from 'node:readline';
import type { ExternalTurn } from './types';

/** Lines longer than this are never JSON-parsed (huge tool outputs, embedded images). */
export const MAX_LINE_CHARS = 1_000_000;
/** Text kept from one tool result. */
export const TOOL_RESULT_MAX = 1_500;
/** Text kept from one message. */
export const TURN_TEXT_MAX = 12_000;
/** Total characters an import carries into Gisoo; older turns beyond it are left out. */
export const IMPORT_MAX_CHARS = 160_000;
/** Files up to this size are fully read during listing to count their messages. */
export const COUNT_MAX_BYTES = 4 * 1024 * 1024;

/** Complete lines from the first `bytes` of a file (a trailing partial line is dropped). */
export async function headLines(file: string, bytes: number): Promise<string[]> {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const lines = text.split('\n');
    if (bytesRead === bytes) lines.pop();
    return lines.filter((l) => l.trim());
  } finally {
    await handle.close();
  }
}

/** Complete lines from the last `bytes` of a file (a leading partial line is dropped). */
export async function tailLines(file: string, bytes: number, size?: number): Promise<string[]> {
  const handle = await fs.open(file, 'r');
  try {
    const total = size ?? (await handle.stat()).size;
    const start = Math.max(0, total - bytes);
    const length = total - start;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.filter((l) => l.trim());
  } finally {
    await handle.close();
  }
}

/**
 * Streams the file line by line. `onLine` returns true to stop early. `maxBytes` stops reading
 * after that many bytes. Lines over MAX_LINE_CHARS are passed as `undefined` (counted, not parsed).
 */
export async function scanLines(file: string, onLine: (line: string | undefined) => boolean | void, maxBytes?: number): Promise<void> {
  const stream = createReadStream(file, { encoding: 'utf8', end: maxBytes ? maxBytes - 1 : undefined, highWaterMark: 256 * 1024 });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      if (onLine(line.length > MAX_LINE_CHARS ? undefined : line)) break;
    }
  } finally {
    reader.close();
    stream.destroy();
  }
}

export function parseJson(line: string | undefined): Record<string, unknown> | undefined {
  if (!line || line.length > MAX_LINE_CHARS) return undefined;
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Folder paths compared the way the OS does: slashes unified, trailing slash dropped, case folded on Windows and macOS. */
export function normalizeDir(p: string, platform: NodeJS.Platform = process.platform): string {
  let out = p.trim().replace(/\\/g, '/');
  if (/^\/\/\?\//.test(out)) out = out.slice(4);
  out = out.replace(/\/+$/, '');
  if (/^[A-Za-z]:$/.test(out)) out += '/';
  return platform === 'linux' ? out : out.toLowerCase();
}

export function sameDir(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return normalizeDir(a, platform) === normalizeDir(b, platform);
}

export function timeOf(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const t = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(t) ? t : undefined;
}

export function clip(text: string, max: number, note: (kb: number) => string = (kb) => `[... shortened, ${kb} KB in total]`): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n${note(Math.max(1, Math.round(text.length / 1024)))}`;
}

/** One line title from free text. */
export function oneLineTitle(text: string, max = 80): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 3).trimEnd()}...` : line;
}

/** A short readable line for a tool call: `[used tool Read: src/app.ts]`. */
export function toolLine(name: string, input: unknown): string {
  let args: Record<string, unknown> | undefined = asRecord(input);
  if (!args && typeof input === 'string') {
    try {
      args = asRecord(JSON.parse(input));
    } catch {
      args = undefined;
    }
    if (!args && input.trim()) return `[used tool ${name}: ${oneLineTitle(input, 160)}]`;
  }
  let detail = '';
  if (args) {
    for (const key of ['file_path', 'path', 'notebook_path', 'command', 'cmd', 'pattern', 'url', 'query', 'description', 'prompt', 'skill']) {
      const value = args[key];
      if (typeof value === 'string' && value.trim()) {
        detail = value;
        break;
      }
      if (Array.isArray(value) && value.every((v) => typeof v === 'string') && value.length) {
        detail = value.join(' ');
        break;
      }
    }
  }
  return detail ? `[used tool ${name}: ${oneLineTitle(detail, 160)}]` : `[used tool ${name}]`;
}

export function toolResultLine(text: string): string {
  const body = text.trim();
  if (!body) return '[tool result: empty]';
  return `[tool result]\n${clip(body, TOOL_RESULT_MAX, (kb) => `[... result shortened, ${kb} KB in total]`)}`;
}

/** Collects turns, merging consecutive pieces of the same role. */
export class TurnBuilder {
  readonly turns: ExternalTurn[] = [];

  add(role: 'user' | 'assistant', text: string, at?: number): void {
    const clean = text.trim();
    if (!clean) return;
    const last = this.turns[this.turns.length - 1];
    if (last && last.role === role) {
      last.text = `${last.text}\n\n${clean}`;
      return;
    }
    this.turns.push({ role, text: clean, at });
  }

  /** Clips each turn and keeps the newest turns within IMPORT_MAX_CHARS. */
  finish(maxChars = IMPORT_MAX_CHARS): { turns: ExternalTurn[]; omitted: number } {
    const clipped = this.turns.map((t) => ({ ...t, text: clip(t.text, TURN_TEXT_MAX) }));
    let total = 0;
    let start = clipped.length;
    while (start > 0 && total + clipped[start - 1].text.length <= maxChars) {
      total += clipped[start - 1].text.length;
      start--;
    }
    // Always keep at least the last turn; start on a user turn when we can.
    if (start === clipped.length && clipped.length) start = clipped.length - 1;
    while (start > 0 && start < clipped.length - 1 && clipped[start].role !== 'user') start++;
    return { turns: clipped.slice(start), omitted: start };
  }
}
