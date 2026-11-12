/**
 * VS Code side of the preview server: one server per workspace folder, started on first use,
 * live reload on save, Simple Browser opening, headless screenshots. Disposed with the extension.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getSettings } from '../config';
import { runArgv } from '../tools/argv';
import { resolvePath } from '../tools/workspace';
import { findBrowser, screenshotArgv } from './browser';
import { PreviewServer, isLocalUrl } from './server';

export const SCREENSHOT_TIMEOUT_MS = 60_000;
export const SCREENSHOT_MAX_SIDE = 4000;

let instance: PreviewManager | undefined;

export function previewManager(): PreviewManager {
  if (!instance) instance = new PreviewManager();
  return instance;
}

export class PreviewManager implements vscode.Disposable {
  private readonly servers = new Map<string, PreviewServer>();
  private readonly subs: vscode.Disposable[] = [];

  constructor() {
    this.subs.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        const file = doc.uri.fsPath;
        for (const [root, server] of this.servers) {
          const rel = path.relative(root, file);
          if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) server.reload();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders((e) => {
        for (const removed of e.removed) void this.servers.get(removed.uri.fsPath)?.stop();
        for (const removed of e.removed) this.servers.delete(removed.uri.fsPath);
      }),
    );
  }

  /** The URL of a workspace file on the (started) preview server of its folder. */
  async urlFor(workspacePath: string): Promise<{ url: string; relative: string }> {
    const resolved = await resolvePath(workspacePath);
    const server = await this.serverFor(resolved.root);
    const rel = resolved.relative === '.' ? '' : resolved.relative;
    return { url: server.urlFor(rel), relative: resolved.relative };
  }

  private async serverFor(root: string): Promise<PreviewServer> {
    let server = this.servers.get(root);
    if (!server) {
      server = new PreviewServer({ root });
      this.servers.set(root, server);
    }
    await server.start();
    return server;
  }

  /** Opens a local URL in VS Code's Simple Browser, falling back to the system browser. */
  async open(url: string): Promise<void> {
    if (!isLocalUrl(url)) throw new Error('Only local (127.0.0.1 / localhost) URLs can be previewed.');
    try {
      await vscode.commands.executeCommand('simpleBrowser.api.open', vscode.Uri.parse(url), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    } catch {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }

  /** Renders `url` headless and returns the PNG path under os.tmpdir(). */
  async screenshot(url: string, width: number, height: number, waitMs: number, signal: AbortSignal): Promise<{ file: string; browser: string }> {
    if (!isLocalUrl(url)) throw new Error('Only local (127.0.0.1 / localhost) URLs can be captured.');
    const browser = await findBrowser(getSettings().browserPath);
    if (!browser) throw new Error('No Chromium-based browser found (Chrome, Edge, Chromium, Brave). Set gisoo.browserPath to the executable.');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gisoo-shot-'));
    const outFile = path.join(dir, 'page.png');
    const args = screenshotArgv({ url, outFile, width, height, waitMs });
    const result = await runArgv(browser, args, { cwd: dir, signal, timeoutMs: SCREENSHOT_TIMEOUT_MS, env: { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE } });
    try {
      const st = await fs.stat(outFile);
      if (!st.isFile() || st.size === 0) throw new Error('empty');
    } catch {
      const tail = result.output.trim().split('\n').slice(-5).join('\n');
      throw new Error(`The browser produced no screenshot${result.timedOut ? ' (timed out)' : ''}.${tail ? `\n${tail}` : ''}`);
    }
    return { file: outFile, browser };
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    for (const server of this.servers.values()) void server.stop();
    this.servers.clear();
    if (instance === this) instance = undefined;
  }
}
