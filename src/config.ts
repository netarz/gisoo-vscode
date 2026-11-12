/** Typed access to the `gisoo.*` settings. Reads live on every call; nothing is cached. */
import * as vscode from 'vscode';
import { isAcceptableBaseUrl, userScopeValue } from './security';
import type { PermissionMode, Region, UiLanguage } from './shared/protocol';

export interface GisooSettings {
  region: Region;
  baseUrl: string;
  model: string;
  permissionMode: PermissionMode;
  maxCostPerTask: number;
  subagentModel: string;
  maxParallelAgents: number;
  maxAgentTurns: number;
  compatClaude: boolean;
  graphifyAutoInstall: 'ask' | 'always' | 'never';
  graphifyBudget: number;
  browserPath: string;
  webFetchEnabled: boolean;
  showCost: boolean;
  language: UiLanguage;
}

export const DEFAULT_BASE_GLOBAL = 'https://gisoo.pro/api/v1';
export const DEFAULT_BASE_IRAN = 'https://ir.gisoo.pro/api/v1';

export function resolveLanguage(setting: string): UiLanguage {
  if (setting === 'en' || setting === 'fa') return setting;
  return vscode.env.language.toLowerCase().startsWith('fa') ? 'fa' : 'en';
}

/**
 * Reads a `gisoo.*` setting from the user's own settings only (workspace and folder values are
 * ignored). Used for everything that moves the API key, the approval policy, spending limits or
 * what runs on the machine, so a cloned repository's `.vscode/settings.json` cannot change them.
 */
export function userSetting<T>(key: string): T | undefined {
  return userScopeValue(vscode.workspace.getConfiguration('gisoo').inspect<T>(key));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function getSettings(): GisooSettings {
  const c = vscode.workspace.getConfiguration('gisoo');
  const rawRegion = userSetting<string>('region');
  const region: Region = rawRegion === 'ir' || rawRegion === 'iran' ? 'iran' : 'global';
  const mode = userSetting<string>('permissionMode');
  const rawBase = userSetting<string>('baseUrl');
  const graphify = userSetting<string>('graphify.autoInstall');
  const browserPath = c.inspect<string>('browserPath');
  return {
    region,
    baseUrl: typeof rawBase === 'string' ? rawBase.trim() : '',
    model: c.get<string>('model') ?? '',
    permissionMode: mode === 'autoEdit' || mode === 'plan' ? mode : 'ask',
    maxCostPerTask: Math.max(0, finite(userSetting<number>('maxCostPerTask'), 0)),
    subagentModel: c.get<string>('subagentModel') ?? '',
    maxParallelAgents: Math.min(8, Math.max(1, finite(userSetting<number>('agents.maxParallel'), 3))),
    maxAgentTurns: Math.min(100, Math.max(1, finite(userSetting<number>('agents.maxTurns'), 25))),
    compatClaude: c.get<boolean>('compat.claude') ?? true,
    graphifyAutoInstall: graphify === 'always' || graphify === 'never' ? graphify : 'ask',
    graphifyBudget: Math.min(4000, Math.max(200, c.get<number>('graphify.budget') ?? 1500)),
    browserPath: (browserPath?.globalValue ?? '').trim(),
    webFetchEnabled: userSetting<boolean>('webFetch.enabled') === true,
    showCost: c.get<boolean>('showCost') ?? true,
    language: resolveLanguage(c.get<string>('language') ?? 'auto'),
  };
}

/** The API base URL implied by the settings (custom base wins, then region). */
export function baseUrlFromSettings(s: GisooSettings = getSettings()): string {
  if (s.baseUrl && isAcceptableBaseUrl(s.baseUrl)) return s.baseUrl;
  return s.region === 'iran' ? DEFAULT_BASE_IRAN : DEFAULT_BASE_GLOBAL;
}
