/**
 * The chat surfaces. `ChatHost` owns one chat's webview plumbing: the HTML (strict CSP), validation
 * of every message that comes back, the editor-facing messages (files, links, auth, attachments,
 * code actions); everything else goes to that chat's session controller. `ChatViewProvider` is the
 * side-panel chat, shown on the right, on the left or at the bottom (see placement.ts); every editor
 * tab (chatTabs.ts) has a host and a controller of its own.
 */
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { AuthService } from '../auth/service';
import { getSettings } from '../config';
import { formatCoins } from '../shared/coins';
import type { AccountInfo, Attachment, HostToWebview, InitState, WebviewToHost } from '../shared/protocol';
import { relativeToWorkspace } from '../tools/workspace';
import { hostStr, stringsFor, type HostStringKey } from './strings';

const t = (key: HostStringKey, ...args: Array<string | number>): string => hostStr(getSettings().language, key, ...args);

export { CHAT_VIEW_ID } from './placement';

/** What the provider needs from the agent side (runner.ts SessionController satisfies this). */
export interface ChatController {
  handle(msg: WebviewToHost): Promise<boolean>;
}

/** The parts of InitState the host shell owns; the controller adds session, models, commands, context. */
export function baseInitState(
  auth: AuthService,
  context: vscode.ExtensionContext,
): Pick<InitState, 'language' | 'account' | 'showCost' | 'strings' | 'version'> {
  const s = getSettings();
  return {
    language: s.language,
    account: auth.getAccount(),
    showCost: s.showCost,
    strings: stringsFor(s.language),
    version: String((context.extension.packageJSON as { version?: string }).version ?? ''),
  };
}

const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Shape check for a message from the webview. Only checks what the host reads. */
export function parseWebviewMessage(raw: unknown): WebviewToHost | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  if (!str(m.type)) return undefined;
  switch (m.type) {
    case 'ready': case 'stop': case 'retry': case 'session.new': case 'session.list': case 'external.list': case 'models.refresh':
    case 'attach.activeFile': case 'attach.selection': case 'account.refresh': case 'auth.signIn':
    case 'auth.apiKey': case 'auth.enterCode': case 'auth.signOut': case 'auth.cancel': case 'auth.copyLink': case 'auth.openLink': case 'plan.start': case 'memory.open':
    case 'context.reload': case 'tab.open': case 'location.choose':
      return raw as WebviewToHost;
    case 'auth.submitCode':
      return str(m.code) && m.code.length <= 2000 ? (raw as WebviewToHost) : undefined;
    case 'send':
      return str(m.text) && Array.isArray(m.attachments) ? (raw as WebviewToHost) : undefined;
    case 'queue.edit':
      return str(m.id) && str(m.text) ? (raw as WebviewToHost) : undefined;
    case 'queue.remove': case 'session.open': case 'session.delete': case 'model.set': case 'agent.stop':
    case 'agent.open': case 'agent.retry':
      return str(m.id) ? (raw as WebviewToHost) : undefined;
    case 'external.import':
      return (m.source === 'claude-code' || m.source === 'codex') && str(m.id) && m.id.length <= 200 ? (raw as WebviewToHost) : undefined;
    case 'mode.set':
      return m.mode === 'ask' || m.mode === 'autoEdit' || m.mode === 'plan' || m.mode === 'bypass' ? (raw as WebviewToHost) : undefined;
    case 'approval':
      return str(m.callId) && (m.decision === 'accept' || m.decision === 'reject' || m.decision === 'always') ? (raw as WebviewToHost) : undefined;
    case 'answer':
      return str(m.callId) && str(m.answer) ? (raw as WebviewToHost) : undefined;
    case 'diff.open':
      return str(m.callId) ? (raw as WebviewToHost) : undefined;
    case 'file.open':
      return str(m.path) && (m.line === undefined || num(m.line)) ? (raw as WebviewToHost) : undefined;
    case 'preview.open':
      return str(m.path) ? (raw as WebviewToHost) : undefined;
    case 'checkpoint.restore':
      return str(m.turnId) ? (raw as WebviewToHost) : undefined;
    case 'files.search':
      return str(m.query) && num(m.requestId) ? (raw as WebviewToHost) : undefined;
    case 'code.copy': case 'code.insert':
      return str(m.code) ? (raw as WebviewToHost) : undefined;
    case 'code.newFile':
      return str(m.code) && (m.language === undefined || str(m.language)) ? (raw as WebviewToHost) : undefined;
    case 'link.open':
      return str(m.url) ? (raw as WebviewToHost) : undefined;
    default:
      return undefined;
  }
}

export function fileAttachment(editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor): Attachment | undefined {
  if (!editor || editor.document.uri.scheme !== 'file') return undefined;
  const rel = relativeToWorkspace(editor.document.uri.fsPath);
  return { kind: 'file', path: rel, label: rel.split(/[\\/]/).pop() ?? rel };
}

export function selectionAttachment(editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor): Attachment | undefined {
  if (!editor || editor.document.uri.scheme !== 'file' || editor.selection.isEmpty) return undefined;
  const rel = relativeToWorkspace(editor.document.uri.fsPath);
  const startLine = editor.selection.start.line + 1;
  const endLine = editor.selection.end.line + 1;
  return { kind: 'selection', path: rel, startLine, endLine, label: `${rel.split(/[\\/]/).pop() ?? rel}:${startLine}-${endLine}` };
}

const EXCLUDE = '**/{node_modules,.git,dist,out,build,.next,.venv,__pycache__,vendor,coverage}/**';

/** The side-panel chat: one controller behind whichever of the three view locations is in use. */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  readonly host: ChatHost;
  private readonly views = new Set<vscode.WebviewView>();
  private readonly disposables: vscode.Disposable[] = [];
  private pendingFocus = false;

  constructor(
    context: vscode.ExtensionContext,
    auth: AuthService,
    controller: ChatController,
    /** Id of the view for the current location setting. */
    private readonly viewId: () => string,
  ) {
    this.host = new ChatHost(context, auth, controller, () => this.reveal());
    this.disposables.push(this.host);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.views.add(view);
    const binding = this.host.bind(view.webview);
    const visibility = view.onDidChangeVisibility(() => {
      if (view.visible) this.host.markInteracted();
    });
    view.onDidDispose(() => {
      binding.dispose();
      visibility.dispose();
      this.views.delete(view);
    });
    if (this.pendingFocus) {
      this.pendingFocus = false;
      this.post({ type: 'focus' });
    }
  }

  /** Posts to the webview; false when the view is not open. */
  post(message: HostToWebview): boolean {
    return this.host.post(message);
  }

  /** True while a chat view is resolved (opened at least once and not disposed). */
  get resolved(): boolean {
    return this.views.size > 0;
  }

  /** View ids that are resolved right now. */
  get resolvedIds(): string[] {
    return [...this.views].map((v) => v.viewType);
  }

  get visible(): boolean {
    return [...this.views].some((v) => v.visible);
  }

  async reveal(): Promise<void> {
    const id = this.viewId();
    const view = [...this.views].find((v) => v.viewType === id);
    if (view) {
      view.show(false);
      this.post({ type: 'focus' });
    } else {
      this.pendingFocus = true;
      await vscode.commands.executeCommand(`${id}.focus`);
    }
  }

  /** Shows the view and delivers an attachment (used by the "attach" commands). */
  attach(attachment: Attachment | undefined, emptyMessage: string): Promise<void> {
    return this.host.attach(attachment, emptyMessage);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

/** One chat's webview plumbing, shared by the side panel and the editor tabs. */
export class ChatHost implements vscode.Disposable {
  private readonly webviews = new Set<vscode.Webview>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly interacted = new vscode.EventEmitter<void>();
  /** The user typed, clicked or brought this chat into view: it is the one commands now act on. */
  readonly onDidInteract = this.interacted.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly auth: AuthService,
    private readonly controller: ChatController,
    private readonly revealChat: () => Promise<void>,
  ) {
    this.disposables.push(this.interacted, this.auth.onDidChange((account) => this.post({ type: 'account', account })));
  }

  /** Loads the chat into a webview; disposing the result detaches it. */
  bind(webview: vscode.Webview): vscode.Disposable {
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
    webview.html = this.html(webview, mediaRoot);
    this.webviews.add(webview);
    const sub = webview.onDidReceiveMessage((raw: unknown) => {
      this.interacted.fire();
      void this.onMessage(raw);
    });
    return { dispose: () => {
      sub.dispose();
      this.webviews.delete(webview);
    } };
  }

  markInteracted(): void {
    this.interacted.fire();
  }

  /** Posts to the webview; false when none is loaded. */
  post(message: HostToWebview): boolean {
    if (!this.webviews.size) return false;
    for (const webview of this.webviews) void webview.postMessage(message);
    return true;
  }

  get bound(): boolean {
    return this.webviews.size > 0;
  }

  async reveal(): Promise<void> {
    await this.revealChat();
  }

  /** Shows the chat and delivers an attachment (used by the "attach" commands). */
  async attach(attachment: Attachment | undefined, emptyMessage: string): Promise<void> {
    if (!attachment) {
      void vscode.window.showInformationMessage(emptyMessage);
      return;
    }
    await this.revealChat();
    this.post({ type: 'attach', attachment });
  }

  private html(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const uri = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, ...p)).toString();
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');
    const lang = getSettings().language;
    return `<!DOCTYPE html>
<html lang="${lang}" dir="${lang === 'fa' ? 'rtl' : 'ltr'}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('codicons', 'codicon.css')}">
<link rel="stylesheet" href="${uri('webview.css')}">
<title>Gisoo</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${uri('webview.js')}"></script>
</body>
</html>`;
  }

  private async onMessage(raw: unknown): Promise<void> {
    const msg = parseWebviewMessage(raw);
    if (!msg) return;
    try {
      if (await this.handleHere(msg)) return;
      await this.controller.handle(msg);
    } catch (error) {
      this.post({ type: 'toast', level: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Returns true when the message was fully handled by the host shell. */
  private async handleHere(msg: WebviewToHost): Promise<boolean> {
    switch (msg.type) {
      case 'ready':
        // The controller answers with the `init` message (see baseInitState); we only refresh the account.
        void this.auth.refresh();
        return false;
      case 'account.refresh':
        await this.auth.refresh();
        return true;
      case 'auth.signIn':
        await this.signIn(() => this.auth.signInWithBrowser());
        return true;
      case 'auth.submitCode':
        // The card shows the error itself (account.signInError); no toast on top of it.
        try {
          const info = await this.auth.completeWithCode(msg.code);
          this.post({ type: 'toast', level: 'info', text: info.balanceCoins !== undefined ? t('host.signedInWithBalance', formatCoins(info.balanceCoins, getSettings().language)) : t('host.signedIn') });
        } catch {
          /* shown on the card */
        }
        return true;
      case 'auth.copyLink': {
        const copied = await this.auth.copySignInLink();
        this.post({ type: 'toast', level: copied ? 'info' : 'warning', text: t(copied ? 'host.auth.linkCopied' : 'host.auth.noPending') });
        return true;
      }
      case 'auth.openLink':
        // Same page, same sign-in: a new PKCE pair would make a code from the old page useless.
        if (!(await this.auth.reopenSignInPage())) await this.signIn(() => this.auth.signInWithBrowser());
        return true;
      case 'auth.cancel':
        await this.auth.cancelSignIn();
        return true;
      case 'auth.apiKey':
        await vscode.commands.executeCommand('gisoo.signInWithKey');
        return true;
      case 'auth.enterCode':
        await vscode.commands.executeCommand('gisoo.enterCode');
        return true;
      case 'auth.signOut':
        await this.auth.signOut();
        return true;
      case 'files.search':
        this.post({ type: 'files.result', requestId: msg.requestId, paths: await this.searchFiles(msg.query) });
        return true;
      case 'file.open':
        await this.openFile(msg.path, msg.line);
        return true;
      case 'attach.activeFile':
        await this.attach(fileAttachment(), t('host.attach.noFile'));
        return true;
      case 'attach.selection':
        await this.attach(selectionAttachment(), t('host.attach.noSelection'));
        return true;
      case 'code.copy':
        await vscode.env.clipboard.writeText(msg.code);
        this.post({ type: 'toast', level: 'info', text: t('host.copied') });
        return true;
      case 'code.insert':
        await this.insertCode(msg.code);
        return true;
      case 'code.newFile': {
        const doc = await vscode.workspace.openTextDocument({ content: msg.code, language: msg.language });
        await vscode.window.showTextDocument(doc, { preview: false });
        return true;
      }
      case 'link.open':
        await this.openLink(msg.url);
        return true;
      case 'tab.open':
        await vscode.commands.executeCommand('gisoo.openInTab');
        return true;
      case 'location.choose':
        await vscode.commands.executeCommand('gisoo.moveChat');
        return true;
      default:
        return false;
    }
  }

  private async signIn(run: () => Promise<AccountInfo>): Promise<void> {
    try {
      const info = await run();
      this.post({ type: 'toast', level: 'info', text: info.balanceCoins !== undefined ? t('host.signedInWithBalance', formatCoins(info.balanceCoins, getSettings().language)) : t('host.signedIn') });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      // Cancelling or restarting a sign-in is the user's own action, not an error worth a toast.
      if (text === t('host.auth.cancelled') || text === t('host.auth.superseded')) return;
      this.post({ type: 'toast', level: 'error', text });
    }
  }

  private async searchFiles(query: string): Promise<string[]> {
    const q = query.trim().replace(/[{}[\]*?\\]/g, '');
    const glob = q ? `**/*${q.split('').join('*')}*` : '**/*';
    const found = await vscode.workspace.findFiles(glob, EXCLUDE, 200);
    const lower = q.toLowerCase();
    return found
      .map((u) => relativeToWorkspace(u.fsPath))
      .sort((a, b) => {
        const score = (p: string) => (lower && p.toLowerCase().includes(lower) ? 0 : 1);
        return score(a) - score(b) || a.length - b.length || a.localeCompare(b);
      })
      .slice(0, 30);
  }

  private async openFile(path: string, line?: number): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    let uri: vscode.Uri | undefined;
    if (/^([a-zA-Z]:[\\/]|\/)/.test(path)) {
      uri = vscode.Uri.file(path);
    } else if (folders.length > 0) {
      uri = vscode.Uri.joinPath(folders[0].uri, path);
    }
    if (!uri) return;
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const pos = new vscode.Position(Math.max(0, (line ?? 1) - 1), 0);
      await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos), preview: true });
    } catch {
      this.post({ type: 'toast', level: 'warning', text: t('host.cannotOpen', path) });
    }
  }

  private async insertCode(code: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      await vscode.env.clipboard.writeText(code);
      this.post({ type: 'toast', level: 'info', text: t('host.noEditorCopied') });
      return;
    }
    await editor.edit((b) => {
      for (const sel of editor.selections) b.replace(sel, code);
    });
  }

  private async openLink(url: string): Promise<void> {
    let parsed: vscode.Uri;
    try {
      parsed = vscode.Uri.parse(url, true);
    } catch {
      return;
    }
    if (parsed.scheme !== 'https' && parsed.scheme !== 'http') return;
    await vscode.env.openExternal(parsed);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
