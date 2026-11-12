/**
 * Custom slash commands (SPEC-phase2 §3): markdown files in `.gisoo/commands`, `.claude/commands`
 * (project) and `~/.gisoo/commands`, `~/.claude/commands` (user). File name = command name, optional
 * frontmatter `description` / `argument-hint`, `$ARGUMENTS` and `$1..$9` substitution. Shell lines
 * (`` !`cmd` ``) are never executed: they are shown as text. Pure Node, unit-testable.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseFrontmatter } from '../agents/definitions';
import type { SlashCommandInfo } from '../shared/protocol';

export interface CustomCommand {
  /** Without the slash; a file in a sub-folder gets `folder:name`. */
  name: string;
  description: string;
  argumentHint?: string;
  body: string;
  path: string;
  scope: 'project' | 'user';
  source: 'gisoo' | 'claude';
}

export interface LoadCommandsOptions {
  workspaceRoots: readonly string[];
  homeDir?: string;
  compatClaude?: boolean;
  workspaceTrusted?: boolean;
}

export interface CommandDirectory {
  dir: string;
  scope: CustomCommand['scope'];
  source: CustomCommand['source'];
}

export const COMMAND_NAME = /^[a-z0-9][a-z0-9_:.-]{0,63}$/i;
export const MAX_COMMAND_FILE_CHARS = 40_000;
export const MAX_COMMANDS = 100;

/** Built-in names a custom command cannot shadow. */
export const RESERVED_COMMANDS = new Set(['new', 'compact', 'model', 'plan', 'review', 'explain', 'tests', 'init', 'cost', 'agents', 'help', 'memory', 'skills']);

export function commandDirectories(opts: LoadCommandsOptions): CommandDirectory[] {
  const home = opts.homeDir ?? os.homedir();
  const compat = opts.compatClaude !== false;
  const trusted = opts.workspaceTrusted !== false;
  const dirs: CommandDirectory[] = [{ dir: path.join(home, '.gisoo', 'commands'), scope: 'user', source: 'gisoo' }];
  if (compat) dirs.push({ dir: path.join(home, '.claude', 'commands'), scope: 'user', source: 'claude' });
  if (trusted) {
    for (const root of opts.workspaceRoots) {
      dirs.push({ dir: path.join(root, '.gisoo', 'commands'), scope: 'project', source: 'gisoo' });
      if (compat) dirs.push({ dir: path.join(root, '.claude', 'commands'), scope: 'project', source: 'claude' });
    }
  }
  return dirs;
}

export function parseCustomCommand(text: string, meta: { name: string; path: string; scope: CustomCommand['scope']; source: CustomCommand['source'] }): CustomCommand | undefined {
  if (!COMMAND_NAME.test(meta.name) || RESERVED_COMMANDS.has(meta.name.toLowerCase())) return undefined;
  const { data, body } = parseFrontmatter(text.length > MAX_COMMAND_FILE_CHARS ? text.slice(0, MAX_COMMAND_FILE_CHARS) : text);
  const description = (data.description || firstLine(body)).replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    name: meta.name,
    description,
    argumentHint: data['argument-hint']?.trim() || undefined,
    body,
    path: meta.path,
    scope: meta.scope,
    source: meta.source,
  };
}

function firstLine(body: string): string {
  return body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.startsWith('!')) ?? '';
}

/** Loads `*.md` in each folder and one level of sub-folders (`sub/name.md` → `sub:name`). Later wins. */
export async function loadCustomCommands(opts: LoadCommandsOptions): Promise<CustomCommand[]> {
  const byName = new Map<string, CustomCommand>();
  for (const { dir, scope, source } of commandDirectories(opts)) {
    const files = await listCommandFiles(dir);
    for (const { name, file } of files) {
      try {
        const text = await fs.readFile(file, 'utf8');
        const cmd = parseCustomCommand(text, { name, path: file, scope, source });
        if (cmd) byName.set(cmd.name.toLowerCase(), cmd);
      } catch {
        // unreadable: skip
      }
      if (byName.size >= MAX_COMMANDS) break;
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function listCommandFiles(dir: string): Promise<Array<{ name: string; file: string }>> {
  const out: Array<{ name: string; file: string }> = [];
  let entries: string[];
  try {
    entries = (await fs.readdir(dir)).sort();
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    let st;
    try {
      st = await fs.lstat(full);
    } catch {
      continue;
    }
    if (st.isFile() && /\.md$/i.test(entry)) out.push({ name: entry.replace(/\.md$/i, ''), file: full });
    else if (st.isDirectory() && !entry.startsWith('.')) {
      let inner: string[];
      try {
        inner = (await fs.readdir(full)).sort();
      } catch {
        continue;
      }
      for (const sub of inner) {
        if (!/\.md$/i.test(sub)) continue;
        const subFull = path.join(full, sub);
        try {
          if ((await fs.lstat(subFull)).isFile()) out.push({ name: `${entry}:${sub.replace(/\.md$/i, '')}`, file: subFull });
        } catch {
          // skip
        }
      }
    }
  }
  return out;
}

/** Splits an argument string on whitespace, honouring double and single quotes. */
export function splitArguments(args: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(args))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** `$ARGUMENTS` → everything; `$1`..`$9` → positional. Unused arguments are appended at the end. */
export function substituteArguments(body: string, args: string): string {
  const all = args.trim();
  const positional = splitArguments(all);
  let used = false;
  let text = body.replace(/\$ARGUMENTS\b/g, () => {
    used = true;
    return all;
  });
  text = text.replace(/\$([1-9])(?![0-9A-Za-z_])/g, (_m, d: string) => {
    used = true;
    return positional[Number(d) - 1] ?? '';
  });
  if (!used && all) text = `${text.trimEnd()}\n\nArguments: ${all}`;
  return text;
}

/** `` !`cmd` `` lines are shown as text, never run. */
export function neutraliseShellLines(body: string): string {
  return body.replace(/^(\s*)!`([^`\n]*)`\s*$/gm, (_m, indent: string, cmd: string) => `${indent}[shell command from the command file, not executed by Gisoo: \`${cmd}\`]`);
}

/** The prompt text to send for `/name args`. */
export function expandCommand(cmd: CustomCommand, args: string): string {
  return neutraliseShellLines(substituteArguments(cmd.body, args)).trim();
}

export function findCommand(cmds: readonly CustomCommand[], name: string): CustomCommand | undefined {
  const key = name.trim().toLowerCase();
  return cmds.find((c) => c.name.toLowerCase() === key);
}

export function commandInfos(cmds: readonly CustomCommand[]): SlashCommandInfo[] {
  return cmds.map((c) => ({
    name: c.name,
    description: [c.description, c.argumentHint ? `(${c.argumentHint})` : ''].filter(Boolean).join(' ') || `${c.source} command`,
    source: c.scope,
  }));
}
