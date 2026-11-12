/**
 * Graph state per workspace folder: where graph.json lives, the commit it was built at, whether it is
 * stale (HEAD moved or sources changed since), and the status-bar item «Graph: ready / stale / off».
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getSettings } from '../config';
import { hostStr, type HostStringKey } from '../ui/strings';

export const GRAPH_DIR = 'graphify-out';
export const GRAPH_FILE = 'graph.json';
export type GraphStatus = 'off' | 'installing' | 'building' | 'ready' | 'stale';

export interface GraphInfo {
  file: string;
  exists: boolean;
  mtimeMs: number;
  builtAtCommit?: string;
}

export function graphJsonPath(root: string): string {
  return path.join(root, GRAPH_DIR, GRAPH_FILE);
}

/** Reads only the metadata of graph.json (commit, mtime) without parsing the whole file. */
export async function graphInfo(root: string): Promise<GraphInfo> {
  const file = graphJsonPath(root);
  try {
    const st = await fs.stat(file);
    const handle = await fs.open(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(st.size, 64 * 1024));
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      const head = buf.subarray(0, bytesRead).toString('utf8');
      const commit = /"built_at_commit"\s*:\s*"([0-9a-f]{7,40})"/i.exec(head)?.[1];
      return { file, exists: true, mtimeMs: st.mtimeMs, builtAtCommit: commit };
    } finally {
      await handle.close();
    }
  } catch {
    return { file, exists: false, mtimeMs: 0 };
  }
}

async function readIf(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** The git directory of a root (`.git` folder, or the target of a `.git` file in worktrees). */
export async function gitDir(root: string): Promise<string | undefined> {
  const dotGit = path.join(root, '.git');
  try {
    const st = await fs.stat(dotGit);
    if (st.isDirectory()) return dotGit;
    const text = await readIf(dotGit);
    const m = /^gitdir:\s*(.+)$/m.exec(text ?? '');
    if (m) return path.resolve(root, m[1].trim());
  } catch {
    // not a repository
  }
  return undefined;
}

/** The HEAD commit id, read from the files (no git process). */
export async function readHeadCommit(root: string): Promise<string | undefined> {
  const dir = await gitDir(root);
  if (!dir) return undefined;
  const head = (await readIf(path.join(dir, 'HEAD')))?.trim();
  if (!head) return undefined;
  if (/^[0-9a-f]{40}$/i.test(head)) return head;
  const ref = /^ref:\s*(.+)$/.exec(head)?.[1]?.trim();
  if (!ref || ref.includes('..')) return undefined;
  const direct = (await readIf(path.join(dir, ref)))?.trim();
  if (direct && /^[0-9a-f]{40}$/i.test(direct)) return direct;
  const commonDir = (await readIf(path.join(dir, 'commondir')))?.trim();
  const packed = (await readIf(path.join(commonDir ? path.resolve(dir, commonDir) : dir, 'packed-refs'))) ?? '';
  for (const line of packed.split('\n')) {
    const m = /^([0-9a-f]{40})\s+(.+)$/.exec(line.trim());
    if (m && m[2] === ref) return m[1];
  }
  return undefined;
}

const STALE_EXCLUDE = '**/{node_modules,.git,dist,out,build,.next,.venv,venv,__pycache__,vendor,coverage,target,graphify-out}/**';
const SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,kt,cs,php,rb,swift,dart,vue,svelte,c,cc,cpp,h,hpp,md}';

/**
 * Stale when HEAD is not the commit the graph was built at, or when a source file is newer than the
 * graph (checked on a bounded sample of files).
 */
export async function isGraphStale(root: string, info?: GraphInfo): Promise<boolean> {
  const g = info ?? (await graphInfo(root));
  if (!g.exists) return false;
  const head = await readHeadCommit(root);
  if (head && g.builtAtCommit && !head.startsWith(g.builtAtCommit) && !g.builtAtCommit.startsWith(head)) return true;
  const folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === root);
  const pattern = folder ? new vscode.RelativePattern(folder, SOURCE_GLOB) : SOURCE_GLOB;
  const files = await vscode.workspace.findFiles(pattern, STALE_EXCLUDE, 3000);
  const threshold = g.mtimeMs + 2000;
  const batch = 64;
  for (let i = 0; i < files.length; i += batch) {
    const stats = await Promise.all(files.slice(i, i + batch).map((u) => fs.stat(u.fsPath).catch(() => undefined)));
    if (stats.some((s) => s && s.mtimeMs > threshold)) return true;
  }
  return false;
}

/** Status-bar item showing the graph state; click runs the rebuild command. */
export class GraphStatusItem implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('gisoo.graph', vscode.StatusBarAlignment.Right, 99);
  private status: GraphStatus = 'off';
  private detail = '';
  private readonly sub: vscode.Disposable;

  constructor() {
    this.item.name = 'Gisoo graph';
    this.item.command = 'gisoo.rebuildGraph';
    this.sub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gisoo.language')) this.render();
    });
    this.render();
  }

  set(status: GraphStatus, detail = ''): void {
    this.status = status;
    this.detail = detail;
    this.render();
  }

  get current(): GraphStatus {
    return this.status;
  }

  private render(): void {
    const lang = getSettings().language;
    const textKey: Record<GraphStatus, HostStringKey> = {
      off: 'host.graph.status.off',
      installing: 'host.graph.status.installing',
      building: 'host.graph.status.building',
      ready: 'host.graph.status.ready',
      stale: 'host.graph.status.stale',
    };
    const icon = this.status === 'building' || this.status === 'installing' ? '$(sync~spin)' : this.status === 'stale' ? '$(warning)' : this.status === 'ready' ? '$(type-hierarchy)' : '$(circle-slash)';
    this.item.text = `${icon} ${hostStr(lang, textKey[this.status])}`;
    this.item.tooltip = this.detail ? `${hostStr(lang, 'host.graph.tooltip')}\n${this.detail}` : hostStr(lang, 'host.graph.tooltip');
    this.item.backgroundColor = this.status === 'stale' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    this.item.show();
  }

  dispose(): void {
    this.sub.dispose();
    this.item.dispose();
  }
}
