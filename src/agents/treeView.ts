/**
 * Sidebar tree `gisoo.agents` (SPEC-phase2 §8): every running and finished agent, fed from the same
 * AgentInfo stream the webview receives. A row opens the agent's transcript; the inline actions go
 * through the `gisoo.agent.*` commands registered in extension.ts.
 */
import * as vscode from 'vscode';
import type { AgentInfo, AgentStatus, UiLanguage } from '../shared/protocol';
import { hostStr, type HostStringKey } from '../ui/strings';

/** Refresh period for the elapsed time while something runs. */
const TICK_MS = 5_000;

const STATUS_ICON: Record<AgentStatus, vscode.ThemeIcon> = {
  running: new vscode.ThemeIcon('loading~spin'),
  waiting: new vscode.ThemeIcon('clock'),
  done: new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed')),
  failed: new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed')),
  stopped: new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('testing.iconSkipped')),
};

const STATUS_KEY: Record<AgentStatus, HostStringKey> = {
  running: 'host.agents.status.running',
  waiting: 'host.agents.status.waiting',
  done: 'host.agents.status.done',
  failed: 'host.agents.status.failed',
  stopped: 'host.agents.status.stopped',
};

/** A tree element: an agent, or the single placeholder row shown while the list is empty. */
export type AgentNode = AgentInfo | { placeholder: true };

export const isRunning = (status: AgentStatus): boolean => status === 'running' || status === 'waiting';

/** The agent id behind a command argument: a tree element, an AgentInfo or a plain id string. */
export function agentIdFromArg(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg || undefined;
  if (arg && typeof arg === 'object' && typeof (arg as { id?: unknown }).id === 'string') return (arg as { id: string }).id;
  return undefined;
}

function elapsedSeconds(info: AgentInfo): number {
  return Math.max(0, Math.round(((info.endedAt ?? Date.now()) - info.startedAt) / 1000));
}

export class AgentTreeProvider implements vscode.TreeDataProvider<AgentNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<AgentNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private items: AgentInfo[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  /** True once VS Code has asked for the root items, i.e. the view was opened and resolved. */
  requested = false;

  constructor(private readonly language: () => UiLanguage) {}

  /** Replaces the whole list (the `agents` message). */
  setAll(items: AgentInfo[]): void {
    this.items = items.map((item) => ({ ...item }));
    this.refresh();
  }

  /** Inserts or updates one agent (the `agentUpdate` message). */
  upsert(item: AgentInfo): void {
    const idx = this.items.findIndex((a) => a.id === item.id);
    if (idx >= 0) this.items[idx] = { ...item };
    else this.items.push({ ...item });
    this.refresh();
  }

  get(id: string): AgentInfo | undefined {
    return this.items.find((a) => a.id === id);
  }

  getTreeItem(node: AgentNode): vscode.TreeItem {
    if ('placeholder' in node) {
      const empty = new vscode.TreeItem(this.t('host.agents.viewEmpty'), vscode.TreeItemCollapsibleState.None);
      empty.iconPath = new vscode.ThemeIcon('info');
      empty.contextValue = 'agent.placeholder';
      return empty;
    }
    const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.description = `${this.t(STATUS_KEY[node.status])} ${node.model}`.trim();
    item.iconPath = STATUS_ICON[node.status];
    item.contextValue = isRunning(node.status) ? 'agent.running' : 'agent.finished';
    const lines = [
      `${this.t(STATUS_KEY[node.status])} - ${elapsedSeconds(node)} s`,
      `${node.tokens} tokens - $${node.costUsd.toFixed(2)}`,
    ];
    if (node.parentId) lines.push(`parent: ${node.parentId}`);
    if (node.lastStep) lines.push(node.lastStep);
    item.tooltip = lines.join('\n');
    item.command = { command: 'gisoo.agent.open', title: this.t('host.agents.open'), arguments: [node.id] };
    return item;
  }

  getChildren(node?: AgentNode): AgentNode[] {
    if (node) return [];
    this.requested = true;
    if (!this.items.length) return [{ placeholder: true }];
    const rank = (a: AgentInfo): number => (isRunning(a.status) ? 0 : 1);
    return [...this.items].sort((a, b) => rank(a) - rank(b) || (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
  }

  dispose(): void {
    this.stopTicking();
    this.changed.dispose();
  }

  private t(key: HostStringKey, ...args: Array<string | number>): string {
    return hostStr(this.language(), key, ...args);
  }

  private refresh(): void {
    this.changed.fire(undefined);
    if (this.items.some((a) => isRunning(a.status))) {
      if (!this.timer) this.timer = setInterval(() => this.changed.fire(undefined), TICK_MS);
    } else {
      this.stopTicking();
    }
  }

  private stopTicking(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
