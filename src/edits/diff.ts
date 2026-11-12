/** Virtual documents (scheme gisoo-diff) and vscode.diff for reviewing a proposed edit. */
import * as vscode from 'vscode';

export const DIFF_SCHEME = 'gisoo-diff';

export class DiffProvider implements vscode.TextDocumentContentProvider {
  private readonly docs = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  register(): vscode.Disposable {
    return vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, this);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.docs.get(uri.toString()) ?? '';
  }

  /** Stores both sides and returns their URIs. `relativePath` keeps the language highlighting. */
  put(callId: string, relativePath: string, before: string, after: string): { left: vscode.Uri; right: vscode.Uri } {
    const left = vscode.Uri.from({ scheme: DIFF_SCHEME, path: `/${callId}/before/${relativePath}`, query: callId });
    const right = vscode.Uri.from({ scheme: DIFF_SCHEME, path: `/${callId}/after/${relativePath}`, query: callId });
    this.docs.set(left.toString(), before);
    this.docs.set(right.toString(), after);
    this.emitter.fire(left);
    this.emitter.fire(right);
    return { left, right };
  }

  async open(callId: string, relativePath: string, before: string, after: string, title?: string): Promise<void> {
    const { left, right } = this.put(callId, relativePath, before, after);
    await vscode.commands.executeCommand('vscode.diff', left, right, title ?? `Gisoo: ${relativePath}`, { preview: true });
  }

  forget(callId: string): void {
    for (const key of [...this.docs.keys()]) if (key.includes(`/${callId}/`)) this.docs.delete(key);
  }

  dispose(): void {
    this.docs.clear();
    this.emitter.dispose();
  }
}
