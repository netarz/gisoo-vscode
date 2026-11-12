/**
 * Builds the graph with `graphify update .` (SPEC-phase2 §9): first setup and manual rebuilds run
 * under a cancellable progress notification; later saves of source files and git HEAD changes
 * schedule a debounced (60 s) incremental update. Offers to add graphify-out/ to .gitignore once.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getSettings } from '../config';
import { runArgv } from '../tools/argv';
import { hostStr, type HostStringKey } from '../ui/strings';
import { GRAPH_DIR } from './status';

export const BUILD_DEBOUNCE_MS = 60_000;
export const BUILD_TIMEOUT_MS = 15 * 60_000;
const GITIGNORE_KEY = 'gisoo.graph.gitignoreOffered';
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|php|rb|swift|dart|vue|svelte|c|cc|cpp|h|hpp|md)$/i;
const IGNORED_DIR = /(^|[\\/])(node_modules|\.git|dist|out|build|\.next|\.venv|venv|__pycache__|vendor|coverage|target|graphify-out)([\\/]|$)/;

const t = (key: HostStringKey, ...args: Array<string | number>): string => hostStr(getSettings().language, key, ...args);

export interface BuildResult {
  ok: boolean;
  cancelled: boolean;
  message: string;
}

/** Runs `graphify update .` (with `--force` when asked) in `root`; cancellable through `signal`. */
export async function runGraphUpdate(cli: string, root: string, force: boolean, signal: AbortSignal, onLine?: (line: string) => void): Promise<BuildResult> {
  const args = ['update', '.', ...(force ? ['--force'] : [])];
  let last = '';
  const result = await runArgv(cli, args, {
    cwd: root,
    signal,
    timeoutMs: BUILD_TIMEOUT_MS,
    onOutput: (chunk) => {
      const lines = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length) {
        last = lines[lines.length - 1].slice(0, 120);
        onLine?.(last);
      }
    },
  });
  if (signal.aborted) return { ok: false, cancelled: true, message: 'cancelled' };
  if (result.timedOut) return { ok: false, cancelled: false, message: 'timed out' };
  if (result.exitCode !== 0) return { ok: false, cancelled: false, message: last || `exit code ${result.exitCode ?? 'none'}` };
  return { ok: true, cancelled: false, message: last };
}

/** Appends `graphify-out/` to the root .gitignore after one confirmation per workspace. */
export async function offerGitignore(context: vscode.ExtensionContext, root: string): Promise<void> {
  if (context.workspaceState.get<boolean>(GITIGNORE_KEY)) return;
  const file = path.join(root, '.gitignore');
  let existing = '';
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    try {
      await fs.stat(path.join(root, '.git'));
    } catch {
      return; // not a repository: nothing to ignore
    }
  }
  await context.workspaceState.update(GITIGNORE_KEY, true);
  if (existing.split(/\r?\n/).some((l) => l.trim().replace(/\/$/, '') === GRAPH_DIR)) return;
  const choice = await vscode.window.showInformationMessage(t('host.graph.gitignorePrompt'), t('host.graph.add'), t('host.graph.notNow'));
  if (choice !== t('host.graph.add')) return;
  const nl = existing.includes('\r\n') ? '\r\n' : '\n';
  const prefix = existing.length && !existing.endsWith('\n') ? nl : '';
  await fs.writeFile(file, `${existing}${prefix}${GRAPH_DIR}/${nl}`, 'utf8');
}

/** True for a saved file that should trigger an incremental graph update of `root`. */
export function affectsGraph(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  if (IGNORED_DIR.test(rel)) return false;
  return SOURCE_EXT.test(rel);
}

export interface BuilderHooks {
  cli: () => string | undefined;
  onStart: (root: string) => void;
  onDone: (root: string, result: BuildResult) => void;
}

/** One builder per workspace folder: progress builds, debounced updates, HEAD watcher. */
export class GraphBuilder implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: AbortController | undefined;
  private pending = false;
  private readonly subs: vscode.Disposable[] = [];

  constructor(
    readonly root: string,
    private readonly hooks: BuilderHooks,
  ) {
    const folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === root);
    if (folder) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.git/{HEAD,ORIG_HEAD}'));
      this.subs.push(watcher, watcher.onDidChange(() => this.schedule()), watcher.onDidCreate(() => this.schedule()));
    }
    this.subs.push(vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === 'file' && affectsGraph(root, doc.uri.fsPath)) this.schedule();
    }));
  }

  get busy(): boolean {
    return this.running !== undefined;
  }

  /** Debounced incremental update, 60 s after the last trigger; skipped while nothing is installed. */
  schedule(delayMs = BUILD_DEBOUNCE_MS): void {
    if (!this.hooks.cli()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.build(false, true);
    }, delayMs);
  }

  /** Builds now. `quiet` builds run without a progress notification (background updates). */
  async build(force: boolean, quiet = false): Promise<BuildResult> {
    const cli = this.hooks.cli();
    if (!cli) return { ok: false, cancelled: false, message: t('host.graph.notInstalled') };
    if (this.running) {
      this.pending = true;
      return { ok: false, cancelled: false, message: 'already building' };
    }
    const controller = new AbortController();
    this.running = controller;
    this.hooks.onStart(this.root);
    let result: BuildResult;
    try {
      if (quiet) {
        result = await runGraphUpdate(cli, this.root, force, controller.signal);
      } else {
        result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: t('host.graph.building'), cancellable: true },
          (progress, token) => {
            token.onCancellationRequested(() => controller.abort());
            return runGraphUpdate(cli, this.root, force, controller.signal, (line) => progress.report({ message: line }));
          },
        );
      }
    } finally {
      this.running = undefined;
    }
    this.hooks.onDone(this.root, result);
    if (this.pending) {
      this.pending = false;
      this.schedule(5_000);
    }
    return result;
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.running?.abort();
  }

  dispose(): void {
    this.cancel();
    for (const s of this.subs) s.dispose();
  }
}
