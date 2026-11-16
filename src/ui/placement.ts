/**
 * Where the side-panel chat lives: the right-hand secondary sidebar (default, VS Code 1.106+), the
 * left activity bar, or the bottom panel. Each location has its own view ids; `gisoo.chatLocation`
 * picks which ones are visible (see the `when` clauses in package.json).
 */
import * as vscode from 'vscode';

export type ChatLocation = 'right' | 'left' | 'bottom';

export const CHAT_VIEW_ID = 'gisoo.chat';

export const CHAT_VIEWS: Record<ChatLocation, string> = {
  left: 'gisoo.chat',
  right: 'gisoo.chatSecondary',
  bottom: 'gisoo.chatPanel',
};

export const AGENT_VIEWS: Record<ChatLocation, string> = {
  left: 'gisoo.agents',
  right: 'gisoo.agentsSecondary',
  bottom: 'gisoo.agentsPanel',
};

/** The secondary sidebar accepts extension views from VS Code 1.106. */
export function hasSecondarySidebar(version: string = vscode.version): boolean {
  const [major, minor] = version.split('.').map((n) => parseInt(n, 10));
  return major > 1 || (major === 1 && minor >= 106);
}

export function chatLocation(): ChatLocation {
  const value = vscode.workspace.getConfiguration('gisoo').get<string>('chatLocation', 'right');
  const loc: ChatLocation = value === 'left' || value === 'bottom' ? value : 'right';
  return loc === 'right' && !hasSecondarySidebar() ? 'left' : loc;
}

export function chatViewId(): string {
  return CHAT_VIEWS[chatLocation()];
}

export function agentsViewId(): string {
  return AGENT_VIEWS[chatLocation()];
}

export async function moveChat(to: ChatLocation): Promise<void> {
  await vscode.workspace.getConfiguration('gisoo').update('chatLocation', to, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand(`${CHAT_VIEWS[to === 'right' && !hasSecondarySidebar() ? 'left' : to]}.focus`);
}
