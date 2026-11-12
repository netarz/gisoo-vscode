/**
 * Finds the `graphify` CLI, a usable Python (3.10+) and an installer (uv, pipx or pip) on this
 * machine (SPEC-phase2 §9). Pure Node: no VS Code, nothing is installed here.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runArgv } from '../tools/argv';

export const GRAPHIFY_PACKAGE = 'graphifyy';
export const GRAPHIFY_BIN = 'graphify';
export const MIN_PYTHON = [3, 10] as const;
const PROBE_TIMEOUT_MS = 15_000;

export interface GraphifyDetection {
  path: string;
  version: string;
}

export interface PythonDetection {
  file: string;
  /** Arguments that select Python 3 (`['-3']` for the Windows launcher). */
  args: string[];
  version: string;
}

export type InstallerKind = 'uv' | 'pipx' | 'pip';

export interface InstallPlan {
  kind: InstallerKind;
  file: string;
  args: string[];
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function exeNames(name: string, platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name] : [name];
}

/** First existing `<dir>/<name>[.exe]` across the PATH entries and `extraDirs`. */
export async function findExecutable(name: string, extraDirs: string[] = [], env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  // Relative PATH entries ('.', 'bin') would resolve inside the workspace; only absolute ones count.
  const dirs = [...(env.PATH ?? env.Path ?? '').split(path.delimiter), ...extraDirs].filter((d) => d && path.isAbsolute(d));
  for (const dir of dirs) {
    for (const file of exeNames(name)) {
      const full = path.join(dir, file);
      if (await isFile(full)) return full;
    }
  }
  return undefined;
}

/** Directories where a user-level Python tool install lands when they are not on PATH. */
export async function toolDirs(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<string[]> {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const out: string[] = [path.join(home, '.local', 'bin')];
  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    for (const dir of await subdirs(path.join(appData, 'Python'))) {
      if (/[\\/]Python\d+/i.test(dir)) out.push(path.join(dir, 'Scripts'));
    }
    out.push(path.join(env.UV_TOOL_DIR || path.join(appData, 'uv', 'tools'), GRAPHIFY_PACKAGE, 'Scripts'));
    out.push(path.join(env.PIPX_HOME || path.join(home, 'pipx'), 'venvs', GRAPHIFY_PACKAGE, 'Scripts'));
    out.push(path.join(localAppData, 'pipx', 'venvs', GRAPHIFY_PACKAGE, 'Scripts'));
    out.push(path.join(home, '.local', 'pipx', 'venvs', GRAPHIFY_PACKAGE, 'Scripts'));
  } else {
    out.push(path.join(env.UV_TOOL_DIR || path.join(home, '.local', 'share', 'uv', 'tools'), GRAPHIFY_PACKAGE, 'bin'));
    out.push(path.join(env.PIPX_HOME || path.join(home, '.local', 'pipx'), 'venvs', GRAPHIFY_PACKAGE, 'bin'));
    if (platform === 'darwin') out.push(path.join(home, 'Library', 'Application Support', 'pipx', 'venvs', GRAPHIFY_PACKAGE, 'bin'), path.join(home, 'Library', 'Python'));
    out.push('/usr/local/bin', '/opt/homebrew/bin');
  }
  return out;
}

/** `graphify --version` on PATH or in the known tool directories. */
export async function detectGraphify(cwd: string = os.tmpdir()): Promise<GraphifyDetection | undefined> {
  const file = await findExecutable(GRAPHIFY_BIN, await toolDirs());
  if (!file) return undefined;
  const result = await runArgv(file, ['--version'], { cwd, timeoutMs: PROBE_TIMEOUT_MS, cap: 2000 });
  if (result.exitCode !== 0) return undefined;
  const version = /(\d+\.\d+(?:\.\d+)?)/.exec(result.output)?.[1] ?? result.output.trim().slice(0, 40);
  return { path: file, version };
}

/** Parses `Python 3.12.1` and checks it against MIN_PYTHON. */
export function pythonVersionOk(output: string): string | undefined {
  const m = /Python\s+(\d+)\.(\d+)(?:\.(\d+))?/i.exec(output);
  if (!m) return undefined;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major > MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor >= MIN_PYTHON[1])) return `${major}.${minor}${m[3] ? `.${m[3]}` : ''}`;
  return undefined;
}

/** A Python 3.10+ interpreter: the `py` launcher first on Windows, then python3 / python. */
export async function detectPython(cwd: string = os.tmpdir()): Promise<PythonDetection | undefined> {
  const candidates: Array<{ name: string; args: string[] }> =
    process.platform === 'win32'
      ? [{ name: 'py', args: ['-3'] }, { name: 'python', args: [] }, { name: 'python3', args: [] }]
      : [{ name: 'python3', args: [] }, { name: 'python', args: [] }];
  for (const c of candidates) {
    const file = await findExecutable(c.name);
    if (!file) continue;
    const result = await runArgv(file, [...c.args, '--version'], { cwd, timeoutMs: PROBE_TIMEOUT_MS, cap: 2000 });
    if (result.exitCode !== 0) continue;
    const version = pythonVersionOk(result.output);
    if (version) return { file, args: c.args, version };
  }
  return undefined;
}

/** The fixed install (or upgrade) commands to try in order: uv, then pipx, then pip --user. */
export async function installPlans(upgrade: boolean, python?: PythonDetection): Promise<InstallPlan[]> {
  const plans: InstallPlan[] = [];
  const uv = await findExecutable('uv', await toolDirs());
  if (uv) plans.push({ kind: 'uv', file: uv, args: ['tool', upgrade ? 'upgrade' : 'install', GRAPHIFY_PACKAGE] });
  const pipx = await findExecutable('pipx', await toolDirs());
  if (pipx) plans.push({ kind: 'pipx', file: pipx, args: [upgrade ? 'upgrade' : 'install', GRAPHIFY_PACKAGE] });
  if (python) plans.push({ kind: 'pip', file: python.file, args: [...python.args, '-m', 'pip', 'install', '--user', ...(upgrade ? ['--upgrade'] : []), GRAPHIFY_PACKAGE] });
  return plans;
}

/** Human-readable form of a plan for the "run this yourself" message. */
export function planCommand(plan: InstallPlan): string {
  const name = plan.kind === 'pip' ? path.basename(plan.file).replace(/\.exe$/i, '') : plan.kind;
  return [name, ...plan.args].join(' ');
}
