/**
 * Quick actions: Gisoo outside the chat panel. The lightbulb on a problem, the selection menu,
 * the terminal menu and the Source Control buttons all end in the same place: a message sent to
 * the chat the user last used (so approvals, checkpoints and cost work as always), except the
 * commit message, which is one small request written straight into the Source Control box.
 */
import * as vscode from 'vscode';
import type { GisooClient } from '../api/client';
import { DEFAULT_MODEL } from '../api/models';
import type { Attachment } from '../shared/protocol';
import { relativeToWorkspace } from '../tools/workspace';
import type { ChatHost } from '../ui/chatViewProvider';
import type { HostStringKey } from '../ui/strings';
import {
  cleanCommitMessage,
  clipDiff,
  commitMessages,
  explainProblemPrompt,
  fixPrompt,
  reviewPrompt,
  selectionPrompt,
  terminalPrompt,
  type ProblemInfo,
  type QuickLanguage,
  type SelectionAction,
} from './prompts';

export interface QuickDeps {
  client: GisooClient;
  signedIn: () => boolean;
  /** The chat commands act on: the active editor tab, else the side panel. */
  host: () => ChatHost;
  language: () => QuickLanguage;
  /** The chat model from the settings ('' = default). */
  model: () => string;
  t: (key: HostStringKey, ...args: Array<string | number>) => string;
}

type CommandHandler = (...args: unknown[]) => unknown;

/** What the lightbulb passes to `gisoo.fixProblem` / `gisoo.explainProblem`. */
interface ProblemArgs {
  uri: string;
  startLine: number;
  endLine: number;
  problems: ProblemInfo[];
}

const SEVERITY: Record<number, ProblemInfo['severity']> = {
  [vscode.DiagnosticSeverity.Error]: 'error',
  [vscode.DiagnosticSeverity.Warning]: 'warning',
};

function problemOf(diagnostic: vscode.Diagnostic): ProblemInfo {
  const code = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code;
  return {
    message: diagnostic.message,
    line: diagnostic.range.start.line + 1,
    source: diagnostic.source,
    code: code === undefined ? undefined : String(code),
    severity: SEVERITY[diagnostic.severity] ?? 'info',
  };
}

function isProblemArgs(value: unknown): value is ProblemArgs {
  const v = value as Partial<ProblemArgs> | undefined;
  return !!v && typeof v.uri === 'string' && typeof v.startLine === 'number' && typeof v.endLine === 'number' && Array.isArray(v.problems);
}

function rangeAttachment(uri: vscode.Uri, startLine: number, endLine: number): Attachment {
  const rel = relativeToWorkspace(uri.fsPath);
  return { kind: 'selection', path: rel, startLine, endLine, label: `${rel.split(/[\\/]/).pop() ?? rel}:${startLine}-${endLine}` };
}

/** The problems under the cursor of the active editor (used when a command runs from the palette). */
function problemsAtCursor(): ProblemArgs | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') return undefined;
  const here = vscode.languages.getDiagnostics(editor.document.uri).filter((d) => d.range.intersection(editor.selection) !== undefined);
  if (!here.length) return undefined;
  return {
    uri: editor.document.uri.toString(),
    startLine: Math.min(...here.map((d) => d.range.start.line)) + 1,
    endLine: Math.max(...here.map((d) => d.range.end.line)) + 1,
    problems: here.map(problemOf),
  };
}

/** Lightbulb entries on every problem in a file: "Fix with Gisoo" and "Explain with Gisoo". */
class GisooCodeActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly t: QuickDeps['t']) {}

  provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    if (!context.diagnostics.length) return [];
    const args: ProblemArgs = {
      uri: document.uri.toString(),
      startLine: Math.min(...context.diagnostics.map((d) => d.range.start.line)) + 1,
      endLine: Math.max(...context.diagnostics.map((d) => d.range.end.line)) + 1,
      problems: context.diagnostics.map(problemOf),
    };
    const action = (title: string, command: string): vscode.CodeAction => {
      const item = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
      item.diagnostics = [...context.diagnostics];
      item.command = { command, title, arguments: [args] };
      return item;
    };
    return [action(this.t('host.quick.fix'), 'gisoo.fixProblem'), action(this.t('host.quick.explainProblem'), 'gisoo.explainProblem')];
  }
}

// -- The built-in Git extension (only the part used here) ------------------------------------------------

interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
  diff(cached?: boolean): Promise<string>;
  log(options?: { maxEntries?: number }): Promise<Array<{ message: string }>>;
}

interface GitApi {
  repositories: GitRepository[];
}

async function gitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
  if (!extension) return undefined;
  try {
    const exports = extension.isActive ? extension.exports : await extension.activate();
    return exports.getAPI(1);
  } catch {
    return undefined; // Git is switched off in this window
  }
}

/** The repository a Source Control button was pressed on, else the one of the active file, else the only one. */
function pickRepository(api: GitApi, arg: unknown): GitRepository | undefined {
  const rootOf = (arg as { rootUri?: vscode.Uri } | undefined)?.rootUri;
  if (rootOf) {
    const hit = api.repositories.find((r) => r.rootUri.toString() === rootOf.toString());
    if (hit) return hit;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.scheme === 'file') {
    const inside = api.repositories
      .filter((r) => active.fsPath.toLowerCase().startsWith(r.rootUri.fsPath.toLowerCase()))
      .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
    if (inside) return inside;
  }
  return api.repositories[0];
}

export function registerQuickActions(deps: QuickDeps): { commands: Record<string, CommandHandler>; disposables: vscode.Disposable[] } {
  const { t } = deps;

  /** Quick actions spend the user's credit, so they need a signed-in account. */
  const requireSignIn = async (): Promise<boolean> => {
    if (deps.signedIn()) return true;
    const signIn = t('host.quick.signIn');
    const choice = await vscode.window.showInformationMessage(t('host.quick.needSignIn'), signIn);
    if (choice === signIn) await vscode.commands.executeCommand('gisoo.signIn');
    return false;
  };

  const send = async (text: string, attachments?: Attachment[]): Promise<void> => {
    if (!(await requireSignIn())) return;
    if (!(await deps.host().submit(text, attachments))) void vscode.window.showWarningMessage(t('host.quick.chatNotReady'));
  };

  const problemCommand = (build: typeof fixPrompt): CommandHandler => async (arg?: unknown) => {
    const args = isProblemArgs(arg) ? arg : problemsAtCursor();
    if (!args) {
      void vscode.window.showInformationMessage(t('host.quick.noProblem'));
      return;
    }
    const uri = vscode.Uri.parse(args.uri);
    await send(build(deps.language(), relativeToWorkspace(uri.fsPath), args.problems), [rangeAttachment(uri, args.startLine, args.endLine)]);
  };

  const selectionCommand = (action: SelectionAction): CommandHandler => async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file' || editor.selection.isEmpty) {
      void vscode.window.showInformationMessage(t('host.attach.noSelection'));
      return;
    }
    const attachment = rangeAttachment(editor.document.uri, editor.selection.start.line + 1, editor.selection.end.line + 1);
    await send(selectionPrompt(deps.language(), action), [attachment]);
  };

  /**
   * Reads the terminal selection through the clipboard (VS Code has no API for it) and puts the
   * previous clipboard text back.
   */
  const askTerminal: CommandHandler = async () => {
    const previous = await vscode.env.clipboard.readText();
    const marker = `gisoo-terminal-${Date.now()}`;
    await vscode.env.clipboard.writeText(marker);
    let selected: string;
    try {
      await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
      selected = await vscode.env.clipboard.readText();
    } finally {
      await vscode.env.clipboard.writeText(previous);
    }
    if (!selected.trim() || selected === marker) {
      void vscode.window.showInformationMessage(t('host.quick.noTerminalSelection'));
      return;
    }
    await send(terminalPrompt(deps.language(), selected));
  };

  const commitMessage: CommandHandler = async (arg?: unknown) => {
    const api = await gitApi();
    const repo = api && pickRepository(api, arg);
    if (!repo) {
      void vscode.window.showInformationMessage(t('host.quick.noRepository'));
      return;
    }
    if (!(await requireSignIn())) return;
    let staged = true;
    let diff = await repo.diff(true);
    if (!diff.trim()) {
      staged = false;
      diff = await repo.diff(false);
    }
    if (!diff.trim()) {
      void vscode.window.showInformationMessage(t('host.quick.noChanges'));
      return;
    }
    const before = repo.inputBox.value;
    if (before.trim()) {
      const replace = t('host.quick.replace');
      const choice = await vscode.window.showWarningMessage(t('host.quick.replaceConfirm'), { modal: true }, replace);
      if (choice !== replace) return;
    }
    const recent = await repo.log({ maxEntries: 8 }).then((commits) => commits.map((c) => c.message.split('\n')[0]), () => [] as string[]);
    const clipped = clipDiff(diff);
    const prompt = commitMessages(clipped.text, recent, deps.language());
    const abort = new AbortController();
    let written = false;
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t(staged ? 'host.quick.commitWorkingStaged' : 'host.quick.commitWorkingAll'), cancellable: true },
        async (_progress, token) => {
          token.onCancellationRequested(() => abort.abort());
          let text = '';
          const stream = deps.client.chat(
            {
              model: deps.model().trim() || DEFAULT_MODEL,
              messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user },
              ],
              stream: true,
              stream_options: { include_usage: true },
              max_tokens: 500,
              temperature: 0.2,
            },
            abort.signal,
          );
          for await (const event of stream) {
            if (event.kind === 'error') throw new Error(event.message);
            if (event.kind !== 'text') continue;
            text += event.text;
            // The message appears in the box while it is written.
            repo.inputBox.value = text.trimStart();
          }
          const message = cleanCommitMessage(text);
          if (!message) throw new Error(t('host.quick.commitEmpty'));
          repo.inputBox.value = message;
          written = true;
        },
      );
    } catch (error) {
      if (!written) repo.inputBox.value = before;
      if (abort.signal.aborted) return;
      throw error;
    }
    await vscode.commands.executeCommand('workbench.view.scm');
    if (clipped.clipped) void vscode.window.showInformationMessage(t('host.quick.commitClipped'));
  };

  return {
    commands: {
      'gisoo.fixProblem': problemCommand(fixPrompt),
      'gisoo.explainProblem': problemCommand(explainProblemPrompt),
      'gisoo.explainSelection': selectionCommand('explain'),
      'gisoo.refactorSelection': selectionCommand('refactor'),
      'gisoo.writeTests': selectionCommand('tests'),
      'gisoo.addDocs': selectionCommand('docs'),
      'gisoo.askTerminal': askTerminal,
      'gisoo.reviewChanges': () => send(reviewPrompt(deps.language())),
      'gisoo.commitMessage': commitMessage,
    },
    disposables: [
      vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, new GisooCodeActions(t), { providedCodeActionKinds: GisooCodeActions.kinds }),
    ],
  };
}
