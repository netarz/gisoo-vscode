/**
 * Claude Code compatibility (SPEC-phase2 §3): read-only access to Claude Code's auto-memory for
 * this folder, the import command, and the `/init` prompt that starts from CLAUDE.md / AGENTS.md.
 * Pure Node; Gisoo never writes into `~/.claude`.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { indexLineNames, looksLikeSecret, MEMORY_INDEX, MEMORY_NAME, MemoryStore, memorySlug, parseMemoryFile, toMemoryName, type MemoryEntry } from './memory';

export function claudeMemoryDir(homeDir: string, folder: string): string {
  return path.join(homeDir, '.claude', 'projects', memorySlug(folder), 'memory');
}

export function claudeMemoryStore(homeDir: string, folder: string): MemoryStore {
  return new MemoryStore({ dir: claudeMemoryDir(homeDir, folder), source: 'claude', label: 'Claude memory', writable: false });
}

export interface ImportResult {
  copied: string[];
  /** Already present in Gisoo memory under the same name. */
  skipped: string[];
  /** Looked like a secret or had an unusable name. */
  refused: string[];
  sourceDir: string;
  targetDir: string;
}

/** Copies Claude Code's memory files for this folder into Gisoo memory; existing names are kept. */
export async function importClaudeMemory(from: MemoryStore, to: MemoryStore): Promise<ImportResult> {
  const result: ImportResult = { copied: [], skipped: [], refused: [], sourceDir: from.dir, targetDir: to.dir };
  let names: string[];
  try {
    names = await fs.readdir(from.dir);
  } catch {
    return result;
  }
  const indexText = await readOrEmpty(from.indexPath);
  const indexByName = new Map<string, string>();
  for (const line of indexText.split('\n')) {
    const n = indexLineNames(line);
    if (n) indexByName.set(n, line.trim());
  }
  for (const file of names.sort()) {
    if (!/\.md$/i.test(file) || file.toUpperCase() === MEMORY_INDEX) continue;
    const src = path.join(from.dir, file);
    let text: string;
    try {
      const st = await fs.lstat(src);
      if (!st.isFile()) continue;
      text = await fs.readFile(src, 'utf8');
    } catch {
      continue;
    }
    const target = MEMORY_NAME.test(file) ? file : toMemoryName(file);
    if (!target) {
      result.refused.push(file);
      continue;
    }
    let abs: string;
    try {
      abs = to.resolve(target);
    } catch {
      result.refused.push(file);
      continue;
    }
    if (await exists(abs)) {
      result.skipped.push(file);
      continue;
    }
    if (looksLikeSecret(text)) {
      result.refused.push(file);
      continue;
    }
    await fs.mkdir(to.dir, { recursive: true });
    await fs.writeFile(abs, text, 'utf8');
    const entry: MemoryEntry = parseMemoryFile(target, text);
    const original = indexByName.get(file);
    await to.updateIndex(original ? withDescriptionFromLine(entry, original) : entry);
    result.copied.push(target);
  }
  return result;
}

function withDescriptionFromLine(entry: MemoryEntry, line: string): MemoryEntry {
  const m = /\)\s*(?:—|-|:)\s*(.+)$/.exec(line);
  return m ? { ...entry, description: m[1].trim() } : entry;
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.lstat(abs);
    return true;
  } catch {
    return false;
  }
}

async function readOrEmpty(abs: string): Promise<string> {
  try {
    return await fs.readFile(abs, 'utf8');
  } catch {
    return '';
  }
}

export interface InitSources {
  gisoo: boolean;
  claude: boolean;
  agents: boolean;
  copilot: boolean;
}

/** Which starting points exist at the workspace root. */
export async function detectInitSources(root: string): Promise<InitSources> {
  const has = async (rel: string): Promise<boolean> => {
    try {
      return (await fs.lstat(path.join(root, rel))).isFile();
    } catch {
      return false;
    }
  };
  return {
    gisoo: await has('GISOO.md'),
    claude: await has('CLAUDE.md'),
    agents: await has('AGENTS.md'),
    copilot: await has('.github/copilot-instructions.md'),
  };
}

/** The `/init` prompt: write GISOO.md, starting from CLAUDE.md / AGENTS.md when they exist. */
export function initPrompt(sources: InitSources): string {
  const lines = [
    'Explore this workspace (structure, package manifests, build and test commands, conventions) and write a GISOO.md file at the workspace root.',
    'It should tell an AI coding agent how to work here: what the project is, how to build, test and lint, the code conventions, and anything surprising.',
    'Keep it under 150 lines, plain markdown, no emoji.',
  ];
  if (sources.gisoo) lines.push('GISOO.md already exists: read it first and improve it instead of replacing it; keep what is still true.');
  const existing = [sources.claude ? 'CLAUDE.md' : '', sources.agents ? 'AGENTS.md' : '', sources.copilot ? '.github/copilot-instructions.md' : ''].filter(Boolean);
  if (existing.length) {
    lines.push(
      `The project already has ${existing.join(' and ')}. Read it and start from it: add what is missing for Gisoo instead of duplicating it.`,
      `Do not copy its text; where it is still accurate, reference it with an import line such as "@${existing[0]}" on its own line and only add Gisoo-specific notes.`,
    );
  }
  return lines.join(' ');
}
