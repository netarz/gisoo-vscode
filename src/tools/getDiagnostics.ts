import * as vscode from 'vscode';
import { relativeToWorkspace, resolvePath } from './workspace';
import type { Tool } from './types';

interface Input {
  path?: string;
}

const MAX_ITEMS = 300;

function severity(s: vscode.DiagnosticSeverity): string {
  switch (s) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'info';
    default:
      return 'hint';
  }
}

export const getDiagnosticsTool: Tool<Input> = {
  name: 'get_diagnostics',
  description: 'Errors and warnings VS Code currently reports (from language servers and linters), for one file or the whole workspace.',
  permission: 'read',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Workspace-relative file path; omit for all files' } },
    additionalProperties: false,
  },
  title: (input) => (input.path ? `Diagnostics for ${input.path}` : 'Diagnostics for the workspace'),
  async run(input) {
    let entries: Array<[vscode.Uri, readonly vscode.Diagnostic[]]>;
    if (input.path) {
      const resolved = await resolvePath(input.path);
      const uri = vscode.Uri.file(resolved.absolute);
      entries = [[uri, vscode.languages.getDiagnostics(uri)]];
    } else {
      entries = vscode.languages.getDiagnostics().filter(([uri]) => uri.scheme === 'file');
    }
    const lines: string[] = [];
    let errors = 0;
    let warnings = 0;
    for (const [uri, diags] of entries) {
      const sorted = [...diags].sort((a, b) => a.severity - b.severity || a.range.start.line - b.range.start.line);
      for (const d of sorted) {
        if (d.severity === vscode.DiagnosticSeverity.Hint) continue;
        if (d.severity === vscode.DiagnosticSeverity.Error) errors++;
        else if (d.severity === vscode.DiagnosticSeverity.Warning) warnings++;
        if (lines.length < MAX_ITEMS) {
          const src = d.source ? ` [${d.source}${d.code ? ` ${typeof d.code === 'object' ? d.code.value : d.code}` : ''}]` : '';
          lines.push(`${relativeToWorkspace(uri.fsPath)}:${d.range.start.line + 1}:${d.range.start.character + 1} ${severity(d.severity)}: ${d.message.replace(/\s+/g, ' ')}${src}`);
        }
      }
    }
    if (!lines.length) return { content: 'No errors or warnings.', display: 'clean' };
    if (errors + warnings > MAX_ITEMS) lines.push(`[first ${MAX_ITEMS} shown of ${errors + warnings}]`);
    return { content: lines.join('\n'), display: `${errors} errors, ${warnings} warnings` };
  },
};
