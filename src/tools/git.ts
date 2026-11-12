/**
 * Read-only git through the `git` CLI (SPEC-phase2 §5). Every action maps to a fixed argument list;
 * the model can only choose an action, a ref and a path. Refs are validated with GIT_REF and may
 * never start with `-`; paths go through the workspace path guard. Output is capped.
 */
import { runArgv } from './argv';
import { GIT_ACTIONS, gitArgv, type GitAction } from './gitArgv';
import { OUTPUT_CAP } from './process';
import type { Tool } from './types';
import { resolvePath } from './workspace';

export { GIT_ACTIONS, GIT_LOG_LIMIT, GIT_REF, gitArgv, isValidRef, type GitAction } from './gitArgv';

export const GIT_TIMEOUT_MS = 30_000;

export interface GitInput {
  action: GitAction;
  path?: string;
  ref?: string;
}

export const gitTool: Tool<GitInput> = {
  name: 'git',
  description:
    'Read-only git: status (porcelain), diff (working tree, or against a ref), log (last 30 commits), show (a commit), blame (a file). ' +
    'Only an action, an optional ref (branch/tag/commit) and an optional workspace path; no flags.',
  permission: 'read',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...GIT_ACTIONS], description: 'What to run' },
      path: { type: 'string', description: 'Workspace-relative file or folder to limit the output to (required for blame)' },
      ref: { type: 'string', description: 'Branch, tag or commit id; for diff: compare the working tree with it' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  title: (input) => `git ${input.action}${input.ref ? ` ${input.ref}` : ''}${input.path ? ` ${input.path}` : ''}`,
  async run(input, ctx) {
    let rel: string | undefined;
    const target = (input.path ?? '').trim();
    const resolved = await resolvePath(target || '.');
    const cwd = resolved.root;
    if (target) rel = resolved.relative === '.' ? undefined : resolved.relative;
    const argv = gitArgv(String(input.action ?? ''), input.ref, rel);
    if (typeof argv === 'string') return { content: argv, isError: true };
    const result = await runArgv('git', argv, { cwd, signal: ctx.signal, timeoutMs: GIT_TIMEOUT_MS });
    let text = result.output.trimEnd() || '(no output)';
    if (result.truncated) text += `\n[output truncated at ${OUTPUT_CAP} characters]`;
    if (result.timedOut) text += '\n[git timed out]';
    if (result.exitCode !== 0) text += `\n[exit code: ${result.exitCode === null ? 'none' : result.exitCode}]`;
    return { content: text, isError: result.exitCode !== 0 && !result.output.trim() };
  },
};
