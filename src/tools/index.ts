import type { PermissionMode } from '../shared/protocol';
import { askUserTool } from './askUser';
import { editFileTool } from './editFile';
import { findFilesTool } from './findFiles';
import { getDiagnosticsTool } from './getDiagnostics';
import { listDirectoryTool } from './listDirectory';
import { readFileTool } from './readFile';
import { runCommandTool } from './runCommand';
import { searchTextTool } from './searchText';
import { todoWriteTool } from './todoWrite';
import { availableUntrusted } from './permissions';
import { toDefinition } from './types';
import type { Tool } from './types';
import { webFetchTool } from './webFetch';
import { writeFileTool } from './writeFile';
import { previewTool, screenshotTool } from '../preview/tools';
import { definitionTool, referencesTool, symbolsTool } from './codeIntel';
import { gitTool } from './git';
import { projectMapTool } from './projectMap';

export {
  askUserTool,
  definitionTool,
  editFileTool,
  findFilesTool,
  getDiagnosticsTool,
  gitTool,
  listDirectoryTool,
  previewTool,
  projectMapTool,
  readFileTool,
  referencesTool,
  runCommandTool,
  screenshotTool,
  searchTextTool,
  symbolsTool,
  todoWriteTool,
  webFetchTool,
  writeFileTool,
};

/** Extra flags a registered tool may carry; phase-2 tools set them explicitly. */
export interface ToolFlags {
  /** Safe to run in parallel and in plan mode. Defaults to tool.readOnly. */
  readOnly?: boolean;
  /** Always goes through the approval card, whatever the permission mode. Defaults from tool.permission. */
  needsApproval?: boolean;
}

export interface RegisteredTool {
  tool: Tool;
  readOnly: boolean;
  needsApproval: boolean;
}

export interface ToolVisibility {
  mode: PermissionMode;
  webFetchEnabled: boolean;
  /** Untrusted workspace: no command tool and every edit needs approval (enforced by the agent). */
  workspaceTrusted: boolean;
}

/** Widens a typed tool to the registry's `Tool<Record<string, unknown>>` (inputs are validated by each tool). */
const asTool = <T,>(tool: Tool<T>): Tool => tool as unknown as Tool;

const BUILTIN: Tool[] = [
  asTool(readFileTool),
  asTool(listDirectoryTool),
  asTool(findFilesTool),
  asTool(searchTextTool),
  asTool(getDiagnosticsTool),
  asTool(writeFileTool),
  asTool(editFileTool),
  asTool(runCommandTool),
  asTool(todoWriteTool),
  asTool(askUserTool),
  asTool(webFetchTool),
  asTool(symbolsTool),
  asTool(definitionTool),
  asTool(referencesTool),
  asTool(projectMapTool),
  asTool(gitTool),
  asTool(previewTool),
  asTool(screenshotTool),
];

const registry = new Map<string, RegisteredTool>();
const listeners = new Set<() => void>();

function defaultNeedsApproval(tool: Tool): boolean {
  return tool.permission === 'edit' || tool.permission === 'command';
}

/** Register a tool at activation (built-ins are registered on import; phase-2 tools call this too). */
export function registerTool(tool: Tool, flags: ToolFlags = {}): () => void {
  const entry: RegisteredTool = {
    tool,
    readOnly: flags.readOnly ?? tool.readOnly,
    needsApproval: flags.needsApproval ?? defaultNeedsApproval(tool),
  };
  registry.set(tool.name, entry);
  for (const l of listeners) l();
  return () => {
    if (registry.get(tool.name) === entry) {
      registry.delete(tool.name);
      for (const l of listeners) l();
    }
  };
}

/** web_fetch is read-only but sends a URL the model chose to the internet, so each call is approved. */
for (const tool of BUILTIN) registerTool(tool, tool.name === 'web_fetch' ? { needsApproval: true } : {});

export function onToolsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function allTools(): RegisteredTool[] {
  return [...registry.values()];
}

export const ALL_TOOLS: Tool[] = BUILTIN;

export function toolByName(name: string): RegisteredTool | undefined {
  return registry.get(name);
}

/** Registered tools the agent registry reports as callable for this visibility (used by sub-agents too). */
export function isToolVisible(name: string, v: ToolVisibility): boolean {
  return visibleTools(v).some((entry) => entry.tool.name === name);
}

/** The tools exposed to the model for this run. Plan mode = read-only + todo_write + ask_user. */
export function visibleTools(v: ToolVisibility): RegisteredTool[] {
  return allTools().filter((entry) => {
    const { tool } = entry;
    if (tool.name === 'web_fetch' && !v.webFetchEnabled) return false;
    if (!v.workspaceTrusted && !availableUntrusted(tool)) return false;
    if (v.mode === 'plan') return entry.readOnly || tool.permission === 'none';
    return true;
  });
}

export function toolDefinitions(v: ToolVisibility) {
  return visibleTools(v).map((entry) => toDefinition(entry.tool));
}
