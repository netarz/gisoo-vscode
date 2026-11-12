/** Code intelligence through the language servers (SPEC-phase2 §5): symbols, definition, references. */
import * as vscode from 'vscode';
import { TOOL_RESULT_MAX_CHARS } from './types';
import type { Tool } from './types';
import { relativeToWorkspace, resolvePath } from './workspace';

export const MAX_SYMBOLS = 400;
export const MAX_LOCATIONS = 200;

interface SymbolsInput {
  path?: string;
  query?: string;
}

interface PositionInput {
  path: string;
  line: number;
  character?: number;
}

function kindName(kind: vscode.SymbolKind): string {
  return (vscode.SymbolKind[kind] ?? 'Symbol').toLowerCase();
}

function flattenSymbols(items: vscode.DocumentSymbol[], depth: number, out: string[]): void {
  for (const s of items) {
    if (out.length >= MAX_SYMBOLS) return;
    const line = s.selectionRange.start.line + 1;
    const detail = s.detail ? ` ${s.detail.replace(/\s+/g, ' ').slice(0, 80)}` : '';
    out.push(`${'  '.repeat(depth)}${kindName(s.kind)} ${s.name}${detail}  :${line}`);
    if (s.children?.length && depth < 3) flattenSymbols(s.children, depth + 1, out);
  }
}

function isDocumentSymbol(v: unknown): v is vscode.DocumentSymbol {
  return typeof v === 'object' && v !== null && 'selectionRange' in v && 'children' in v;
}

async function documentSymbols(absolute: string): Promise<string[]> {
  const uri = vscode.Uri.file(absolute);
  const result = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | vscode.SymbolInformation[] | undefined>('vscode.executeDocumentSymbolProvider', uri);
  const out: string[] = [];
  if (!result?.length) return out;
  if (isDocumentSymbol(result[0])) {
    flattenSymbols(result as vscode.DocumentSymbol[], 0, out);
  } else {
    for (const s of result as vscode.SymbolInformation[]) {
      if (out.length >= MAX_SYMBOLS) break;
      out.push(`${kindName(s.kind)} ${s.name}${s.containerName ? ` (in ${s.containerName})` : ''}  :${s.location.range.start.line + 1}`);
    }
  }
  return out;
}

/** Top-level symbol names of a file (used by project_map). */
export async function topLevelSymbolNames(absolute: string, max = 12): Promise<string[]> {
  const uri = vscode.Uri.file(absolute);
  try {
    const result = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | vscode.SymbolInformation[] | undefined>('vscode.executeDocumentSymbolProvider', uri);
    if (!result?.length) return [];
    return result.slice(0, max).map((s) => `${kindName(s.kind)} ${s.name}`);
  } catch {
    return [];
  }
}

export const symbolsTool: Tool<SymbolsInput> = {
  name: 'symbols',
  description:
    'List symbols via the language server. With path: the outline of that file (kind, name, line). With query: matching workspace symbols (name, kind, file:line). Give at least one.',
  permission: 'read',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file to outline' },
      query: { type: 'string', description: 'Symbol name (or prefix) to search across the workspace' },
    },
    additionalProperties: false,
  },
  title: (input) => (input.path ? `Symbols of ${input.path}` : `Find symbol ${input.query ?? ''}`),
  async run(input) {
    const file = (input.path ?? '').trim();
    const query = (input.query ?? '').trim();
    if (!file && !query) return { content: 'Give path (file outline) or query (workspace search).', isError: true };
    if (file) {
      const resolved = await resolvePath(file);
      const lines = await documentSymbols(resolved.absolute);
      if (!lines.length) return { content: `No symbols reported for ${resolved.relative} (no language server for this file type, or the file is empty).` };
      const note = lines.length >= MAX_SYMBOLS ? `\n[first ${MAX_SYMBOLS} symbols shown]` : '';
      return { content: `${resolved.relative}\n${lines.join('\n')}${note}`, display: `${lines.length} symbols` };
    }
    const found = (await vscode.commands.executeCommand<vscode.SymbolInformation[] | undefined>('vscode.executeWorkspaceSymbolProvider', query)) ?? [];
    if (!found.length) return { content: `No workspace symbol matches "${query}".` };
    const lines = found.slice(0, MAX_SYMBOLS).map((s) => `${kindName(s.kind)} ${s.name}${s.containerName ? ` (${s.containerName})` : ''}  ${relativeToWorkspace(s.location.uri.fsPath)}:${s.location.range.start.line + 1}`);
    const note = found.length > MAX_SYMBOLS ? `\n[${found.length - MAX_SYMBOLS} more not shown; narrow the query]` : '';
    return { content: lines.join('\n') + note, display: `${found.length} matches` };
  },
};

function toLocations(result: unknown): vscode.Location[] {
  if (!Array.isArray(result)) return [];
  const out: vscode.Location[] = [];
  for (const item of result) {
    if (item instanceof vscode.Location) out.push(item);
    else if (item && typeof item === 'object' && 'targetUri' in item) {
      const link = item as vscode.LocationLink;
      out.push(new vscode.Location(link.targetUri, link.targetSelectionRange ?? link.targetRange));
    }
  }
  return out;
}

async function lineText(uri: vscode.Uri, line: number): Promise<string> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (line < doc.lineCount) return doc.lineAt(line).text.trim().slice(0, 160);
  } catch {
    // unreadable
  }
  return '';
}

async function formatLocations(locations: vscode.Location[]): Promise<string> {
  const lines: string[] = [];
  let total = 0;
  for (const loc of locations.slice(0, MAX_LOCATIONS)) {
    const text = await lineText(loc.uri, loc.range.start.line);
    const line = `${relativeToWorkspace(loc.uri.fsPath)}:${loc.range.start.line + 1}:${loc.range.start.character + 1}${text ? `  ${text}` : ''}`;
    total += line.length + 1;
    if (total > TOOL_RESULT_MAX_CHARS) {
      lines.push('[truncated]');
      break;
    }
    lines.push(line);
  }
  if (locations.length > MAX_LOCATIONS) lines.push(`[${locations.length - MAX_LOCATIONS} more not shown]`);
  return lines.join('\n');
}

const positionParams = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Workspace-relative file' },
    line: { type: 'integer', minimum: 1, description: '1-based line of the symbol' },
    character: { type: 'integer', minimum: 1, description: '1-based column inside the symbol name (default: first non-blank)' },
  },
  required: ['path', 'line'],
  additionalProperties: false,
} as const;

async function positionOf(input: PositionInput): Promise<{ uri: vscode.Uri; position: vscode.Position; relative: string } | string> {
  const file = (input.path ?? '').trim();
  if (!file) return 'path is required';
  const line = Math.floor(Number(input.line));
  if (!Number.isFinite(line) || line < 1) return 'line must be a 1-based integer';
  const resolved = await resolvePath(file);
  const uri = vscode.Uri.file(resolved.absolute);
  const doc = await vscode.workspace.openTextDocument(uri);
  if (line > doc.lineCount) return `${resolved.relative} has ${doc.lineCount} lines.`;
  const textLine = doc.lineAt(line - 1);
  const character = input.character !== undefined && Number.isFinite(Number(input.character)) ? Math.max(0, Math.floor(Number(input.character)) - 1) : textLine.firstNonWhitespaceCharacterIndex;
  return { uri, position: new vscode.Position(line - 1, Math.min(character, Math.max(0, textLine.text.length - 1))), relative: resolved.relative };
}

export const definitionTool: Tool<PositionInput> = {
  name: 'definition',
  description: 'Go to the definition of the symbol at a position (via the language server). Returns file:line:column with the line text.',
  permission: 'read',
  readOnly: true,
  parameters: positionParams as unknown as Record<string, unknown>,
  title: (input) => `Definition at ${input.path}:${input.line}`,
  async run(input) {
    const pos = await positionOf(input);
    if (typeof pos === 'string') return { content: pos, isError: true };
    const result = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', pos.uri, pos.position);
    const locations = toLocations(result);
    if (!locations.length) return { content: `No definition found at ${pos.relative}:${input.line}.` };
    return { content: await formatLocations(locations), display: `${locations.length} location(s)` };
  },
};

export const referencesTool: Tool<PositionInput> = {
  name: 'references',
  description: 'Find all references to the symbol at a position (via the language server). Returns file:line:column with the line text, max 200.',
  permission: 'read',
  readOnly: true,
  parameters: positionParams as unknown as Record<string, unknown>,
  title: (input) => `References at ${input.path}:${input.line}`,
  async run(input) {
    const pos = await positionOf(input);
    if (typeof pos === 'string') return { content: pos, isError: true };
    const result = await vscode.commands.executeCommand('vscode.executeReferenceProvider', pos.uri, pos.position);
    const locations = toLocations(result);
    if (!locations.length) return { content: `No references found at ${pos.relative}:${input.line}.` };
    return { content: await formatLocations(locations), display: `${locations.length} reference(s)` };
  },
};
