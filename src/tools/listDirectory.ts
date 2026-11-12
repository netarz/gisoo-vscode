import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolvePath } from './workspace';
import type { Tool } from './types';

interface Input {
  path: string;
  depth?: number;
}

const MAX_ENTRIES = 800;
const ALWAYS_SKIP = new Set(['.git', 'node_modules', '.hg', '.svn']);

export const listDirectoryTool: Tool<Input> = {
  name: 'list_directory',
  description: 'List files and folders under a workspace path as a tree. Honours .gitignore and files.exclude. Default depth 2, max 6.',
  permission: 'read',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative folder path; "." for the root' },
      depth: { type: 'integer', minimum: 1, maximum: 6, description: 'How many levels deep (default 2)' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  title: (input) => `List ${input.path || '.'}`,
  async run(input) {
    const resolved = await resolvePath(input.path || '.');
    const depth = Math.min(6, Math.max(1, Math.floor(input.depth ?? 2)));
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(resolved.absolute));
    if (!folder) return { content: `Not inside a workspace folder: ${input.path}`, isError: true };
    const base = resolved.relative === '.' ? '' : `${resolved.relative}/`;
    const pattern = new vscode.RelativePattern(folder, `${base}**/*`);
    const uris = await vscode.workspace.findFiles(pattern, undefined, 20_000);
    // Build a tree of relative paths under the base, limited to `depth` levels.
    const tree = new Map<string, Set<string>>();
    const addPath = (parts: string[]): void => {
      for (let i = 0; i < Math.min(parts.length, depth); i++) {
        const parent = parts.slice(0, i).join('/');
        const name = i === parts.length - 1 ? parts[i] : `${parts[i]}/`;
        let set = tree.get(parent);
        if (!set) {
          set = new Set();
          tree.set(parent, set);
        }
        set.add(name);
      }
    };
    let count = 0;
    for (const uri of uris) {
      const rel = path.relative(resolved.absolute, uri.fsPath).split(path.sep);
      if (rel.some((p) => ALWAYS_SKIP.has(p))) continue;
      addPath(rel);
      if (++count >= MAX_ENTRIES * 10) break;
    }
    const lines: string[] = [`${resolved.relative}/`];
    let shown = 0;
    const walk = (parent: string, indent: string): void => {
      const entries = [...(tree.get(parent) ?? [])].sort((a, b) => Number(b.endsWith('/')) - Number(a.endsWith('/')) || a.localeCompare(b));
      for (const name of entries) {
        if (shown++ >= MAX_ENTRIES) return;
        lines.push(`${indent}${name}`);
        if (name.endsWith('/')) walk(parent ? `${parent}/${name.slice(0, -1)}` : name.slice(0, -1), `${indent}  `);
      }
    };
    walk('', '  ');
    if (shown > MAX_ENTRIES) lines.push(`[list truncated at ${MAX_ENTRIES} entries]`);
    if (lines.length === 1) lines.push('  (empty or everything is excluded)');
    return { content: lines.join('\n'), display: `${Math.min(shown, MAX_ENTRIES)} entries` };
  },
};
