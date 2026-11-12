/**
 * Gisoo memory (SPEC-phase2 §2): `~/.gisoo/projects/<slug>/memory/MEMORY.md` (index) plus one
 * markdown file per fact with frontmatter name / description / type. Same shape as Claude Code's
 * auto-memory. Pure Node so the name guard, path guard and secret refusal can be unit-tested.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { estimateTextTokens } from '../agent/context';
import type { Tool, ToolResult } from '../tools/types';
import { parseFrontmatter } from '../agents/definitions';

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';
export type MemorySource = 'gisoo' | 'project' | 'claude';

export const MEMORY_NAME = /^[a-z0-9-]{1,64}\.md$/;
export const MEMORY_INDEX = 'MEMORY.md';
export const MEMORY_INDEX_MAX_LINES = 200;
export const MEMORY_FILE_MAX_CHARS = 20_000;
export const MEMORY_TYPES: readonly MemoryType[] = ['user', 'feedback', 'project', 'reference'];

export class MemoryError extends Error {
  constructor(message: string, readonly reason: 'name' | 'outside' | 'secret' | 'readonly' | 'missing' | 'empty') {
    super(message);
    this.name = 'MemoryError';
  }
}

/** Claude Code's rule: every character that is not a letter or digit becomes `-`. */
export function memorySlug(folder: string): string {
  return folder.replace(/[^A-Za-z0-9]/g, '-');
}

export function memoryDir(homeDir: string, folder: string): string {
  return path.join(homeDir, '.gisoo', 'projects', memorySlug(folder), 'memory');
}

export function projectMemoryDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.gisoo', 'memory');
}

/** Turns free text into a valid memory file name (lowercase, dashes), or undefined. */
export function toMemoryName(text: string): string | undefined {
  const base = text
    .toLowerCase()
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return base ? `${base}.md` : undefined;
}

// -- Secret refusal ---------------------------------------------------------------------------------

const SECRET_RULES: ReadonlyArray<{ reason: string; test: (text: string) => boolean }> = [
  { reason: 'an API key', test: (t) => /\bsk-[A-Za-z0-9_-]{12,}/.test(t) },
  { reason: 'an API key', test: (t) => /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/.test(t) || /\bgithub_pat_[A-Za-z0-9_]{20,}/.test(t) },
  { reason: 'an API key', test: (t) => /\bAKIA[0-9A-Z]{16}\b/.test(t) },
  { reason: 'an API key', test: (t) => /\bxox[baprs]-[A-Za-z0-9-]{10,}/.test(t) },
  { reason: 'an API key', test: (t) => /\bAIza[0-9A-Za-z_-]{30,}/.test(t) },
  { reason: 'a bearer token', test: (t) => /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(t) },
  { reason: 'a JWT', test: (t) => /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(t) },
  { reason: 'a private key', test: (t) => /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----/.test(t) },
  { reason: 'a password', test: (t) => /\b(password|passwd|pwd|passphrase)\s*(is|[:=])\s*["']?[^\s"']{4,}/i.test(t) },
  {
    reason: 'a token or secret',
    test: (t) => /\b(api[_-]?key|secret(_key)?|access[_-]?token|auth[_-]?token|client[_-]?secret|token)\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{16,}/i.test(t),
  },
  { reason: 'a card number', test: hasCardNumber },
];

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function hasCardNumber(text: string): boolean {
  const re = /(?<![\d-])(?:\d[ -]?){13,19}(?![\d-])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const digits = m[0].replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && !/^(\d)\1+$/.test(digits) && luhn(digits)) return true;
  }
  return false;
}

/** Returns what the text looks like ("an API key", "a password"...) or undefined when it is fine. */
export function looksLikeSecret(text: string): string | undefined {
  for (const rule of SECRET_RULES) if (rule.test(text)) return rule.reason;
  return undefined;
}

// -- Files ------------------------------------------------------------------------------------------

export interface MemoryEntry {
  name: string;
  description: string;
  type: MemoryType;
  body: string;
}

export function parseMemoryType(value: string | undefined): MemoryType {
  const v = (value ?? '').trim().toLowerCase();
  return (MEMORY_TYPES as readonly string[]).includes(v) ? (v as MemoryType) : 'project';
}

export function formatMemoryFile(entry: MemoryEntry): string {
  const slug = entry.name.replace(/\.md$/, '');
  const description = entry.description.replace(/\s+/g, ' ').trim();
  return ['---', `name: ${slug}`, `description: ${description}`, 'metadata:', `  type: ${entry.type}`, '---', '', entry.body.trim(), ''].join('\n');
}

export function parseMemoryFile(name: string, text: string): MemoryEntry {
  const { data, body } = parseFrontmatter(text);
  const description = (data.description || firstLine(body)).replace(/\s+/g, ' ').trim().slice(0, 300);
  return { name, description, type: parseMemoryType(data.type), body };
}

function firstLine(text: string): string {
  return text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) ?? '';
}

export function indexLine(entry: MemoryEntry): string {
  const title = entry.name.replace(/\.md$/, '');
  return `- [${title}](${entry.name})${entry.description ? ` — ${entry.description}` : ''}`;
}

/** Keeps the first `max` lines of MEMORY.md and marks the cut. */
export function capIndex(text: string, max = MEMORY_INDEX_MAX_LINES): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length <= max) return text;
  return `${lines.slice(0, max).join('\n')}\n[${lines.length - max} more lines not shown]`;
}

// -- Store ------------------------------------------------------------------------------------------

export interface MemoryStoreOptions {
  dir: string;
  source: MemorySource;
  /** "Gisoo memory", "Project memory", "Claude memory". */
  label: string;
  writable: boolean;
}

/** One memory folder. Every path is checked to stay inside `dir`; names must match MEMORY_NAME. */
export class MemoryStore {
  readonly dir: string;
  readonly source: MemorySource;
  readonly label: string;
  readonly writable: boolean;

  constructor(opts: MemoryStoreOptions) {
    this.dir = path.resolve(opts.dir);
    this.source = opts.source;
    this.label = opts.label;
    this.writable = opts.writable;
  }

  get indexPath(): string {
    return path.join(this.dir, MEMORY_INDEX);
  }

  /** Validates a memory file name and returns its absolute path inside the folder. */
  resolve(name: string): string {
    const clean = (name ?? '').trim();
    if (!clean) throw new MemoryError('A memory name is required.', 'empty');
    const withExt = /\.md$/i.test(clean) ? clean : `${clean}.md`;
    if (!MEMORY_NAME.test(withExt)) throw new MemoryError(`Invalid memory name "${clean}": use lowercase letters, digits and dashes (max 64) with a .md extension.`, 'name');
    const abs = path.resolve(this.dir, withExt);
    const rel = path.relative(this.dir, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) throw new MemoryError('Refused: the path leaves the memory folder.', 'outside');
    return abs;
  }

  async exists(): Promise<boolean> {
    try {
      return (await fs.stat(this.dir)).isDirectory();
    } catch {
      return false;
    }
  }

  async readIndex(maxLines = MEMORY_INDEX_MAX_LINES): Promise<string> {
    const text = await readOrNull(this.indexPath);
    return text === null ? '' : capIndex(text, maxLines);
  }

  async indexMtime(): Promise<number> {
    try {
      return (await fs.stat(this.indexPath)).mtimeMs;
    } catch {
      return 0;
    }
  }

  async list(): Promise<string[]> {
    try {
      const names = await fs.readdir(this.dir);
      return names.filter((n) => MEMORY_NAME.test(n)).sort();
    } catch {
      return [];
    }
  }

  async view(name?: string): Promise<string> {
    if (!name || name.trim().toUpperCase() === MEMORY_INDEX) {
      const index = await this.readIndex();
      return index.trim() ? index : `(${this.label} is empty)`;
    }
    const abs = this.resolve(name);
    const text = await readOrNull(abs);
    if (text === null) throw new MemoryError(`No memory named "${path.basename(abs)}" in ${this.label}.`, 'missing');
    return text.slice(0, MEMORY_FILE_MAX_CHARS);
  }

  /** Creates or replaces one memory file and keeps its index line in MEMORY.md. */
  async write(name: string, content: string, meta: { description?: string; type?: MemoryType } = {}): Promise<{ path: string; entry: MemoryEntry }> {
    if (!this.writable) throw new MemoryError(`${this.label} is read-only.`, 'readonly');
    const abs = this.resolve(name);
    const body = (content ?? '').replace(/\r\n?/g, '\n').trim();
    if (!body) throw new MemoryError('The memory content is empty.', 'empty');
    const secret = looksLikeSecret(`${body}\n${meta.description ?? ''}`);
    if (secret) throw new MemoryError(`Refused: the text looks like it contains ${secret}. Secrets are never stored in memory.`, 'secret');
    const fileName = path.basename(abs);
    const parsed = parseFrontmatter(body);
    const hasFrontmatter = body.startsWith('---') && Object.keys(parsed.data).length > 0;
    const entry: MemoryEntry = {
      name: fileName,
      description: (meta.description ?? (hasFrontmatter ? parsed.data.description : '') ?? '').replace(/\s+/g, ' ').trim() || firstLine(parsed.body).slice(0, 120),
      type: meta.type ?? parseMemoryType(hasFrontmatter ? parsed.data.type : undefined),
      body: hasFrontmatter ? parsed.body : body,
    };
    const text = formatMemoryFile(entry).slice(0, MEMORY_FILE_MAX_CHARS);
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(abs, text, 'utf8');
    await this.updateIndex(entry);
    return { path: abs, entry };
  }

  async delete(name: string): Promise<string> {
    if (!this.writable) throw new MemoryError(`${this.label} is read-only.`, 'readonly');
    const abs = this.resolve(name);
    try {
      await fs.unlink(abs);
    } catch {
      throw new MemoryError(`No memory named "${path.basename(abs)}" in ${this.label}.`, 'missing');
    }
    await this.removeIndexLine(path.basename(abs));
    return abs;
  }

  /** Adds or replaces the `- [title](name.md) — description` line for an entry. */
  async updateIndex(entry: MemoryEntry): Promise<void> {
    const current = (await readOrNull(this.indexPath)) ?? `# Memory\n\n`;
    const lines = current.replace(/\r\n?/g, '\n').split('\n');
    const line = indexLine(entry);
    const at = lines.findIndex((l) => indexLineNames(l) === entry.name);
    if (at >= 0) lines[at] = line;
    else {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      lines.push(line, '');
    }
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.indexPath, lines.join('\n'), 'utf8');
  }

  async removeIndexLine(fileName: string): Promise<void> {
    const current = await readOrNull(this.indexPath);
    if (current === null) return;
    const lines = current.replace(/\r\n?/g, '\n').split('\n').filter((l) => indexLineNames(l) !== fileName);
    await fs.writeFile(this.indexPath, lines.join('\n'), 'utf8');
  }

  /** Writes MEMORY.md if it does not exist yet (so `/memory` can open it). */
  async ensureIndex(): Promise<string> {
    if (!this.writable) return this.indexPath;
    await fs.mkdir(this.dir, { recursive: true });
    if ((await readOrNull(this.indexPath)) === null) await fs.writeFile(this.indexPath, '# Memory\n\n', 'utf8');
    return this.indexPath;
  }
}

/** The file name an index line points at, e.g. "- [x](x.md) — hook" → "x.md". */
export function indexLineNames(line: string): string | undefined {
  const m = /^\s*[-*]\s*\[[^\]]*\]\(([^)\s]+)\)/.exec(line);
  return m ? path.basename(m[1]) : undefined;
}

async function readOrNull(abs: string): Promise<string | null> {
  try {
    const st = await fs.lstat(abs);
    if (!st.isFile()) return null;
    return await fs.readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

// -- Quick memory (`#text`) -------------------------------------------------------------------------

export interface QuickMemory {
  name: string;
  body: string;
  description: string;
  type: MemoryType;
}

/** `#text` at the start of a message: the first words become the file name, the text the body. */
export function quickMemoryFrom(text: string, now = new Date()): QuickMemory | undefined {
  const body = text.replace(/^#+\s*/, '').trim();
  if (!body) return undefined;
  const words = body.split(/\s+/).slice(0, 6).join(' ');
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  // eslint-disable-next-line no-control-regex -- ASCII-only check
  const name = toMemoryName(/^[\x00-\x7F]+$/.test(words) ? words : `note-${stamp}-${Math.floor(now.getTime() / 1000) % 100_000}`) ?? `note-${stamp}.md`;
  return { name, body, description: body.split('\n')[0].slice(0, 120), type: 'project' };
}

// -- Prompt section ---------------------------------------------------------------------------------

export interface MemoryPromptPart {
  store: MemoryStore;
  index: string;
}

export function memoryPromptSection(parts: readonly MemoryPromptPart[]): string {
  const filled = parts.filter((p) => p.index.trim());
  if (!filled.length) return '';
  const out = [
    '## Memory',
    'Notes you saved in earlier sessions. Use the memory tool to read one file (view), to save a durable fact about the user, the project or feedback you received (write), or to remove an outdated one (delete).',
    'Never store secrets, keys, passwords or card numbers. Claude memory is read-only.',
  ];
  for (const p of filled) out.push(`### ${p.store.label}\n${p.index.trim()}`);
  return out.join('\n\n');
}

export function memoryTokens(index: string): number {
  return estimateTextTokens(index);
}

// -- Tool -------------------------------------------------------------------------------------------

/** A type alias (not an interface) so it is assignable to the registry's `Record<string, unknown>` input. */
export type MemoryToolInput = {
  action: 'view' | 'write' | 'delete';
  name?: string;
  content?: string;
  description?: string;
  type?: MemoryType;
  source?: MemorySource;
};

export interface MemoryStores {
  gisoo: MemoryStore;
  project?: MemoryStore;
  claude?: MemoryStore;
}

export interface MemoryToolDeps {
  stores: () => MemoryStores;
  /** Called after a successful write or delete so the prompt section can be refreshed. */
  onChanged?: () => void;
}

export function createMemoryTool(deps: MemoryToolDeps): Tool<MemoryToolInput> {
  return {
    name: 'memory',
    description:
      'Read or update Gisoo memory for this workspace: durable notes across sessions (user preferences, feedback, project facts, references). ' +
      'action=view shows MEMORY.md (no name) or one memory file; write creates or replaces a file (name like "build-steps.md") and its index line; delete removes one. ' +
      'source selects gisoo (default, per-user), project (.gisoo/memory in the repo) or claude (Claude Code memory, read-only). Never store secrets.',
    permission: 'none',
    readOnly: false,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['view', 'write', 'delete'] },
        name: { type: 'string', description: 'File name: lowercase letters, digits, dashes, ".md" (omit for the index)' },
        content: { type: 'string', description: 'For write: the memory text (markdown body)' },
        description: { type: 'string', description: 'For write: one line used in the index' },
        type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] },
        source: { type: 'string', enum: ['gisoo', 'project', 'claude'] },
      },
      required: ['action'],
      additionalProperties: false,
    },
    title: (input) => {
      const where = input.source && input.source !== 'gisoo' ? ` (${input.source})` : '';
      if (input.action === 'write') return `Save memory ${input.name ?? ''}${where}`.trim();
      if (input.action === 'delete') return `Delete memory ${input.name ?? ''}${where}`.trim();
      return `View memory ${input.name ?? 'MEMORY.md'}${where}`;
    },
    async run(input): Promise<ToolResult> {
      const stores = deps.stores();
      const source = input.source ?? 'gisoo';
      const store = source === 'claude' ? stores.claude : source === 'project' ? stores.project : stores.gisoo;
      if (!store) return { content: `Memory source "${source}" is not available here.`, isError: true };
      try {
        switch (input.action) {
          case 'view':
            return { content: await store.view(input.name) };
          case 'write': {
            if (!input.name) return { content: 'write needs a name.', isError: true };
            const r = await store.write(input.name, input.content ?? '', { description: input.description, type: input.type });
            deps.onChanged?.();
            return { content: `Saved ${r.entry.name} in ${store.label}.`, display: r.path };
          }
          case 'delete': {
            if (!input.name) return { content: 'delete needs a name.', isError: true };
            const abs = await store.delete(input.name);
            deps.onChanged?.();
            return { content: `Deleted ${path.basename(abs)} from ${store.label}.`, display: abs };
          }
          default:
            return { content: `Unknown action "${String(input.action)}".`, isError: true };
        }
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), isError: true };
      }
    },
  };
}
