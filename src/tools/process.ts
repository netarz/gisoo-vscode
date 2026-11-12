/** Shell command runner with timeout, output cap and process-tree kill. Pure Node. */
import { spawn, type ChildProcess } from 'node:child_process';

export const OUTPUT_CAP = 30_000;
export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_TIMEOUT_MS = 600_000;

export interface RunResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  killed: boolean;
  truncated: boolean;
  durationMs: number;
}

export interface RunOptions {
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  onOutput?: (chunk: string) => void;
  shell?: string | boolean;
}

export function clampTimeout(ms: number | undefined): number {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.floor(ms));
}

/** Kills the whole tree: taskkill on Windows, negative pid (process group) elsewhere. */
export function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => undefined);
    } catch {
      child.kill('SIGKILL');
    }
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
}

export function defaultShell(): string | boolean {
  if (process.platform === 'win32') return process.env.ComSpec || 'cmd.exe';
  return process.env.SHELL || '/bin/sh';
}

export function runShell(command: string, options: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timeoutMs = clampTimeout(options.timeoutMs);
    let output = '';
    let truncated = false;
    let timedOut = false;
    let killed = false;
    let settled = false;

    const child = spawn(command, {
      cwd: options.cwd,
      shell: options.shell ?? defaultShell(),
      env: { ...process.env, ...options.env, GISOO_AGENT: '1', CI: process.env.CI ?? '1', NO_COLOR: '1', FORCE_COLOR: '0' },
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const append = (chunk: Buffer | string): void => {
      const text = chunk.toString();
      options.onOutput?.(text);
      if (output.length >= OUTPUT_CAP) {
        truncated = true;
        return;
      }
      output += text;
      if (output.length > OUTPUT_CAP) {
        output = output.slice(0, OUTPUT_CAP);
        truncated = true;
      }
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    const onAbort = (): void => {
      killed = true;
      killTree(child);
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ output, exitCode, timedOut, killed, truncated, durationMs: Date.now() - started });
    };
    child.on('error', (err) => {
      append(`\n[spawn error] ${err.message}\n`);
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

export function describeResult(result: RunResult): string {
  const parts: string[] = [];
  parts.push(result.output.trimEnd() || '(no output)');
  if (result.truncated) parts.push(`\n[output truncated at ${OUTPUT_CAP} characters]`);
  if (result.timedOut) parts.push('\n[command timed out and was killed]');
  else if (result.killed) parts.push('\n[command was stopped by the user]');
  parts.push(`\n[exit code: ${result.exitCode === null ? 'none' : result.exitCode}, ${Math.round(result.durationMs / 100) / 10}s]`);
  return parts.join('');
}
