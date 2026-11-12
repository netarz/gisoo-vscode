/**
 * ContextProvider: the VS Code side of SPEC-phase2 §1–3 and §7. Loads instruction files, memory
 * stores, custom commands and the skills catalogue; watches for changes (save, trust, settings,
 * folders); builds the prompt sections; and reports the loaded files to the webview.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ContextFileInfo, HostToWebview, SlashCommandInfo } from '../shared/protocol';
import { addReadRoot, primaryRoot, relativeToWorkspace, workspaceRoots } from '../tools/workspace';
import { loadSkills, skillsPromptSection, type Skill } from '../skills/catalog';
import { readInstalled } from '../skills/install';
import { claudeMemoryStore } from './claude';
import { commandInfos, loadCustomCommands, type CustomCommand } from './commands';
import { instructionsPromptSection, loadInstructionFiles, type InstructionFile } from './instructions';
import { MemoryStore, memoryDir, memoryPromptSection, memoryTokens, projectMemoryDir, quickMemoryFrom, type MemoryStores, type QuickMemory } from './memory';

export interface ContextProviderDeps {
  post: (message: HostToWebview) => void;
  compatClaude: () => boolean;
  homeDir?: string;
}

const WATCH_GLOB = '**/{GISOO.md,GISOO.local.md,CLAUDE.md,CLAUDE.local.md,AGENTS.md,.cursorrules,.windsurfrules,.gisoo/**,.claude/**,.agents/**,.codex/**,.github/copilot-instructions.md}';
const RELOAD_DEBOUNCE_MS = 400;

export class ContextProvider implements vscode.Disposable {
  private instructions: InstructionFile[] = [];
  private commands: CustomCommand[] = [];
  private skills: Skill[] = [];
  private memoryStores: MemoryStores | undefined;
  private memoryIndexes: Array<{ store: MemoryStore; index: string; mtime: number }> = [];
  private loading: Promise<void> | undefined;
  private loadedAt = 0;
  private dirty = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly subs: vscode.Disposable[] = [];
  private readonly homeDir: string;
  private readonly reloadEmitter = new vscode.EventEmitter<void>();
  /** Fires after every load (the controller re-sends the slash command list). */
  readonly onDidReload = this.reloadEmitter.event;

  constructor(private readonly deps: ContextProviderDeps) {
    this.homeDir = deps.homeDir ?? os.homedir();
    const watcher = vscode.workspace.createFileSystemWatcher(WATCH_GLOB);
    this.subs.push(
      watcher,
      this.reloadEmitter,
      watcher.onDidChange(() => this.scheduleReload()),
      watcher.onDidCreate(() => this.scheduleReload()),
      watcher.onDidDelete(() => this.scheduleReload()),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (this.isContextFile(doc.uri.fsPath)) this.scheduleReload();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.scheduleReload()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleReload()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('gisoo.compat.claude')) this.scheduleReload();
      }),
    );
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const s of this.subs.splice(0)) s.dispose();
  }

  // -- Loading --------------------------------------------------------------------------------------

  /** Loads everything (once at a time); later calls while loading wait for the same load. */
  reload(): Promise<void> {
    if (!this.loading) {
      this.dirty = false;
      this.loading = this.load().finally(() => {
        this.loading = undefined;
      });
    }
    return this.loading;
  }

  /** Loads when something changed since the last load (also checks the memory index mtimes). */
  async refreshIfChanged(): Promise<void> {
    if (this.dirty || !this.loadedAt) {
      await this.reload();
      return;
    }
    for (const part of this.memoryIndexes) {
      if ((await part.store.indexMtime()) !== part.mtime) {
        await this.reload();
        return;
      }
    }
  }

  private scheduleReload(): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.reload();
    }, RELOAD_DEBOUNCE_MS);
  }

  private async load(): Promise<void> {
    const roots = workspaceRoots();
    const trusted = vscode.workspace.isTrusted;
    const compat = this.deps.compatClaude();
    const editor = vscode.window.activeTextEditor;
    const activeFile = editor?.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
    try {
      this.instructions = await loadInstructionFiles({ workspaceRoots: roots, activeFile, homeDir: this.homeDir, compatClaude: compat, workspaceTrusted: trusted });
    } catch {
      this.instructions = [];
    }
    this.memoryStores = await this.buildMemoryStores(trusted, compat);
    this.memoryIndexes = [];
    for (const store of [this.memoryStores.gisoo, this.memoryStores.project, this.memoryStores.claude]) {
      if (!store) continue;
      try {
        this.memoryIndexes.push({ store, index: await store.readIndex(), mtime: await store.indexMtime() });
      } catch {
        this.memoryIndexes.push({ store, index: '', mtime: 0 });
      }
    }
    try {
      this.commands = await loadCustomCommands({ workspaceRoots: roots, homeDir: this.homeDir, compatClaude: compat, workspaceTrusted: trusted });
    } catch {
      this.commands = [];
    }
    try {
      const disabledDirs = (await readInstalled(this.homeDir)).filter((r) => r.disabled).map((r) => r.dir);
      this.skills = await loadSkills({ workspaceRoots: roots, homeDir: this.homeDir, compatClaude: compat, workspaceTrusted: trusted, disabledDirs });
    } catch {
      this.skills = [];
    }
    this.loadedAt = Date.now();
    this.postState();
    this.reloadEmitter.fire();
  }

  private async buildMemoryStores(trusted: boolean, compat: boolean): Promise<MemoryStores> {
    const root = primaryRoot() ?? '';
    const folderKey = root || 'no-workspace';
    const stores: MemoryStores = {
      gisoo: new MemoryStore({ dir: memoryDir(this.homeDir, folderKey), source: 'gisoo', label: 'Gisoo memory', writable: true }),
    };
    if (root && trusted) {
      const dir = projectMemoryDir(root);
      if (await isDirectory(dir)) stores.project = new MemoryStore({ dir, source: 'project', label: 'Project memory (.gisoo/memory)', writable: true });
    }
    if (root && compat) {
      const claude = claudeMemoryStore(this.homeDir, root);
      if (await claude.exists()) stores.claude = claude;
    }
    return stores;
  }

  private isContextFile(file: string): boolean {
    const base = path.basename(file);
    if (/^(GISOO|CLAUDE|AGENTS)(\.local)?\.md$/i.test(base) || base === '.cursorrules' || base === '.windsurfrules') return true;
    const parts = file.split(/[\\/]/);
    if (parts.some((p) => p === '.gisoo' || p === '.claude' || p === '.agents' || p === '.codex')) return true;
    return /copilot-instructions\.md$/i.test(file);
  }

  // -- Accessors ------------------------------------------------------------------------------------

  stores(): MemoryStores {
    if (!this.memoryStores) {
      const root = primaryRoot() ?? 'no-workspace';
      this.memoryStores = { gisoo: new MemoryStore({ dir: memoryDir(this.homeDir, root), source: 'gisoo', label: 'Gisoo memory', writable: true }) };
    }
    return this.memoryStores;
  }

  skillList(): readonly Skill[] {
    return this.skills;
  }

  customCommands(): readonly CustomCommand[] {
    return this.commands;
  }

  slashCommands(): SlashCommandInfo[] {
    return commandInfos(this.commands);
  }

  instructionFiles(): readonly InstructionFile[] {
    return this.instructions;
  }

  /** The `context` message payload: instruction files and memory indexes with token estimates. */
  contextFiles(): ContextFileInfo[] {
    const files: ContextFileInfo[] = this.instructions.map((f) => ({ kind: 'instructions', scope: f.scope, label: f.label, path: f.path, tokens: f.tokens }));
    for (const part of this.memoryIndexes) {
      if (!part.index.trim()) continue;
      files.push({ kind: 'memory', scope: part.store.source === 'project' ? 'project' : 'user', label: part.store.label, path: part.store.indexPath, tokens: memoryTokens(part.index) });
    }
    return files;
  }

  /** Prompt text appended after the built-in sections: instructions, memory, skills. */
  promptSections(): string {
    const parts = [
      instructionsPromptSection(this.instructions, relativeToWorkspace),
      memoryPromptSection(this.memoryIndexes.map((p) => ({ store: p.store, index: p.index }))),
      skillsPromptSection(this.skills),
    ].filter((s) => s.trim());
    return parts.join('\n\n');
  }

  postState(): void {
    this.deps.post({ type: 'context', files: this.contextFiles() });
  }

  // -- Memory actions -------------------------------------------------------------------------------

  /** `#text` from the chat: saves a memory file in the Gisoo store and returns its name. */
  async quickMemory(text: string): Promise<QuickMemory & { path: string }> {
    const quick = quickMemoryFrom(text);
    if (!quick) throw new Error('empty');
    const { path: file } = await this.stores().gisoo.write(quick.name, quick.body, { description: quick.description, type: quick.type });
    this.dirty = true;
    return { ...quick, path: file };
  }

  /** Opens MEMORY.md in an editor, creating it when missing. */
  async openMemory(): Promise<string> {
    const store = this.stores().gisoo;
    const file = await store.ensureIndex();
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(doc, { preview: false });
    return file;
  }

  /** Memory tool hook: a loaded skill folder may be read by read_file. */
  allowSkillReads(skill: Skill): void {
    addReadRoot(skill.dir);
  }

  markDirty(): void {
    this.dirty = true;
  }
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.lstat(dir)).isDirectory();
  } catch {
    return false;
  }
}
