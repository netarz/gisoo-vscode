/** Runs an executable with a fixed argument list (never a shell string). Pure Node. */
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import * as path from 'node:path';
import { resolveExecutable } from '../security';
import { OUTPUT_CAP, killTree } from './process';

function isFileSync(absolute: string): boolean {
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

export interface ArgvResult {
  output: string;
  exitCode: number | null;
  truncated: boolean;
  timedOut: boolean;
}

export interface ArgvOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  cap?: number;
  onOutput?: (chunk: string) => void;
}

export const ARGV_TIMEOUT_MS = 30_000;

/** Spawns `file` with `args` directly; stdout and stderr are merged and capped. */
export function runArgv(file: string, args: readonly string[], options: ArgvOptions): Promise<ArgvResult> {
  return new Promise((resolve) => {
    const cap = options.cap ?? OUTPUT_CAP;
    let output = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const baseEnv: NodeJS.ProcessEnv = { ...process.env, ...options.env };
    // Never let the OS search the working directory (a cloned repo) for a bare program name.
    const program = resolveExecutable(file, baseEnv, process.platform, isFileSync, path);
    if (!program) {
      resolve({ output: `[spawn error] ${file} was not found on PATH`, exitCode: null, truncated: false, timedOut: false });
      return;
    }
    const child = spawn(program, [...args], {
      cwd: options.cwd,
      env: {
        ...baseEnv,
        GISOO_AGENT: '1',
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: 'cat',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const append = (chunk: Buffer | string): void => {
      const text = chunk.toString();
      options.onOutput?.(text);
      if (output.length >= cap) {
        truncated = true;
        return;
      }
      output += text;
      if (output.length > cap) {
        output = output.slice(0, cap);
        truncated = true;
      }
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, options.timeoutMs ?? ARGV_TIMEOUT_MS);
    const onAbort = (): void => killTree(child);
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ output, exitCode, truncated, timedOut });
    };
    child.on('error', (err) => {
      append(`[spawn error] ${err.message}`);
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}
