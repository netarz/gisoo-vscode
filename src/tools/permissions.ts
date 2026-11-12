/** Permission decisions for tool calls. Pure. */
import type { PermissionMode } from '../shared/protocol';

export type ToolPermission = 'read' | 'edit' | 'command' | 'none';
export type Decision = 'allow' | 'ask' | 'deny';

export interface PermissionSettings {
  mode: PermissionMode;
  /** Allowed command prefixes, e.g. ["npm test", "git status"]. */
  allowedCommands: readonly string[];
  /** Session-level "Always allow <first word>" grants. */
  sessionAllowed?: readonly string[];
  webFetchEnabled?: boolean;
}

/** Patterns that always ask, even when the prefix is allowed. */
export const DANGEROUS_PATTERNS: readonly RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b.*(\s\/(\s|$)|\s~\/?(\s|$)|\s\*|\s\.\.?(\s|$))/i,
  /\brm\s+-[a-z]*r[a-z]*\s+\/(\s|$)/i,
  /\b(rmdir|rd)\s+\/s\b/i,
  /\bdel\s+.*\/[sq]\b/i,
  /\bformat(\.com)?\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bgit\s+push\b.*(--force|-f\b|\+)/i,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s+\.|branch\s+-D)\b/i,
  /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|k|da)?sh\b/i,
  /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(python|node|perl|pwsh|powershell)\b/i,
  /\bsudo\b/i,
  /\bchmod\s+(-R\s+)?[0-7]*777\b/i,
  /\bshutdown\b|\breboot\b|\bhalt\b/i,
  /\b(drop\s+(database|table)|truncate\s+table)\b/i,
  /\bnpm\s+publish\b|\bvsce\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /\bRemove-Item\b.*-Recurse\b.*-Force\b/i,
  />\s*\/dev\/sd[a-z]/i,
];

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((re) => re.test(command));
}

/** First word of the command, used for "Always allow <word>". */
export function commandPrefixWord(command: string): string {
  const trimmed = command.trim();
  const match = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(\S+)/.exec(trimmed);
  return match ? match[1] : trimmed;
}

/** Normalises a command for prefix matching (collapses whitespace). */
function normalise(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

export function commandMatchesAllowed(command: string, allowed: readonly string[]): boolean {
  const cmd = normalise(command);
  return allowed.some((prefix) => {
    const p = normalise(prefix);
    if (!p) return false;
    return cmd === p || cmd.startsWith(`${p} `);
  });
}

/** Commands chained with ; && || | must each be allowed. */
export function splitCommandChain(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Shell syntax that can run a second program or touch files behind an allowed prefix: line breaks,
 * a lone `&` (cmd.exe chaining, background jobs), redirection, backticks, `$(...)`, `${...}` and
 * parentheses (subshells, PowerShell sub-expressions). Such commands are never auto-allowed.
 */
export function hasShellControl(command: string): boolean {
  return /[\r\n\0`<>()]|\$\{|\$\(|(?<!&)&(?!&)/.test(command);
}

export function decide(permission: ToolPermission, settings: PermissionSettings, command?: string): Decision {
  if (permission === 'none' || permission === 'read') return 'allow';
  if (settings.mode === 'plan') return 'deny';
  if (permission === 'edit') return settings.mode === 'autoEdit' ? 'allow' : 'ask';
  // command
  const cmd = command ?? '';
  if (!cmd.trim()) return 'deny';
  if (isDangerousCommand(cmd) || hasShellControl(cmd)) return 'ask';
  const allowed = [...settings.allowedCommands, ...(settings.sessionAllowed ?? [])];
  const parts = splitCommandChain(cmd);
  if (parts.length && parts.every((p) => commandMatchesAllowed(p, allowed))) return 'allow';
  return 'ask';
}

/**
 * Tools that start a program inside the workspace are hidden when the workspace is not trusted:
 * every `command` tool (run_command; screenshot opens a browser that runs page scripts) and `git`,
 * whose repository config (core.fsmonitor, core.pager and friends) can name a program to run.
 */
export const UNTRUSTED_HIDDEN_TOOLS: readonly string[] = ['git'];

export function availableUntrusted(tool: { name: string; permission: ToolPermission }): boolean {
  return tool.permission !== 'command' && !UNTRUSTED_HIDDEN_TOOLS.includes(tool.name);
}

export const PLAN_MODE_DENIAL = 'Plan mode: only read-only tools are allowed. Write the plan with todo_write and stop.';
