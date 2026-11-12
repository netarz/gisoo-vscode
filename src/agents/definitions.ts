/**
 * Agent definitions (SPEC-phase2 §8) in two formats. Markdown (Gisoo and Claude Code): frontmatter
 * `name`, `description`, `tools` (comma list), `model` (a Gisoo model id or `inherit`) and the system
 * prompt as the body. Codex TOML (`.codex/agents/*.toml`): top-level `name`, `description`,
 * `developer_instructions` (the prompt) and optional `model`; other keys are ignored. The TOML
 * reader is minimal on purpose: `key = "string"`, `'''` / `"""` multi-line strings and comments.
 * Pure Node (fs, path, os): unit-testable, no VS Code imports.
 *
 * Locations, later wins on a name clash: `~/.gisoo/agents`, `~/.claude/agents`, `~/.codex/agents`
 * (user), then `.gisoo/agents`, `.claude/agents`, `.codex/agents` in every workspace folder
 * (project). `.claude` folders are read only when `compatClaude` is on; project folders only when
 * the workspace is trusted.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface AgentDefinition {
  name: string;
  description: string;
  /** Tool names the agent may use; undefined = the default read-only set. */
  tools?: string[];
  /** A Gisoo model id; undefined = inherit the parent session's model. */
  model?: string;
  /** System prompt: the markdown body (may be empty). */
  prompt: string;
  /** Absolute path of the definition file. */
  path: string;
  scope: 'project' | 'user';
  source: 'gisoo' | 'claude' | 'codex';
}

export interface LoadAgentsOptions {
  workspaceRoots: readonly string[];
  /** Defaults to os.homedir(). */
  homeDir?: string;
  /** Read `.claude/agents` and `~/.claude/agents` too (setting gisoo.compat.claude). Default true. */
  compatClaude?: boolean;
  /** Untrusted workspace: project folders are skipped. Default true. */
  workspaceTrusted?: boolean;
}

export interface AgentDirectory {
  dir: string;
  scope: AgentDefinition['scope'];
  source: AgentDefinition['source'];
}

export const AGENT_NAME = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;
export const MAX_AGENT_FILE_CHARS = 40_000;
export const MAX_AGENT_DESCRIPTION_CHARS = 1_024;
export const MAX_AGENTS = 60;

/** Claude Code model aliases that have no Gisoo equivalent: they mean "inherit". */
const MODEL_ALIASES = new Set(['', 'inherit', 'default', 'sonnet', 'opus', 'haiku']);

export interface Frontmatter {
  data: Record<string, string>;
  body: string;
}

/**
 * Minimal YAML-ish frontmatter: `key: value` lines between two `---` lines at the top of the file.
 * Values may be quoted; a key with an empty value followed by `- item` lines becomes a comma list.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const normalised = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalised.split('\n');
  if (lines[0]?.trim() !== '---') return { data: {}, body: normalised };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end < 0) return { data: {}, body: normalised };

  const data: Record<string, string> = {};
  let currentKey: string | undefined;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s*(.+)$/.exec(line);
    if (item && currentKey !== undefined) {
      const value = unquote(item[1]);
      data[currentKey] = data[currentKey] ? `${data[currentKey]}, ${value}` : value;
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    currentKey = kv[1].toLowerCase();
    data[currentKey] = unquote(kv[2]);
  }
  return { data, body: lines.slice(end + 1).join('\n').trim() };
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1).trim();
  return v;
}

/** "a, b" or "[a, b]" or "a b" into a clean list of names. */
export function parseToolList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const inner = value.trim().replace(/^\[|\]$/g, '');
  const items = inner
    .split(/[\s,]+/)
    .map((s) => unquote(s))
    .filter(Boolean);
  return items.length ? [...new Set(items)] : undefined;
}

/** `inherit`, Claude aliases and empty values mean "use the parent's model". */
export function normaliseModel(value: string | undefined): string | undefined {
  const v = (value ?? '').trim();
  if (MODEL_ALIASES.has(v.toLowerCase())) return undefined;
  return v;
}

export function parseAgentDefinition(
  text: string,
  meta: { path: string; scope: AgentDefinition['scope']; source: AgentDefinition['source'] },
): AgentDefinition | undefined {
  const capped = text.length > MAX_AGENT_FILE_CHARS ? text.slice(0, MAX_AGENT_FILE_CHARS) : text;
  const { data, body } = parseFrontmatter(capped);
  const fallback = path.basename(meta.path).replace(/\.md$/i, '');
  const name = (data.name || fallback).trim();
  if (!AGENT_NAME.test(name)) return undefined;
  const description = (data.description || '').replace(/\s+/g, ' ').trim().slice(0, MAX_AGENT_DESCRIPTION_CHARS);
  return {
    name,
    description,
    tools: parseToolList(data.tools),
    model: normaliseModel(data.model),
    prompt: body,
    path: meta.path,
    scope: meta.scope,
    source: meta.source,
  };
}

/**
 * Minimal TOML reader for Codex agent files: top-level `key = "string"` / `key = 'string'`, the
 * multi-line forms `"""..."""` and `'''...'''`, `#` comments and blank lines. Tables, arrays,
 * numbers and booleans are ignored (their lines are skipped). No dependency.
 */
export function parseSimpleToml(text: string): Record<string, string> {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const out: Record<string, string> = {};
  let i = 0;
  let inTable = false;
  while (i < src.length) {
    const nl = src.indexOf('\n', i);
    const lineEnd = nl < 0 ? src.length : nl;
    const line = src.slice(i, lineEnd);
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      i = lineEnd + 1;
      continue;
    }
    if (trimmed.startsWith('[')) {
      inTable = true; // keys below a table header are not top-level
      i = lineEnd + 1;
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+|"[^"]+")\s*=\s*/.exec(line.trimStart());
    if (!kv) {
      i = lineEnd + 1;
      continue;
    }
    const key = kv[1].replace(/^"|"$/g, '').toLowerCase();
    const valueStart = i + (line.length - line.trimStart().length) + kv[0].length;
    const rest = src.slice(valueStart);
    let value: string | undefined;
    let consumed: number;
    if (rest.startsWith('"""') || rest.startsWith("'''")) {
      const fence = rest.slice(0, 3);
      const close = rest.indexOf(fence, 3);
      if (close < 0) break; // unterminated: stop reading
      let body = rest.slice(3, close);
      if (body.startsWith('\n')) body = body.slice(1);
      value = fence === '"""' ? unescapeToml(body) : body;
      consumed = close + 3;
    } else if (rest.startsWith('"')) {
      const m = /^"((?:[^"\\\n]|\\.)*)"/.exec(rest);
      if (!m) {
        i = lineEnd + 1;
        continue;
      }
      value = unescapeToml(m[1]);
      consumed = m[0].length;
    } else if (rest.startsWith("'")) {
      const m = /^'([^'\n]*)'/.exec(rest);
      if (!m) {
        i = lineEnd + 1;
        continue;
      }
      value = m[1];
      consumed = m[0].length;
    } else {
      i = lineEnd + 1; // number, boolean, array, table: ignored
      continue;
    }
    if (!inTable && value !== undefined) out[key] = value;
    // skip to the end of the line the value ended on
    const after = src.indexOf('\n', valueStart + consumed);
    i = after < 0 ? src.length : after + 1;
  }
  return out;
}

function unescapeToml(s: string): string {
  return s.replace(/\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)/g, (_, c: string) => {
    switch (c[0]) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case '"': return '"';
      case '\\': return '\\';
      case 'u': case 'U': return String.fromCodePoint(parseInt(c.slice(1), 16));
      default: return c;
    }
  });
}

/** A Codex custom agent (`.codex/agents/*.toml`): name, description, developer_instructions, model. */
export function parseCodexAgent(
  text: string,
  meta: { path: string; scope: AgentDefinition['scope'] },
): AgentDefinition | undefined {
  const capped = text.length > MAX_AGENT_FILE_CHARS ? text.slice(0, MAX_AGENT_FILE_CHARS) : text;
  const data = parseSimpleToml(capped);
  const fallback = path.basename(meta.path).replace(/\.toml$/i, '');
  const name = (data.name || fallback).trim();
  if (!AGENT_NAME.test(name)) return undefined;
  const description = (data.description || '').replace(/\s+/g, ' ').trim().slice(0, MAX_AGENT_DESCRIPTION_CHARS);
  return {
    name,
    description,
    tools: undefined,
    model: normaliseModel(data.model),
    prompt: (data.developer_instructions ?? '').trim(),
    path: meta.path,
    scope: meta.scope,
    source: 'codex',
  };
}

/** The folders to scan, in precedence order (later wins). */
export function agentDirectories(opts: LoadAgentsOptions): AgentDirectory[] {
  const home = opts.homeDir ?? os.homedir();
  const compat = opts.compatClaude !== false;
  const trusted = opts.workspaceTrusted !== false;
  const dirs: AgentDirectory[] = [{ dir: path.join(home, '.gisoo', 'agents'), scope: 'user', source: 'gisoo' }];
  if (compat) dirs.push({ dir: path.join(home, '.claude', 'agents'), scope: 'user', source: 'claude' });
  dirs.push({ dir: path.join(home, '.codex', 'agents'), scope: 'user', source: 'codex' });
  if (trusted) {
    for (const root of opts.workspaceRoots) {
      dirs.push({ dir: path.join(root, '.gisoo', 'agents'), scope: 'project', source: 'gisoo' });
      if (compat) dirs.push({ dir: path.join(root, '.claude', 'agents'), scope: 'project', source: 'claude' });
      dirs.push({ dir: path.join(root, '.codex', 'agents'), scope: 'project', source: 'codex' });
    }
  }
  return dirs;
}

/** Loads every `*.md` definition. Missing folders and unreadable files are skipped silently. */
export async function loadAgentDefinitions(opts: LoadAgentsOptions): Promise<AgentDefinition[]> {
  const byName = new Map<string, AgentDefinition>();
  for (const { dir, scope, source } of agentDirectories(opts)) {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const file of names.sort()) {
      const isToml = source === 'codex' && /\.toml$/i.test(file);
      if (source === 'codex' ? !isToml : !/\.md$/i.test(file)) continue;
      const full = path.join(dir, file);
      try {
        const stat = await fs.lstat(full);
        if (!stat.isFile()) continue; // no symlinks, no folders
        const text = await fs.readFile(full, 'utf8');
        const def = isToml ? parseCodexAgent(text, { path: full, scope }) : parseAgentDefinition(text, { path: full, scope, source });
        if (def) byName.set(def.name.toLowerCase(), def);
      } catch {
        // unreadable: skip
      }
      if (byName.size >= MAX_AGENTS) break;
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findAgent(defs: readonly AgentDefinition[], name: string): AgentDefinition | undefined {
  const key = name.trim().toLowerCase();
  return defs.find((d) => d.name.toLowerCase() === key);
}

/** One line per agent for the system prompt: "- name: description". */
export function agentCatalogue(defs: readonly AgentDefinition[], max = 40): string {
  return defs
    .slice(0, max)
    .map((d) => `- ${d.name}${d.description ? `: ${d.description}` : ''}`)
    .join('\n');
}
