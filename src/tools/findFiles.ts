import * as vscode from 'vscode';
import { relativeToWorkspace } from './workspace';
import type { Tool } from './types';

interface Input {
  pattern: string;
}

export const MAX_FILES = 500;

export const findFilesTool: Tool<Input> = {
  name: 'find_files',
  description: 'Find files by glob pattern across the workspace (e.g. "src/**/*.ts", "**/package.json"). Honours files.exclude. Max 500 results.',
  permission: 'read',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: { pattern: { type: 'string', description: 'Glob pattern, workspace-relative' } },
    required: ['pattern'],
    additionalProperties: false,
  },
  title: (input) => `Find files ${input.pattern}`,
  async run(input) {
    const pattern = (input.pattern ?? '').trim();
    if (!pattern) return { content: 'pattern is required', isError: true };
    const glob = pattern.includes('/') || pattern.includes('*') ? pattern : `**/${pattern}`;
    const uris = await vscode.workspace.findFiles(glob, '**/node_modules/**', MAX_FILES);
    if (!uris.length) return { content: `No files match ${pattern}` };
    const paths = uris.map((u) => relativeToWorkspace(u.fsPath)).sort();
    const note = uris.length >= MAX_FILES ? `\n[first ${MAX_FILES} matches shown; narrow the pattern]` : '';
    return { content: paths.join('\n') + note, display: `${paths.length} files` };
  },
};
