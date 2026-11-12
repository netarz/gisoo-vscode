/**
 * Graph manager (SPEC-phase2 §9): detection on activation, consented install, first build, debounced
 * updates, stale check, status bar, the four graph tools and the prompt section. Wired from extension.ts.
 */
import * as vscode from 'vscode';
import { getSettings } from '../config';
import { registerTool } from '../tools';
import { invalidateProjectMap, setGraphSummaryProvider } from '../tools/projectMap';
import { workspaceRoots } from '../tools/workspace';
import { hostStr, type HostStringKey } from '../ui/strings';
import { GraphBuilder, offerGitignore, type BuildResult } from './build';
import { detectGraphify, type GraphifyDetection } from './detect';
import { askInstallConsent, installGraphify } from './install';
import { GraphStatusItem, graphInfo, isGraphStale, readHeadCommit, type GraphStatus } from './status';
import { GRAPH_PROMPT, createGraphTools, graphSummary, invalidateGraphIndex } from './tools';

export { GRAPH_PROMPT } from './tools';

const t = (key: HostStringKey, ...args: Array<string | number>): string => hostStr(getSettings().language, key, ...args);

let instance: GraphManager | undefined;

/** The prompt section for the current graph state ('' when no graph is ready). */
export function graphPromptSection(): string {
  return instance?.isReady() ? GRAPH_PROMPT : '';
}

export class GraphManager implements vscode.Disposable {
  private detection: GraphifyDetection | undefined;
  private readonly builders = new Map<string, GraphBuilder>();
  private readonly states = new Map<string, GraphStatus>();
  private readonly statusItem = new GraphStatusItem();
  private readonly subs: vscode.Disposable[] = [];
  private starting: Promise<void> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    for (const tool of createGraphTools({
      root: () => this.primaryRoot(),
      cli: () => this.detection?.path,
      budget: () => getSettings().graphifyBudget,
      staleNote: (root) => this.staleNote(root),
    })) {
      this.subs.push({ dispose: registerTool(tool) });
    }
    setGraphSummaryProvider((root) => graphSummary(root));
    this.subs.push(
      { dispose: () => setGraphSummaryProvider(undefined) },
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.start()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => void this.start()),
    );
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- module-level singleton read by graphPromptSection()
    instance = this;
  }

  private primaryRoot(): string | undefined {
    return workspaceRoots()[0];
  }

  isReady(): boolean {
    for (const s of this.states.values()) if (s === 'ready' || s === 'stale') return true;
    return false;
  }

  /** Detection, consent, install, first build. Safe to call again; runs one at a time. */
  start(): Promise<void> {
    if (!this.starting) {
      this.starting = this.startInner().finally(() => {
        this.starting = undefined;
      });
    }
    return this.starting;
  }

  private async startInner(): Promise<void> {
    const root = this.primaryRoot();
    if (!root || !vscode.workspace.isTrusted) {
      this.statusItem.set('off', root ? t('host.graph.untrusted') : '');
      return;
    }
    this.detection = await detectGraphify(root);
    if (!this.detection) {
      const consent = await askInstallConsent(this.context);
      if (consent === 'yes') {
        this.statusItem.set('installing');
        this.detection = await installGraphify(root);
      }
    }
    for (const r of workspaceRoots()) this.ensureBuilder(r);
    const info = await graphInfo(root);
    if (!info.exists) {
      if (!this.detection) {
        this.statusItem.set('off', t('host.graph.notInstalled'));
        return;
      }
      await this.build(root, false);
      return;
    }
    await this.refreshState(root);
  }

  private ensureBuilder(root: string): GraphBuilder {
    let builder = this.builders.get(root);
    if (!builder) {
      builder = new GraphBuilder(root, {
        cli: () => this.detection?.path,
        onStart: (r) => {
          this.states.set(r, 'building');
          if (r === this.primaryRoot()) this.statusItem.set('building');
        },
        onDone: (r, result) => void this.afterBuild(r, result),
      });
      this.builders.set(root, builder);
    }
    return builder;
  }

  private async afterBuild(root: string, result: BuildResult): Promise<void> {
    invalidateGraphIndex(root);
    invalidateProjectMap();
    if (result.ok) {
      await offerGitignore(this.context, root);
      await this.refreshState(root);
      return;
    }
    const info = await graphInfo(root);
    if (!result.cancelled) void vscode.window.showWarningMessage(t('host.graph.buildFailed', result.message));
    if (info.exists) await this.refreshState(root);
    else {
      this.states.set(root, 'off');
      if (root === this.primaryRoot()) this.statusItem.set('off', result.message);
    }
  }

  private async refreshState(root: string): Promise<void> {
    const info = await graphInfo(root);
    if (!info.exists) {
      this.states.set(root, 'off');
      if (root === this.primaryRoot()) this.statusItem.set('off');
      return;
    }
    const stale = await isGraphStale(root, info);
    const status: GraphStatus = stale ? 'stale' : 'ready';
    this.states.set(root, status);
    if (root === this.primaryRoot()) {
      const detail = `${info.builtAtCommit ? `commit ${info.builtAtCommit.slice(0, 7)}, ` : ''}${new Date(info.mtimeMs).toLocaleString()}${this.detection ? `, graphify ${this.detection.version}` : ''}`;
      this.statusItem.set(status, detail);
    }
  }

  /** One-line stale notice for tool answers. */
  async staleNote(root: string): Promise<string | undefined> {
    const info = await graphInfo(root);
    if (!info.exists) return undefined;
    const state = this.states.get(root);
    if (state === 'stale') {
      const head = await readHeadCommit(root);
      const built = info.builtAtCommit ? info.builtAtCommit.slice(0, 7) : 'unknown commit';
      return `[graph may be stale: built at ${built}${head ? `, HEAD is ${head.slice(0, 7)}` : ''}; run "Gisoo: Rebuild code graph" to refresh]`;
    }
    return undefined;
  }

  private async build(root: string, force: boolean): Promise<void> {
    const builder = this.ensureBuilder(root);
    await builder.build(force);
  }

  /** The `gisoo.rebuildGraph` command: install if needed, then a forced rebuild of the primary root. */
  async rebuild(): Promise<void> {
    const root = this.primaryRoot();
    if (!root) return;
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(t('host.graph.untrusted'));
      return;
    }
    if (this.starting) await this.starting;
    if (!this.detection) this.detection = await detectGraphify(root);
    if (!this.detection) {
      const choice = await vscode.window.showInformationMessage(t('host.graph.installPrompt'), t('host.graph.install'), t('host.graph.notNow'));
      if (choice !== t('host.graph.install')) return;
      this.statusItem.set('installing');
      this.detection = await installGraphify(root);
      if (!this.detection) {
        this.statusItem.set('off', t('host.graph.notInstalled'));
        return;
      }
    }
    await this.build(root, true);
  }

  dispose(): void {
    for (const b of this.builders.values()) b.dispose();
    this.builders.clear();
    for (const s of this.subs) s.dispose();
    this.statusItem.dispose();
    if (instance === this) instance = undefined;
  }
}

/** Creates the manager and kicks off detection in the background. */
export function activateGraph(context: vscode.ExtensionContext): GraphManager {
  const manager = new GraphManager(context);
  void manager.start();
  return manager;
}
