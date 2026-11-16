/**
 * Where VS Code and its forks keep user data, per platform. Several tools store their chats there:
 * `User/workspaceStorage/<hash>/chatSessions` (Copilot Chat) and `User/globalStorage/<extension>/tasks`
 * (Cline, Roo Code, Kilo Code). Read-only.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { asRecord, asString } from './lines';

/** The folder that holds the per-product data folders (`Code`, `Cursor`, ...). */
export function appDataRoot(home: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform === 'win32') return env.APPDATA?.trim() || path.join(home, 'AppData', 'Roaming');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  return env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config');
}

/** `<root>/<product>/User` for each product name. */
export function userDataDirs(home: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, products: readonly string[]): string[] {
  const root = appDataRoot(home, env, platform);
  return products.map((name) => path.join(root, name, 'User'));
}

/** Editors whose Copilot Chat history uses the VS Code layout. */
export const COPILOT_PRODUCTS = ['Code', 'Code - Insiders', 'VSCodium'] as const;
/** VS Code and forks where Cline-style extensions can be installed. */
export const EXTENSION_HOST_PRODUCTS = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor', 'Windsurf', 'Antigravity'] as const;

/** A `file://` URI as a local path (`file:///c%3A/Projects/x` -> `c:/Projects/x`); undefined for other schemes. */
export function fileUriToPath(uri: string): string | undefined {
  if (!/^file:\/\//i.test(uri)) return undefined;
  let rest = uri.slice('file://'.length);
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return undefined;
  }
  if (/^\/[A-Za-z]:/.test(rest)) rest = rest.slice(1);
  // `file://server/share` is a UNC path
  else if (!rest.startsWith('/')) rest = `//${rest}`;
  return rest;
}

/** The folder a `workspaceStorage/<hash>` entry belongs to (`workspace.json`), when it is a local folder. */
export async function workspaceFolder(hashDir: string): Promise<string | undefined> {
  try {
    const text = await fs.readFile(path.join(hashDir, 'workspace.json'), 'utf8');
    if (text.length > 64 * 1024) return undefined;
    const folder = asString(asRecord(JSON.parse(text))?.folder);
    return folder ? fileUriToPath(folder) : undefined;
  } catch {
    return undefined;
  }
}
