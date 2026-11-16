/**
 * Chats in editor tabs. Every tab is a full chat with its own conversation and its own session
 * controller, so several tasks can run side by side (and tabs can be split, dragged to another
 * group or into a new window like any editor). Tabs survive a window reload: the webview keeps the
 * id of the conversation it shows and the serializer reopens it.
 */
import * as vscode from 'vscode';
import type { AuthService } from '../auth/service';
import { getSettings } from '../config';
import type { HostToWebview } from '../shared/protocol';
import { ChatHost, type ChatController } from './chatViewProvider';
import { hostStr } from './strings';

export const CHAT_TAB_VIEW_TYPE = 'gisoo.chatTab';

/** A controller for one tab; `post` reaches only that tab. */
export type TabControllerFactory = (post: (message: HostToWebview) => void, initialSession: string | null) => ChatController & vscode.Disposable;

export interface ChatTab {
  readonly panel: vscode.WebviewPanel;
  readonly host: ChatHost;
  readonly controller: ChatController & vscode.Disposable;
}

const MAX_TITLE = 32;

export class ChatTabs implements vscode.WebviewPanelSerializer, vscode.Disposable {
  private readonly tabs = new Set<ChatTab>();
  private lastActive: ChatTab | undefined;
  private readonly changed = new vscode.EventEmitter<ChatTab | undefined>();
  /** The tab that commands act on changed (undefined: the side panel). */
  readonly onDidChangeActive = this.changed.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly auth: AuthService,
    private readonly createController: TabControllerFactory,
  ) {}

  /** Opens a new chat in an editor tab, beside the current editor when one is open. */
  open(initialSession: string | null = null): ChatTab {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
    const panel = vscode.window.createWebviewPanel(CHAT_TAB_VIEW_TYPE, this.defaultTitle(), { viewColumn: column, preserveFocus: false }, {
      retainContextWhenHidden: true,
      enableScripts: true,
    });
    return this.adopt(panel, initialSession);
  }

  async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    const id = (state as { openSessionId?: unknown } | undefined)?.openSessionId;
    this.adopt(panel, typeof id === 'string' && id ? id : null);
  }

  /** The editor tab commands should act on: the active one, else the last one used if it is visible. */
  get active(): ChatTab | undefined {
    for (const tab of this.tabs) if (tab.panel.active) return tab;
    return this.lastActive && this.tabs.has(this.lastActive) && this.lastActive.panel.visible ? this.lastActive : undefined;
  }

  get count(): number {
    return this.tabs.size;
  }

  /** Delivers a message to every tab (workspace-wide news such as new instruction files). */
  broadcast(message: HostToWebview): void {
    for (const tab of this.tabs) tab.host.post(message);
  }

  /** The side panel was used: commands go there until a tab is used again. */
  forgetActive(): void {
    if (!this.lastActive) return;
    this.lastActive = undefined;
    this.changed.fire(undefined);
  }

  private adopt(panel: vscode.WebviewPanel, initialSession: string | null): ChatTab {
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'gisoo.svg');
    // The controller exists before the host (it needs `post`), the host before the first message.
    const ref: { host?: ChatHost } = {};
    const post = (message: HostToWebview): void => {
      this.retitle(panel, message);
      ref.host?.post(message);
    };
    const controller = this.createController(post, initialSession);
    const host = new ChatHost(this.context, this.auth, controller, async () => panel.reveal(undefined, false));
    ref.host = host;
    const tab: ChatTab = { panel, host, controller };
    const binding = host.bind(panel.webview);
    this.tabs.add(tab);
    this.setActive(tab);
    const subs = [
      panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active) this.setActive(tab);
      }),
      host.onDidInteract(() => this.setActive(tab)),
    ];
    panel.onDidDispose(() => {
      subs.forEach((s) => s.dispose());
      binding.dispose();
      host.dispose();
      controller.dispose();
      this.tabs.delete(tab);
      if (this.lastActive === tab) {
        this.lastActive = undefined;
        this.changed.fire(undefined);
      }
    });
    return tab;
  }

  private setActive(tab: ChatTab): void {
    if (this.lastActive === tab) return;
    this.lastActive = tab;
    this.changed.fire(tab);
  }

  private retitle(panel: vscode.WebviewPanel, message: HostToWebview): void {
    const session = message.type === 'init' ? message.state.session : message.type === 'session' ? message.session : undefined;
    if (!session) return;
    const title = session.title?.trim();
    panel.title = title ? (title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title) : this.defaultTitle();
  }

  private defaultTitle(): string {
    return hostStr(getSettings().language, 'host.tab.title');
  }

  dispose(): void {
    for (const tab of [...this.tabs]) tab.panel.dispose();
    this.changed.dispose();
  }
}
