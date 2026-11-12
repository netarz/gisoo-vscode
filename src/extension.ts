/**
 * Extension entry point: wiring only. Builds the API client, sign-in, session store, the agent
 * controller and the chat view; registers the URI handler, commands, the status-bar balance item
 * and the settings listener; disposes everything through `context.subscriptions`.
 */
import * as os from 'node:os';
import * as vscode from 'vscode';
import { SessionController } from './agent/runner';
import { loadAgentDefinitions } from './agents/definitions';
import { AgentTreeProvider, agentIdFromArg } from './agents/treeView';
import { GisooClient } from './api/client';
import { AuthService, SECRET_KEY } from './auth/service';
import { baseUrlFromSettings, getSettings } from './config';
import { claudeMemoryStore, importClaudeMemory } from './context/claude';
import { createMemoryTool } from './context/memory';
import { ContextProvider } from './context/provider';
import { activateGraph } from './graph';
import { previewManager } from './preview/manager';
import { SessionStore } from './sessions/store';
import { Links, type AccountInfo, type HostToWebview } from './shared/protocol';
import { createSkillTool } from './skills/catalog';
import { installSkillCommand } from './skills/installCommand';
import * as tools from './tools';
import { primaryRoot, workspaceRoots } from './tools/workspace';
import { CHAT_VIEW_ID, ChatViewProvider, fileAttachment, selectionAttachment } from './ui/chatViewProvider';
import { hostStr, type HostStringKey } from './ui/strings';

const t = (key: HostStringKey, ...args: Array<string | number>): string => hostStr(getSettings().language, key, ...args);

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * What `activate` returns (`extension.exports`). Read-only inspection hooks used by the
 * integration tests; nothing here changes state or reaches the network.
 */
export interface GisooExports {
  /** Names of the registered tools visible to the model under the given visibility. */
  toolNames(visibility: tools.ToolVisibility): string[];
  /** Reloads and returns the skills catalogue (names). */
  skillNames(): Promise<string[]>;
  /** The agent definitions the runner would load for the current workspace. */
  agents(): Promise<Array<{ name: string; source: string; scope: string }>>;
  /** URL of a workspace file on the (started) local preview server. */
  previewUrl(workspacePath: string): Promise<string>;
  /** The current account state (signed out unless a key is stored). */
  account(): AccountInfo;
  /** Which views VS Code has resolved so far. */
  views(): { chat: boolean; agents: boolean };
}

export function activate(context: vscode.ExtensionContext): GisooExports {
  const version = String((context.extension.packageJSON as { version?: string }).version ?? '0.0.0');
  const client = new GisooClient({
    baseUrl: baseUrlFromSettings(),
    getApiKey: () => Promise.resolve(context.secrets.get(SECRET_KEY)),
    userAgent: `gisoo-vscode/${version}`,
  });
  const auth = new AuthService(context, client);
  const store = new SessionStore(context.globalStorageUri.fsPath);

  // The provider is created after the controller, so `post` closes over it.
  // eslint-disable-next-line prefer-const -- assigned after the controller that needs `post`
  let provider: ChatViewProvider | undefined;
  // The agents tree (SPEC-phase2 §8) is fed from the same AgentInfo messages the webview gets.
  const agentTree = new AgentTreeProvider(() => getSettings().language);
  const post = (message: HostToWebview): boolean => {
    if (message.type === 'running') void vscode.commands.executeCommand('setContext', 'gisoo.running', message.running);
    if (message.type === 'agents') agentTree.setAll(message.items);
    else if (message.type === 'agentUpdate') agentTree.upsert(message.item);
    return provider?.post(message) ?? false;
  };
  // Instruction files, memory, custom commands and skills (SPEC-phase2 §1–3, §7).
  const workspaceContext = new ContextProvider({ post, compatClaude: () => getSettings().compatClaude });
  const unregisterMemory = tools.registerTool(createMemoryTool({ stores: () => workspaceContext.stores(), onChanged: () => workspaceContext.markDirty() }), {
    readOnly: false,
    needsApproval: false,
  });
  const unregisterSkill = tools.registerTool(createSkillTool({ skills: () => workspaceContext.skillList(), onLoaded: (skill) => workspaceContext.allowSkillReads(skill) }), {
    readOnly: true,
    needsApproval: false,
  });
  const controller = new SessionController({ client, tools, store, post, getSettings, context, auth, workspaceContext });
  const view = new ChatViewProvider(context, auth, controller);
  provider = view;
  // Graphify code graph (SPEC-phase2 §9): detection, consented install, builds, graph tools.
  const graph = activateGraph(context);
  const agentCommand = (type: 'agent.open' | 'agent.stop' | 'agent.retry') => (arg?: unknown) => {
    const id = agentIdFromArg(arg);
    return id ? controller.handle({ type, id }) : undefined;
  };

  context.subscriptions.push(
    auth,
    workspaceContext,
    { dispose: unregisterMemory },
    { dispose: unregisterSkill },
    controller,
    view,
    graph,
    previewManager(),
    agentTree,
    vscode.window.createTreeView('gisoo.agents', { treeDataProvider: agentTree, showCollapseAll: false }),
    vscode.window.registerUriHandler(auth),
    vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, view, { webviewOptions: { retainContextWhenHidden: true } }),
    createStatusItem(auth),
    auth.onDidChange((account) => void vscode.commands.executeCommand('setContext', 'gisoo.signedIn', account.signedIn)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gisoo.region') || e.affectsConfiguration('gisoo.baseUrl')) {
        auth.applyBase();
        void auth.refresh();
      }
    }),
    ...registerCommands({
      'gisoo.focus': () => view.reveal(),
      'gisoo.newChat': async () => {
        await view.reveal();
        await controller.handle({ type: 'session.new' });
      },
      'gisoo.stop': () => controller.handle({ type: 'stop' }),
      'gisoo.signIn': () => signInWithBrowser(auth),
      'gisoo.signInWithKey': () => signInWithKey(auth),
      'gisoo.enterCode': () => enterCode(auth),
      'gisoo.signOut': () => signOut(auth),
      'gisoo.openSettings': () => vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`),
      'gisoo.attachFile': () => view.attach(fileAttachment(), t('host.attach.noFile')),
      'gisoo.attachSelection': () => view.attach(selectionAttachment(), t('host.attach.noSelection')),
      'gisoo.showAccount': () => showAccount(auth, view),
      'gisoo.installSkill': async (source?: unknown) => {
        const installed = await installSkillCommand(typeof source === 'string' ? source : undefined);
        if (installed) await workspaceContext.reload();
      },
      'gisoo.rebuildGraph': () => graph.rebuild(),
      'gisoo.importClaudeMemory': () => importClaudeMemoryCommand(workspaceContext),
      'gisoo.showAgents': async () => {
        await view.reveal();
        post({ type: 'agents.show' });
      },
      'gisoo.agent.open': agentCommand('agent.open'),
      'gisoo.agent.stop': agentCommand('agent.stop'),
      'gisoo.agent.retry': agentCommand('agent.retry'),
    }),
  );

  void vscode.commands.executeCommand('setContext', 'gisoo.running', false);
  void vscode.commands.executeCommand('setContext', 'gisoo.signedIn', false);
  void auth.refresh();

  return {
    toolNames: (visibility) => tools.visibleTools(visibility).map((entry) => entry.tool.name),
    skillNames: async () => {
      await workspaceContext.reload();
      return workspaceContext.skillList().map((skill) => skill.name);
    },
    agents: async () => {
      const defs = await loadAgentDefinitions({ workspaceRoots: workspaceRoots(), compatClaude: getSettings().compatClaude, workspaceTrusted: vscode.workspace.isTrusted });
      return defs.map((d) => ({ name: d.name, source: d.source, scope: d.scope }));
    },
    previewUrl: async (workspacePath) => (await previewManager().urlFor(workspacePath)).url,
    account: () => auth.getAccount(),
    views: () => ({ chat: view.resolved, agents: agentTree.requested }),
  };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}

// -- Commands ----------------------------------------------------------------------------------------

type CommandHandler = (...args: unknown[]) => unknown;

/** Registers each command with a shared error handler: failures become an error notification. */
function registerCommands(handlers: Record<string, CommandHandler>): vscode.Disposable[] {
  return Object.entries(handlers).map(([id, run]) =>
    vscode.commands.registerCommand(id, async (...args: unknown[]) => {
      try {
        await run(...args);
      } catch (error) {
        void vscode.window.showErrorMessage(`Gisoo: ${errorText(error)}`);
      }
    }),
  );
}

/** "Gisoo: Import Claude Code memory": copies ~/.claude/projects/<slug>/memory into Gisoo memory (SPEC-phase2 §3). */
async function importClaudeMemoryCommand(workspaceContext: ContextProvider): Promise<void> {
  const root = primaryRoot();
  if (!root) {
    void vscode.window.showWarningMessage(t('host.memory.noWorkspace'));
    return;
  }
  if (!getSettings().compatClaude) {
    void vscode.window.showWarningMessage(t('host.memory.compatOff'));
    return;
  }
  const from = claudeMemoryStore(os.homedir(), root);
  if (!(await from.exists())) {
    void vscode.window.showInformationMessage(t('host.memory.importNone', from.dir));
    return;
  }
  const go = t('host.memory.import');
  const choice = await vscode.window.showWarningMessage(t('host.memory.importConfirm'), { modal: true, detail: `${from.dir}\n-> ${workspaceContext.stores().gisoo.dir}` }, go);
  if (choice !== go) return;
  const result = await importClaudeMemory(from, workspaceContext.stores().gisoo);
  workspaceContext.markDirty();
  const open = t('host.memory.openIndex');
  const next = await vscode.window.showInformationMessage(t('host.memory.importDone', result.copied.length, result.skipped.length, result.refused.length), open);
  if (next === open) await workspaceContext.openMemory();
}

function showSignedIn(info: AccountInfo): void {
  void vscode.window.showInformationMessage(info.balanceDisplay ? t('host.signedInWithBalance', info.balanceDisplay) : t('host.signedIn'));
}

async function signInWithBrowser(auth: AuthService): Promise<void> {
  const pending = auth.signInWithBrowser();
  void vscode.window.showInformationMessage(t('host.signIn.browserOpened'), t('host.signIn.enterCode')).then((choice) => {
    if (choice) void vscode.commands.executeCommand('gisoo.enterCode');
  });
  showSignedIn(await pending);
}

async function signInWithKey(auth: AuthService): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: t('host.apiKey.title'),
    prompt: t('host.apiKey.prompt'),
    placeHolder: 'sk-gisoo-v1-',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() && !value.trim().startsWith('sk-') ? t('host.apiKey.invalid') : undefined),
  });
  if (!key) return;
  showSignedIn(await auth.signInWithKey(key));
}

async function enterCode(auth: AuthService): Promise<void> {
  const code = await vscode.window.showInputBox({
    title: t('host.code.title'),
    prompt: t('host.code.prompt'),
    ignoreFocusOut: true,
  });
  if (!code) return;
  showSignedIn(await auth.completeWithCode(code));
}

async function signOut(auth: AuthService): Promise<void> {
  await auth.signOut();
  const choice = await vscode.window.showInformationMessage(t('host.signOut.done'), t('host.manageKeys'));
  if (choice) await vscode.env.openExternal(vscode.Uri.parse(Links.keys));
}

/** Account quick pick behind the status-bar item: balance, key, project and the usual actions. */
async function showAccount(auth: AuthService, view: ChatViewProvider): Promise<void> {
  const account = auth.getAccount();
  if (!account.signedIn) {
    await vscode.commands.executeCommand('gisoo.signIn');
    return;
  }
  type Item = vscode.QuickPickItem & { action?: () => unknown };
  const dash = '-';
  const limit = account.spendLimitUsd === null || account.spendLimitUsd === undefined ? t('host.account.noLimit') : formatUsd(account.spendLimitUsd);
  const facts: Item[] = [
    { label: `$(credit-card) ${t('host.account.balance')}`, description: account.balanceDisplay ?? dash },
    { label: `$(folder) ${t('host.account.project')}`, description: account.projectName ?? dash },
    { label: `$(key) ${t('host.account.key')}`, description: [account.keyName, account.keyPrefix].filter(Boolean).join(' ') || dash },
    { label: `$(graph) ${t('host.account.spent')}`, description: `${formatUsd(account.spentUsd ?? 0)} / ${limit}` },
    { label: `$(globe) ${t('host.account.endpoint')}`, description: account.baseUrl },
  ];
  if (account.error) facts.push({ label: `$(warning) ${t('host.account.lastError')}`, description: account.error });
  const actions: Item[] = [
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: `$(comment-discussion) ${t('host.account.openChat')}`, action: () => view.reveal() },
    { label: `$(add) ${t('host.account.addCredit')}`, action: () => vscode.env.openExternal(vscode.Uri.parse(Links.addCredit)) },
    { label: `$(settings-gear) ${t('host.manageKeys')}`, action: () => vscode.env.openExternal(vscode.Uri.parse(Links.keys)) },
    { label: `$(refresh) ${t('host.account.refresh')}`, action: () => auth.refresh() },
    { label: `$(sign-out) ${t('host.account.signOut')}`, action: () => vscode.commands.executeCommand('gisoo.signOut') },
  ];
  const picked = await vscode.window.showQuickPick([...facts, ...actions], {
    title: t('host.account.title'),
    placeHolder: t('host.account.placeholder'),
  });
  await picked?.action?.();
}

// -- Status bar --------------------------------------------------------------------------------------

function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** Status-bar item with the dollar balance; opens the account quick pick, or sign-in when signed out. */
function createStatusItem(auth: AuthService): vscode.Disposable {
  const item = vscode.window.createStatusBarItem('gisoo.balance', vscode.StatusBarAlignment.Right, 100);
  item.name = 'Gisoo';
  const render = (account: AccountInfo): void => {
    if (!account.signedIn) {
      item.text = `$(account) ${t('host.status.signIn')}`;
      item.tooltip = t('host.status.signInTooltip');
      item.command = 'gisoo.signIn';
      item.backgroundColor = undefined;
    } else {
      const balance = account.balanceDisplay ?? (account.balanceUsd === undefined ? undefined : formatUsd(account.balanceUsd));
      const shown = getSettings().showCost && balance ? balance : '';
      item.text = `$(account) Gisoo ${shown}`.trimEnd();
      item.tooltip = account.error ? t('host.status.errorTooltip', account.error) : t('host.status.balanceTooltip', balance ?? '-');
      item.command = 'gisoo.showAccount';
      item.backgroundColor = account.error ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    }
    item.show();
  };
  render(auth.getAccount());
  const subs = [
    auth.onDidChange(render),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gisoo.showCost') || e.affectsConfiguration('gisoo.language')) render(auth.getAccount());
    }),
  ];
  return {
    dispose: () => {
      subs.forEach((s) => s.dispose());
      item.dispose();
    },
  };
}
