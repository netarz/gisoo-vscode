/**
 * Workspace path guard: every tool path must resolve inside a workspace folder and never into .git.
 * Pure: the realpath function is injected so it can be unit-tested without a file system.
 */
import * as path from 'node:path';

export interface ResolvedPath {
  /** Absolute, normalised, symlinks resolved (parent resolved when the file does not exist yet). */
  absolute: string;
  /** Relative to the workspace folder, with forward slashes. */
  relative: string;
  root: string;
}

export class PathGuardError extends Error {
  constructor(message: string, readonly reason: 'outside' | 'git' | 'empty' | 'no_workspace') {
    super(message);
    this.name = 'PathGuardError';
  }
}

export type RealpathFn = (p: string) => Promise<string>;

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function touchesGit(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  const parts = rel.split(/[\\/]+/);
  return parts.some((p) => p.toLowerCase() === '.git');
}

/** Resolves symlinks as far as the path exists (so a new file in a symlinked folder is still checked). */
async function realpathExisting(target: string, realpath: RealpathFn): Promise<string> {
  let current = target;
  const pending: string[] = [];
  for (let i = 0; i < 64; i++) {
    try {
      const real = await realpath(current);
      return pending.length ? path.join(real, ...pending.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      pending.push(path.basename(current));
      current = parent;
    }
  }
  return target;
}

/**
 * @param input   Workspace-relative (preferred) or absolute path from the model.
 * @param roots   Absolute workspace folder paths. Relative input is tried against each in order;
 *                a `folderName/…` prefix selects a folder by name in multi-root workspaces.
 */
export async function resolveWorkspacePath(input: string, roots: readonly string[], realpath: RealpathFn): Promise<ResolvedPath> {
  const raw = (input ?? '').trim().replace(/^["']|["']$/g, '');
  if (!raw) throw new PathGuardError('A path is required.', 'empty');
  if (!roots.length) throw new PathGuardError('Open a folder in VS Code first; there is no workspace.', 'no_workspace');

  const candidates: Array<{ root: string; abs: string }> = [];
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
    for (const root of roots) candidates.push({ root, abs: path.resolve(raw) });
  } else {
    const first = raw.split(/[\\/]/)[0];
    const byName = roots.find((r) => path.basename(r) === first);
    if (byName && roots.length > 1) candidates.push({ root: byName, abs: path.resolve(byName, raw.slice(first.length + 1) || '.') });
    for (const root of roots) candidates.push({ root, abs: path.resolve(root, raw) });
  }

  let lastReason: 'outside' | 'git' = 'outside';
  for (const { root, abs } of candidates) {
    const realRoot = await realpathExisting(root, realpath);
    if (!isInside(root, abs) && !isInside(realRoot, abs)) continue;
    const realAbs = await realpathExisting(abs, realpath);
    if (!isInside(realRoot, realAbs)) {
      lastReason = 'outside';
      continue;
    }
    if (touchesGit(realRoot, realAbs) || touchesGit(root, abs)) {
      lastReason = 'git';
      continue;
    }
    const relative = path.relative(realRoot, realAbs).split(path.sep).join('/') || '.';
    return { absolute: realAbs, relative, root: realRoot };
  }
  if (lastReason === 'git') throw new PathGuardError(`Refused: "${raw}" is inside .git.`, 'git');
  throw new PathGuardError(`Refused: "${raw}" is outside the workspace.`, 'outside');
}
