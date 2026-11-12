import * as vscode from 'vscode';
import { readText, relativeToWorkspace } from './workspace';
import type { Tool } from './types';

interface Input {
  query: string;
  is_regex?: boolean;
  include?: string;
}

export const MAX_HITS = 200;
const MAX_FILE_BYTES = 1_000_000;
const MAX_FILES_SCANNED = 5_000;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const searchTextTool: Tool<Input> = {
  name: 'search_text',
  description:
    'Search file contents across the workspace (literal by default, regex with is_regex). Optional include glob such as "src/**/*.ts". Returns path:line: text, max 200 hits.',
  permission: 'read',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text or regular expression to find' },
      is_regex: { type: 'boolean', description: 'Treat query as a JavaScript regular expression' },
      include: { type: 'string', description: 'Glob of files to search, e.g. "**/*.php"' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  title: (input) => `Search "${input.query}"${input.include ? ` in ${input.include}` : ''}`,
  async run(input, ctx) {
    const query = input.query ?? '';
    if (!query) return { content: 'query is required', isError: true };
    let re: RegExp;
    try {
      re = new RegExp(input.is_regex ? query : escapeRegex(query), 'i');
    } catch (err) {
      return { content: `Invalid regular expression: ${(err as Error).message}`, isError: true };
    }
    const include = input.include?.trim() || '**/*';
    const uris = await vscode.workspace.findFiles(include, '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/*.min.*}', MAX_FILES_SCANNED);
    const hits: string[] = [];
    let filesWithHits = 0;
    for (const uri of uris) {
      if (ctx.signal.aborted) break;
      if (hits.length >= MAX_HITS) break;
      let text: string | null;
      try {
        const st = await vscode.workspace.fs.stat(uri);
        if (st.size > MAX_FILE_BYTES) continue;
        text = await readText(uri.fsPath);
      } catch {
        continue;
      }
      if (text === null) continue;
      const lines = text.split('\n');
      let any = false;
      for (let i = 0; i < lines.length && hits.length < MAX_HITS; i++) {
        if (re.test(lines[i])) {
          any = true;
          hits.push(`${relativeToWorkspace(uri.fsPath)}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
        }
      }
      if (any) filesWithHits++;
    }
    if (!hits.length) return { content: `No matches for "${query}"` };
    const note = hits.length >= MAX_HITS ? `\n[first ${MAX_HITS} hits shown; narrow the query or include]` : '';
    return { content: hits.join('\n') + note, display: `${hits.length} hits in ${filesWithHits} files` };
  },
};
