/**
 * Pure part of the git tool (SPEC-phase2 §5): the action list, ref validation and the fixed
 * argument list per action. No VS Code imports, so it is unit-testable; `git.ts` adds the tool.
 */

export type GitAction = 'status' | 'diff' | 'log' | 'show' | 'blame';

export const GIT_ACTIONS: readonly GitAction[] = ['status', 'diff', 'log', 'show', 'blame'];
export const GIT_REF = /^[A-Za-z0-9._/~^-]{1,100}$/;
export const GIT_LOG_LIMIT = 30;

/** True for refs the tool accepts: short, safe characters only, never flag-like. */
export function isValidRef(ref: string): boolean {
  return GIT_REF.test(ref) && !ref.startsWith('-') && !ref.includes('..') && !ref.endsWith('.lock');
}

/**
 * The fixed argument list for an action. `path` is already workspace-relative and guarded; `ref`
 * is validated here. Returns a string message when the input is not acceptable.
 */
export function gitArgv(action: string, ref: string | undefined, relativePath: string | undefined): string[] | string {
  if (!GIT_ACTIONS.includes(action as GitAction)) return `Unknown action "${action}". Use one of: ${GIT_ACTIONS.join(', ')}.`;
  const cleanRef = (ref ?? '').trim();
  if (cleanRef && !isValidRef(cleanRef)) return `Invalid ref "${cleanRef}". Use a branch, tag or commit id (letters, digits, . _ / ~ ^ -).`;
  const p = (relativePath ?? '').trim();
  if (p.startsWith('-')) return 'Invalid path.';
  const base = ['--no-pager', '-c', 'color.ui=false', '-c', 'core.quotepath=false'];
  const pathArgs = p ? ['--', p] : [];
  switch (action as GitAction) {
    case 'status':
      return [...base, 'status', '--porcelain=v1', '--branch', '--untracked-files=normal', ...pathArgs];
    case 'diff':
      return [...base, 'diff', '--no-ext-diff', '--stat=120', '--patch', ...(cleanRef ? [cleanRef] : []), ...pathArgs];
    case 'log':
      return [...base, 'log', `--max-count=${GIT_LOG_LIMIT}`, '--date=short', '--format=%h %ad %an%d %s', ...(cleanRef ? [cleanRef] : []), ...pathArgs];
    case 'show':
      return [...base, 'show', '--no-ext-diff', '--stat=120', '--patch', '--date=short', cleanRef || 'HEAD', ...pathArgs];
    case 'blame':
      if (!p) return 'blame needs a path.';
      return [...base, 'blame', '--date=short', '-w', ...(cleanRef ? [cleanRef] : []), '--', p];
    default:
      return `Unknown action "${action}".`;
  }
}
