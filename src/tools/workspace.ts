/** VS Code workspace helpers shared by the tools. */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PathGuardError, resolveWorkspacePath, type ResolvedPath } from './pathGuard';

export function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

export function primaryRoot(): string | undefined {
  return workspaceRoots()[0];
}

export function resolvePath(input: string): Promise<ResolvedPath> {
  return resolveWorkspacePath(input, workspaceRoots(), (p) => fs.realpath(p));
}

/** Folders outside the workspace that read_file may read (loaded skill folders, SPEC-phase2 §7). */
const extraReadRoots = new Set<string>();

export function addReadRoot(dir: string): void {
  extraReadRoots.add(path.resolve(dir));
}

export function readRoots(): string[] {
  return [...extraReadRoots];
}

/** Like resolvePath, but an absolute path inside an extra read root is accepted too (reads only). */
export async function resolveReadPath(input: string): Promise<ResolvedPath> {
  try {
    return await resolvePath(input);
  } catch (error) {
    if (!(error instanceof PathGuardError) || error.reason === 'git' || error.reason === 'empty' || !extraReadRoots.size) throw error;
    const raw = input.trim().replace(/^["']|["']$/g, '');
    if (!(path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw))) throw error;
    try {
      const resolved = await resolveWorkspacePath(raw, readRoots(), (p) => fs.realpath(p));
      return { ...resolved, relative: resolved.absolute };
    } catch {
      throw error;
    }
  }
}

export function relativeToWorkspace(absolute: string): string {
  for (const root of workspaceRoots()) {
    const rel = path.relative(root, absolute);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
    if (rel === '') return '.';
  }
  return absolute;
}

/** Reads the current text of a file, preferring an open (possibly dirty) editor document. */
export async function readText(absolute: string): Promise<string | null> {
  const uri = vscode.Uri.file(absolute);
  const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
  if (open) return open.getText();
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (looksBinary(bytes)) throw new Error(`"${relativeToWorkspace(absolute)}" looks like a binary file.`);
    return new TextDecoder('utf-8').decode(bytes);
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') return null;
    if (err instanceof Error && /binary/.test(err.message)) throw err;
    const code = (err as { code?: string }).code;
    if (code === 'FileNotFound' || code === 'ENOENT') return null;
    throw err;
  }
}

export async function stat(absolute: string): Promise<vscode.FileStat | undefined> {
  try {
    return await vscode.workspace.fs.stat(vscode.Uri.file(absolute));
  } catch {
    return undefined;
  }
}

/** Writes through WorkspaceEdit so the change is undoable and open editors stay in sync. */
export async function writeText(absolute: string, content: string, isNewFile: boolean): Promise<void> {
  const uri = vscode.Uri.file(absolute);
  const edit = new vscode.WorkspaceEdit();
  if (isNewFile) {
    edit.createFile(uri, { ignoreIfExists: true });
    edit.insert(uri, new vscode.Position(0, 0), content);
  } else {
    const doc = await vscode.workspace.openTextDocument(uri);
    const full = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    edit.replace(uri, full, content);
  }
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) throw new Error(`VS Code refused the edit to ${relativeToWorkspace(absolute)}.`);
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
  if (doc?.isDirty) await doc.save();
}

export async function deleteFile(absolute: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.deleteFile(vscode.Uri.file(absolute), { ignoreIfNotExists: true });
  await vscode.workspace.applyEdit(edit);
}

function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export function formatWithLineNumbers(text: string, startLine = 1): string {
  const lines = text.split('\n');
  const width = String(startLine + lines.length - 1).length;
  return lines.map((l, i) => `${String(startLine + i).padStart(width, ' ')}\t${l.replace(/\r$/, '')}`).join('\n');
}
