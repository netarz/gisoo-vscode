/**
 * Skills catalogue (SPEC-phase2 §7): loads `SKILL.md` folders in the Claude Agent Skills format
 * (Codex uses the same layout) from user, project and plugin locations, builds the prompt catalogue
 * and the `skill` tool that loads one skill in full. Pure Node except for the tool's read-root hook.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseFrontmatter, parseToolList } from '../agents/definitions';
import type { Tool, ToolResult } from '../tools/types';

export type SkillScope = 'user' | 'project';
export type SkillSource = 'gisoo' | 'claude' | 'codex' | 'agents' | 'plugin';

export interface Skill {
  name: string;
  description: string;
  /** Absolute path of SKILL.md. */
  path: string;
  /** Absolute path of the skill folder. */
  dir: string;
  scope: SkillScope;
  source: SkillSource;
  allowedTools?: string[];
  license?: string;
  metadata?: Record<string, string>;
}

export interface SkillDirectory {
  dir: string;
  scope: SkillScope;
  source: SkillSource;
  /** Bounded recursive search for `skills/<name>/SKILL.md` (Claude plugins). */
  deep?: boolean;
}

export interface LoadSkillsOptions {
  workspaceRoots: readonly string[];
  homeDir?: string;
  compatClaude?: boolean;
  workspaceTrusted?: boolean;
  /** Folders of skills the user disabled (from .installed.json). */
  disabledDirs?: readonly string[];
  /**
   * Repository root of each workspace folder (keyed by the resolved folder path). loadSkills fills
   * it with findRepoRoot when absent; pass it to skillDirectories directly in tests.
   */
  repoRoots?: ReadonlyMap<string, string>;
}

export const SKILL_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
export const MAX_SKILL_FILE_CHARS = 60_000;
export const MAX_SKILL_DESCRIPTION_CHARS = 1_024;
export const MAX_SKILLS_IN_CATALOGUE = 60;
export const MAX_SKILLS = 200;
export const MAX_SKILL_FILES_LISTED = 200;
const PLUGIN_WALK_MAX_DEPTH = 7;
const PLUGIN_WALK_MAX_DIRS = 800;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__']);

export interface SkillFrontmatter {
  name?: string;
  description: string;
  allowedTools?: string[];
  license?: string;
  metadata?: Record<string, string>;
  body: string;
}

/** Parses SKILL.md frontmatter (flat keys plus the nested `metadata:` block). */
export function parseSkillFrontmatter(text: string): SkillFrontmatter {
  const capped = text.length > MAX_SKILL_FILE_CHARS ? text.slice(0, MAX_SKILL_FILE_CHARS) : text;
  const { data, body } = parseFrontmatter(capped);
  const metadata = parseMetadataBlock(capped);
  return {
    name: data.name?.trim() || undefined,
    description: (multiLineValue(capped, 'description') ?? data.description ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SKILL_DESCRIPTION_CHARS),
    allowedTools: parseToolList(data['allowed-tools'] ?? data.allowed_tools),
    license: data.license?.trim() || undefined,
    metadata: Object.keys(metadata).length ? metadata : undefined,
    body,
  };
}

/**
 * Value of a frontmatter key written as a YAML block scalar (`key: >` / `key: |`) or a plain scalar
 * continued on indented lines. Undefined when the key is a single-line value (the flat parser has it).
 */
function multiLineValue(text: string, key: string): string | undefined {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return undefined;
  const keyRe = new RegExp(`^${key}\\s*:\\s*(.*)$`);
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return undefined;
    const m = keyRe.exec(lines[i]);
    if (!m) continue;
    const head = m[1].trim();
    const block = /^[>|][-+]?$/.test(head);
    const parts: string[] = block ? [] : [head.replace(/^["']|["']$/g, '')];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === '---' || (line.trim() !== '' && !/^\s/.test(line))) break;
      parts.push(line.trim());
    }
    if (j === i + 1) return undefined;
    return parts.filter((p) => p !== '').join(head === '|' || head === '|-' || head === '|+' ? '\n' : ' ');
  }
  return undefined;
}

function parseMetadataBlock(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return out;
  let inMeta = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') break;
    if (/^metadata\s*:\s*$/.test(line)) {
      inMeta = true;
      continue;
    }
    if (inMeta) {
      const m = /^\s+([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
      if (m) out[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
      else if (!/^\s/.test(line)) inMeta = false;
    }
  }
  return out;
}

export function parseSkill(text: string, meta: { path: string; scope: SkillScope; source: SkillSource }): Skill | undefined {
  const fm = parseSkillFrontmatter(text);
  const dir = path.dirname(meta.path);
  const name = (fm.name || path.basename(dir)).trim();
  if (!SKILL_NAME.test(name)) return undefined;
  return {
    name,
    description: fm.description,
    path: meta.path,
    dir,
    scope: meta.scope,
    source: meta.source,
    allowedTools: fm.allowedTools,
    license: fm.license,
    metadata: fm.metadata,
  };
}

/** How far up from a workspace folder the repository root is searched for. */
export const REPO_ROOT_MAX_LEVELS = 32;

/**
 * The repository root above (or at) `start`: the nearest folder holding `.git` (a folder, or a file
 * for worktrees and submodules). Undefined when there is none within REPO_ROOT_MAX_LEVELS levels.
 */
export async function findRepoRoot(start: string, exists: (abs: string) => Promise<boolean> = pathExists): Promise<string | undefined> {
  let dir = path.resolve(start);
  for (let level = 0; level <= REPO_ROOT_MAX_LEVELS; level++) {
    if (await exists(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await fs.lstat(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Folders strictly above `workspaceRoot` up to and including `repoRoot`, outermost first. Empty when
 * there is no repository root or the workspace folder is the repository root.
 */
export function foldersBetween(repoRoot: string | undefined, workspaceRoot: string): string[] {
  if (!repoRoot) return [];
  const top = path.resolve(repoRoot);
  let dir = path.resolve(workspaceRoot);
  const rel = path.relative(top, dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return [];
  const out: string[] = [];
  while (dir !== top) {
    const parent = path.dirname(dir);
    if (parent === dir) return [];
    out.unshift(parent);
    dir = parent;
  }
  return out;
}

/** Folders to scan, in precedence order (later wins on a name clash). */
export function skillDirectories(opts: LoadSkillsOptions): SkillDirectory[] {
  const home = opts.homeDir ?? os.homedir();
  const compat = opts.compatClaude !== false;
  const trusted = opts.workspaceTrusted !== false;
  const dirs: SkillDirectory[] = [];
  if (compat) dirs.push({ dir: path.join(home, '.claude', 'plugins'), scope: 'user', source: 'plugin', deep: true });
  dirs.push({ dir: path.join(home, '.codex', 'skills'), scope: 'user', source: 'codex' });
  dirs.push({ dir: path.join(home, '.agents', 'skills'), scope: 'user', source: 'agents' });
  if (compat) dirs.push({ dir: path.join(home, '.claude', 'skills'), scope: 'user', source: 'claude' });
  dirs.push({ dir: path.join(home, '.gisoo', 'skills'), scope: 'user', source: 'gisoo' });
  if (trusted) {
    for (const root of opts.workspaceRoots) {
      // Codex reads `.agents/skills` in every folder from the repository root down to the working
      // folder; the nearer folder wins, so ancestors come first. The workspace folder itself is below.
      for (const dir of foldersBetween(opts.repoRoots?.get(path.resolve(root)), root)) {
        if (path.resolve(dir).toLowerCase() === path.resolve(home).toLowerCase()) continue;
        dirs.push({ dir: path.join(dir, '.agents', 'skills'), scope: 'project', source: 'agents' });
      }
      dirs.push({ dir: path.join(root, '.codex', 'skills'), scope: 'project', source: 'codex' });
      dirs.push({ dir: path.join(root, '.agents', 'skills'), scope: 'project', source: 'agents' });
      if (compat) dirs.push({ dir: path.join(root, '.claude', 'skills'), scope: 'project', source: 'claude' });
      dirs.push({ dir: path.join(root, '.gisoo', 'skills'), scope: 'project', source: 'gisoo' });
    }
  }
  return dirs;
}

async function isDir(abs: string): Promise<boolean> {
  try {
    return (await fs.lstat(abs)).isDirectory();
  } catch {
    return false;
  }
}

async function skillFileIn(dir: string): Promise<string | undefined> {
  const file = path.join(dir, 'SKILL.md');
  try {
    return (await fs.lstat(file)).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

/** `<dir>/<name>/SKILL.md` for every direct sub-folder. */
async function listSkillFiles(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = (await fs.readdir(dir)).sort();
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const sub = path.join(dir, name);
    if (!(await isDir(sub))) continue;
    const file = await skillFileIn(sub);
    if (file) out.push(file);
  }
  return out;
}

/** Bounded walk for any `skills/<name>/SKILL.md` folder under the Claude plugins folder. */
async function walkPluginSkills(root: string): Promise<string[]> {
  const out: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < PLUGIN_WALK_MAX_DIRS) {
    const { dir, depth } = queue.shift() as { dir: string; depth: number };
    visited++;
    let names: string[];
    try {
      names = (await fs.readdir(dir)).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
      const sub = path.join(dir, name);
      if (!(await isDir(sub))) continue;
      if (name.toLowerCase() === 'skills') out.push(...(await listSkillFiles(sub)));
      else if (depth + 1 < PLUGIN_WALK_MAX_DEPTH) queue.push({ dir: sub, depth: depth + 1 });
    }
  }
  return out;
}

export async function loadSkills(opts: LoadSkillsOptions): Promise<Skill[]> {
  const byName = new Map<string, Skill>();
  const disabled = new Set((opts.disabledDirs ?? []).map((d) => path.resolve(d).toLowerCase()));
  let repoRoots = opts.repoRoots;
  if (!repoRoots && opts.workspaceTrusted !== false) {
    const found = new Map<string, string>();
    for (const root of opts.workspaceRoots) {
      const repo = await findRepoRoot(root);
      if (repo) found.set(path.resolve(root), repo);
    }
    repoRoots = found;
  }
  for (const { dir, scope, source, deep } of skillDirectories({ ...opts, repoRoots })) {
    const files = deep ? await walkPluginSkills(dir) : await listSkillFiles(dir);
    for (const file of files) {
      if (disabled.has(path.resolve(path.dirname(file)).toLowerCase())) continue;
      try {
        const text = await fs.readFile(file, 'utf8');
        const skill = parseSkill(text, { path: file, scope, source });
        if (skill) byName.set(skill.name.toLowerCase(), skill);
      } catch {
        // unreadable: skip
      }
      if (byName.size >= MAX_SKILLS) break;
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findSkill(skills: readonly Skill[], name: string): Skill | undefined {
  const key = name.trim().toLowerCase();
  return skills.find((s) => s.name.toLowerCase() === key);
}

/** The "## Skills" prompt section: name + description for the first `max`, the rest by name. */
export function skillsPromptSection(skills: readonly Skill[], max = MAX_SKILLS_IN_CATALOGUE): string {
  if (!skills.length) return '';
  const listed = skills.slice(0, max).map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ''}`);
  const rest = skills.slice(max).map((s) => s.name);
  const lines = [
    '## Skills',
    'Skills are folders of instructions and helper files the user installed. When a skill\'s description matches the task, call the skill tool with its name before starting, follow its SKILL.md, and say which skill you used.',
    'Files inside a skill folder can be read with read_file using the absolute paths the skill tool lists; scripts run only through run_command with the user\'s approval.',
    listed.join('\n'),
  ];
  if (rest.length) lines.push(`Other skills (load by name): ${rest.join(', ')}`);
  return lines.join('\n\n');
}

export interface LoadedSkill {
  skill: Skill;
  /** SKILL.md text (frontmatter included). */
  text: string;
  /** Folder-relative paths of sibling files (forward slashes), bounded. */
  files: string[];
}

/** Reads SKILL.md and lists the skill's files (no symlinks followed). */
export async function loadSkillContent(skill: Skill): Promise<LoadedSkill> {
  const raw = await fs.readFile(skill.path, 'utf8');
  const text = raw.length > MAX_SKILL_FILE_CHARS ? `${raw.slice(0, MAX_SKILL_FILE_CHARS)}\n\n[truncated]` : raw;
  const files: string[] = [];
  const stack = [skill.dir];
  let visited = 0;
  while (stack.length && files.length < MAX_SKILL_FILES_LISTED && visited < 500) {
    const dir = stack.pop() as string;
    visited++;
    let names: string[];
    try {
      names = (await fs.readdir(dir)).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      let st;
      try {
        st = await fs.lstat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else if (st.isFile() && full !== skill.path) files.push(path.relative(skill.dir, full).split(path.sep).join('/'));
      if (files.length >= MAX_SKILL_FILES_LISTED) break;
    }
  }
  return { skill, text, files: files.sort() };
}

export interface SkillToolDeps {
  skills: () => readonly Skill[];
  /** Called when a skill is loaded, e.g. to allow read_file inside its folder. */
  onLoaded?: (skill: Skill) => void;
}

export function createSkillTool(deps: SkillToolDeps): Tool<{ name: string }> {
  return {
    name: 'skill',
    description:
      'Load a skill by name: returns its full SKILL.md instructions and the list of files in its folder (readable with read_file by absolute path). Use it when a skill from the catalogue matches the task.',
    permission: 'read',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Skill name from the catalogue' } },
      required: ['name'],
      additionalProperties: false,
    },
    title: (input) => `Load skill ${input.name}`,
    async run(input): Promise<ToolResult> {
      const skill = findSkill(deps.skills(), String(input.name ?? ''));
      if (!skill) {
        const names = deps.skills().map((s) => s.name).slice(0, 40);
        return { content: `No skill named "${String(input.name)}". Available: ${names.join(', ') || '(none)'}`, isError: true };
      }
      try {
        const loaded = await loadSkillContent(skill);
        deps.onLoaded?.(skill);
        const lines = [
          `# Skill: ${skill.name} (${skill.scope}, ${skill.source})`,
          `Folder: ${skill.dir}`,
          skill.allowedTools?.length ? `allowed-tools (advisory, never widens permissions): ${skill.allowedTools.join(', ')}` : '',
          '',
          loaded.text.trim(),
          '',
          loaded.files.length ? `## Files in this skill\n${loaded.files.map((f) => `- ${f}`).join('\n')}\nRead them with read_file("${path.join(skill.dir, '<file>')}"). Scripts run only through run_command with the user's approval.` : '## Files in this skill\n(none besides SKILL.md)',
        ].filter((l, i) => l !== '' || i > 2);
        return { content: lines.join('\n'), display: `${skill.name}: ${loaded.files.length} file(s)` };
      } catch (error) {
        return { content: `Cannot load skill "${skill.name}": ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    },
  };
}
