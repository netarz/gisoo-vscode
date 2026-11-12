import { describeResult, runShell, clampTimeout } from './process';
import { primaryRoot, relativeToWorkspace, resolvePath } from './workspace';
import type { Tool } from './types';

interface Input {
  command: string;
  cwd?: string;
  timeout_ms?: number;
}

export const runCommandTool: Tool<Input> = {
  name: 'run_command',
  description:
    'Run a shell command in the workspace and return its output (stdout and stderr, max 30k chars). Default timeout 120 s, max 600 s. Use it for builds, tests, git and package managers; never for long-running servers.',
  permission: 'command',
  readOnly: false,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The exact shell command' },
      cwd: { type: 'string', description: 'Workspace-relative working directory (default: workspace root)' },
      timeout_ms: { type: 'integer', minimum: 1000, maximum: 600000, description: 'Timeout in milliseconds (default 120000)' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  title: (input) => `Run ${(input.command ?? '').split('\n')[0].slice(0, 120)}`,
  async run(input, ctx) {
    const command = (input.command ?? '').trim();
    if (!command) return { content: 'command is required', isError: true };
    const cwd = input.cwd ? (await resolvePath(input.cwd)).absolute : primaryRoot();
    if (!cwd) return { content: 'No workspace folder is open.', isError: true };
    const result = await runShell(command, { cwd, timeoutMs: clampTimeout(input.timeout_ms), signal: ctx.signal, onOutput: ctx.onProgress });
    const text = describeResult(result);
    return {
      content: text,
      isError: result.exitCode !== 0,
      view: { command: { command, cwd: relativeToWorkspace(cwd), exitCode: result.exitCode } },
    };
  },
};
