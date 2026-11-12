/**
 * Skill install (SPEC-phase2 §7), VS Code-free: parse a source (local folder, .zip/.skill/.tar.gz,
 * GitHub URL or owner/repo), download a GitHub archive over https from github.com /
 * codeload.github.com only, stage the skill in a temp folder, scan it, install it after the caller
 * confirmed, and record it in `~/.gisoo/skills/.installed.json`. Nothing is ever executed.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { ArchiveError, readArchive, type ArchiveEntry } from './archive';
import { parseSkillFrontmatter, SKILL_NAME } from './catalog';
import { scanFolder, SCAN_MAX_FILES, type ScanResult } from './scan';

export type SkillSourceSpec =
  | { kind: 'folder'; path: string; label: string }
  | { kind: 'archive'; path: string; label: string }
  | { kind: 'github'; owner: string; repo: string; ref?: string; subpath?: string; label: string };

export interface KnownRepo {
  id: string;
  owner: string;
  repo: string;
  description: string;
}

export const KNOWN_SKILL_REPOS: readonly KnownRepo[] = [
  { id: 'anthropics/skills', owner: 'anthropics', repo: 'skills', description: 'Anthropic skills (documents, design, data...)' },
  { id: 'openai/skills', owner: 'openai', repo: 'skills', description: 'OpenAI Codex skills' },
];

export const ALLOWED_HOSTS = new Set(['github.com', 'codeload.github.com']);
export const DOWNLOAD_MAX_BYTES = 40 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 4;
const NAME_PART = /^[A-Za-z0-9_.-]{1,100}$/;
const REF_PART = /^[A-Za-z0-9_.\-/]{1,200}$/;

export class SkillInstallError extends Error {
  constructor(message: string, readonly reason: 'source' | 'network' | 'archive' | 'scan' | 'exists' | 'name' | 'links' | 'outside' | 'io') {
    super(message);
    this.name = 'SkillInstallError';
  }
}

// -- Source -----------------------------------------------------------------------------------------

export function isArchiveName(name: string): boolean {
  return /\.(zip|skill|tgz|tar\.gz|tar)$/i.test(name);
}

/**
 * @param exists Optional check used to prefer a local path over the `owner/repo` shorthand.
 */
export function parseSkillSource(input: string, exists?: (p: string) => boolean): SkillSourceSpec | undefined {
  const raw = input.trim().replace(/^["']|["']$/g, '');
  if (!raw) return undefined;
  const url = /^(https?:\/\/)?(www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/(?:tree|blob)\/([^?#\s]+))?\/?(?:[?#].*)?$/i.exec(raw);
  if (url) {
    if (url[1] && url[1].toLowerCase() !== 'https://') return undefined;
    const owner = url[3];
    const repo = url[4].replace(/\.git$/i, '');
    const rest = url[5];
    if (!NAME_PART.test(owner) || !NAME_PART.test(repo)) return undefined;
    let ref: string | undefined;
    let subpath: string | undefined;
    if (rest) {
      const parts = rest.split('/').filter(Boolean);
      ref = parts.shift();
      subpath = parts.length ? parts.join('/') : undefined;
    }
    if (ref !== undefined && (!REF_PART.test(ref) || ref.includes('..'))) return undefined;
    if (subpath !== undefined && (subpath.split('/').includes('..') || subpath.includes('\\'))) return undefined;
    return { kind: 'github', owner, repo, ref, subpath, label: `github.com/${owner}/${repo}${ref ? `@${ref}` : ''}${subpath ? `/${subpath}` : ''}` };
  }
  const isPathLike = path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('.') || raw.startsWith('~') || raw.includes('\\');
  if (isPathLike || exists?.(raw)) {
    const abs = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : path.resolve(raw);
    return isArchiveName(abs) ? { kind: 'archive', path: abs, label: path.basename(abs) } : { kind: 'folder', path: abs, label: abs };
  }
  const shorthand = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([A-Za-z0-9_.\-/]+))?(?::(.+))?$/.exec(raw);
  if (shorthand) {
    const [, owner, repo, ref, subpath] = shorthand;
    if (ref?.includes('..') || subpath?.split('/').includes('..')) return undefined;
    return { kind: 'github', owner, repo: repo.replace(/\.git$/i, ''), ref, subpath, label: `github.com/${owner}/${repo}${ref ? `@${ref}` : ''}${subpath ? `/${subpath}` : ''}` };
  }
  return undefined;
}

export function githubArchiveUrl(src: Extract<SkillSourceSpec, { kind: 'github' }>): string {
  const ref = (src.ref ?? 'HEAD').split('/').map(encodeURIComponent).join('/');
  return `https://codeload.github.com/${encodeURIComponent(src.owner)}/${encodeURIComponent(src.repo)}/tar.gz/${ref}`;
}

// -- Download ---------------------------------------------------------------------------------------

export interface DownloadOptions {
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  userAgent?: string;
}

/** GET over https; follows redirects only to github.com / codeload.github.com. */
export function downloadHttps(url: string, opts: DownloadOptions = {}, redirects = 0): Promise<{ buffer: Buffer; url: string }> {
  const maxBytes = opts.maxBytes ?? DOWNLOAD_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new SkillInstallError(`Invalid URL: ${url}`, 'source'));
      return;
    }
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
      reject(new SkillInstallError(`Refused: only https://github.com and https://codeload.github.com are allowed (got ${target.hostname}).`, 'network'));
      return;
    }
    const req = https.get(
      target,
      { headers: { 'User-Agent': opts.userAgent ?? 'gisoo-vscode', Accept: 'application/x-gzip, application/zip, */*' }, timeout: timeoutMs, signal: opts.signal },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) {
            reject(new SkillInstallError('Too many redirects.', 'network'));
            return;
          }
          let next: string;
          try {
            next = new URL(res.headers.location, target).toString();
          } catch {
            reject(new SkillInstallError('Invalid redirect.', 'network'));
            return;
          }
          downloadHttps(next, opts, redirects + 1).then(resolve, reject);
          return;
        }
        if (status === 404) {
          res.resume();
          reject(new SkillInstallError('Not found on GitHub: check the owner, repository, branch and path.', 'network'));
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new SkillInstallError(`GitHub answered HTTP ${status}.`, 'network'));
          return;
        }
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > maxBytes) {
          res.destroy();
          reject(new SkillInstallError(`The archive is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`, 'network'));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            res.destroy(new SkillInstallError(`The archive is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`, 'network'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks), url: target.toString() }));
        res.on('error', (error) => reject(error instanceof SkillInstallError ? error : new SkillInstallError(`Download failed: ${error.message}`, 'network')));
      },
    );
    req.on('timeout', () => req.destroy(new SkillInstallError('Download timed out.', 'network')));
    req.on('error', (error) => reject(error instanceof SkillInstallError ? error : new SkillInstallError(`Download failed: ${error.message}`, 'network')));
  });
}

// -- Fetch + stage ----------------------------------------------------------------------------------

export interface FetchedSource {
  entries: ArchiveEntry[];
  /** Commit sha for GitHub archives (pax comment), when present. */
  commit?: string;
  /** sha256 of the downloaded archive bytes. */
  archiveSha256?: string;
}

export function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Downloads or reads an archive and parses it. Local folders are not handled here. */
export async function fetchArchiveSource(src: SkillSourceSpec, opts: DownloadOptions = {}): Promise<FetchedSource> {
  let buffer: Buffer;
  let nameHint: string;
  if (src.kind === 'github') {
    const { buffer: b } = await downloadHttps(githubArchiveUrl(src), opts);
    buffer = b;
    nameHint = `${src.repo}.tar.gz`;
  } else if (src.kind === 'archive') {
    try {
      const st = await fs.lstat(src.path);
      if (!st.isFile()) throw new Error('not a file');
      if (st.size > (opts.maxBytes ?? DOWNLOAD_MAX_BYTES)) throw new SkillInstallError('The archive is too large.', 'archive');
      buffer = await fs.readFile(src.path);
    } catch (error) {
      if (error instanceof SkillInstallError) throw error;
      throw new SkillInstallError(`Cannot read ${src.path}.`, 'io');
    }
    nameHint = path.basename(src.path);
  } else throw new SkillInstallError('Local folders are staged directly.', 'source');
  try {
    const result = readArchive(buffer, nameHint);
    return { entries: result.entries, commit: result.comment?.trim() || undefined, archiveSha256: sha256(buffer) };
  } catch (error) {
    if (error instanceof ArchiveError) throw new SkillInstallError(error.message, 'archive');
    throw error;
  }
}

/** Folders (archive-relative, "" for the root) that contain a SKILL.md, shallowest first. */
export function skillCandidates(entries: readonly ArchiveEntry[], subpath?: string): string[] {
  const dirs = new Set<string>();
  for (const e of entries) {
    if (e.type !== 'file') continue;
    const parts = e.path.split('/');
    if (parts[parts.length - 1] !== 'SKILL.md') continue;
    dirs.add(parts.slice(0, -1).join('/'));
  }
  let list = [...dirs];
  if (subpath) {
    const want = subpath.replace(/^\/+|\/+$/g, '');
    list = list.filter((d) => {
      const stripped = stripTopFolder(d, entries);
      return stripped === want || stripped.startsWith(`${want}/`);
    });
  }
  return list.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

/** GitHub archives wrap everything in `<repo>-<ref>/`; this removes that folder from a path. */
export function stripTopFolder(archivePath: string, entries: readonly ArchiveEntry[]): string {
  const tops = new Set(entries.map((e) => e.path.split('/')[0]));
  if (tops.size !== 1) return archivePath;
  const [top] = [...tops];
  if (archivePath === top) return '';
  return archivePath.startsWith(`${top}/`) ? archivePath.slice(top.length + 1) : archivePath;
}

export interface StagedSkill {
  /** Temp folder with the skill files (SKILL.md at the top). */
  dir: string;
  /** Temp root to delete afterwards. */
  tempRoot: string;
  name: string;
  description: string;
  files: string[];
  bytes: number;
  scan: ScanResult;
  /** sha256 over the staged files (sorted path + content). */
  sha256: string;
  commit?: string;
  source: string;
}

export async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gisoo-skill-'));
}

function inside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Writes the entries under `prefix` into `<tempRoot>/skill`. Links inside the skill are refused. */
export async function stageEntries(entries: readonly ArchiveEntry[], prefix: string, tempRoot: string): Promise<string> {
  const dir = path.join(tempRoot, 'skill');
  await fs.mkdir(dir, { recursive: true });
  const base = prefix ? `${prefix}/` : '';
  let count = 0;
  for (const e of entries) {
    if (e.path !== prefix && !e.path.startsWith(base)) continue;
    const rel = e.path === prefix ? '' : e.path.slice(base.length);
    if (!rel) continue;
    if (e.type === 'link') throw new SkillInstallError(`Refused: "${rel}" is a link; skills must not contain links.`, 'links');
    if (e.type !== 'file') continue;
    if (++count > SCAN_MAX_FILES + 1) break;
    const target = path.resolve(dir, ...rel.split('/'));
    if (!inside(dir, target)) throw new SkillInstallError(`Refused: "${rel}" leaves the skill folder.`, 'archive');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, e.data);
  }
  return dir;
}

/** Copies a local folder into `<tempRoot>/skill` without following links (they are kept and then refused by the scan). */
export async function stageFolder(folder: string, tempRoot: string): Promise<string> {
  const dir = path.join(tempRoot, 'skill');
  try {
    const st = await fs.lstat(folder);
    if (!st.isDirectory()) throw new Error('not a folder');
  } catch {
    throw new SkillInstallError(`Not a folder: ${folder}`, 'source');
  }
  await fs.cp(folder, dir, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: false, force: true, filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src) });
  return dir;
}

async function listFiles(dir: string): Promise<Array<{ rel: string; abs: string; size: number }>> {
  const out: Array<{ rel: string; abs: string; size: number }> = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop() as string;
    let names: string[];
    try {
      names = (await fs.readdir(current)).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const abs = path.join(current, name);
      const st = await fs.lstat(abs);
      if (st.isDirectory()) stack.push(abs);
      else if (st.isFile()) out.push({ rel: path.relative(dir, abs).split(path.sep).join('/'), abs, size: st.size });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Scans the staged folder and reads SKILL.md; the result is what the user confirms. */
export async function describeStaged(dir: string, tempRoot: string, source: string, commit?: string): Promise<StagedSkill> {
  const scan = await scanFolder(dir);
  const files = await listFiles(dir);
  const hash = createHash('sha256');
  let bytes = 0;
  for (const f of files) {
    bytes += f.size;
    hash.update(f.rel).update('\0');
    if (f.size <= 50 * 1024 * 1024) hash.update(await fs.readFile(f.abs));
  }
  let name = path.basename(dir);
  let description = '';
  try {
    const fm = parseSkillFrontmatter(await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8'));
    if (fm.name) name = fm.name;
    description = fm.description;
  } catch {
    // scan already reports the missing SKILL.md
  }
  return { dir, tempRoot, name, description, files: files.map((f) => f.rel), bytes, scan, sha256: hash.digest('hex'), commit, source };
}

export async function cleanupStaged(staged: Pick<StagedSkill, 'tempRoot'> | undefined): Promise<void> {
  if (!staged) return;
  try {
    await fs.rm(staged.tempRoot, { recursive: true, force: true });
  } catch {
    // temp folder: best effort
  }
}

// -- Install + record -------------------------------------------------------------------------------

export interface InstalledRecord {
  name: string;
  scope: 'user' | 'project';
  /** Absolute skill folder. */
  dir: string;
  source: string;
  commit?: string;
  sha256: string;
  installedAt: string;
  disabled?: boolean;
}

export function userSkillsDir(homeDir = os.homedir()): string {
  return path.join(homeDir, '.gisoo', 'skills');
}

export function projectSkillsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.gisoo', 'skills');
}

export function installedRecordPath(homeDir = os.homedir()): string {
  return path.join(userSkillsDir(homeDir), '.installed.json');
}

export async function readInstalled(homeDir = os.homedir()): Promise<InstalledRecord[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(installedRecordPath(homeDir), 'utf8')) as { skills?: unknown };
    return Array.isArray(parsed.skills) ? (parsed.skills.filter((s) => s && typeof s === 'object' && typeof (s as InstalledRecord).dir === 'string') as InstalledRecord[]) : [];
  } catch {
    return [];
  }
}

export async function writeInstalled(records: readonly InstalledRecord[], homeDir = os.homedir()): Promise<void> {
  const file = installedRecordPath(homeDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify({ version: 1, skills: records }, null, 2)}\n`, 'utf8');
}

export interface InstallOptions {
  skillsDir: string;
  scope: 'user' | 'project';
  homeDir?: string;
  /** Replace an existing folder with the same name. */
  replace?: boolean;
  /**
   * Project installs: the workspace folder. `skillsDir` must sit inside it with no symlink or
   * junction on the way, so a cloned repository cannot point `.gisoo/skills` somewhere else.
   */
  containRoot?: string;
}

/**
 * Refuses when `dir` is not inside `root`, or when any existing folder between them is a symbolic
 * link or junction, or when the real path of the deepest existing folder leaves the real root.
 */
export async function assertNoLinkedComponents(dir: string, root: string): Promise<void> {
  const absRoot = path.resolve(root);
  const absDir = path.resolve(dir);
  const refuse = (): never => {
    throw new SkillInstallError('Refused: the project skills folder leads outside the workspace through a link.', 'outside');
  };
  if (!inside(absRoot, absDir)) refuse();
  const realRoot = await fs.realpath(absRoot);
  let current = absDir;
  let deepestExisting: string | undefined;
  // The workspace folder itself may be a link (the user opened it that way); everything below it may not.
  while (current !== absRoot) {
    let st: Awaited<ReturnType<typeof fs.lstat>> | undefined;
    try {
      st = await fs.lstat(current);
    } catch {
      st = undefined;
    }
    if (st) {
      if (st.isSymbolicLink() || !st.isDirectory()) refuse();
      deepestExisting ??= current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (deepestExisting && !inside(realRoot, await fs.realpath(deepestExisting))) refuse();
}

export async function targetExists(skillsDir: string, name: string): Promise<boolean> {
  try {
    await fs.lstat(path.join(skillsDir, name));
    return true;
  } catch {
    return false;
  }
}

/** Copies the staged folder into `<skillsDir>/<name>` and records it. Call only after the user confirmed. */
export async function installStagedSkill(staged: StagedSkill, opts: InstallOptions): Promise<InstalledRecord> {
  if (staged.scan.refused) throw new SkillInstallError(staged.scan.refused, 'scan');
  if (!SKILL_NAME.test(staged.name)) throw new SkillInstallError(`Invalid skill name "${staged.name}".`, 'name');
  const target = path.resolve(opts.skillsDir, staged.name);
  if (!inside(path.resolve(opts.skillsDir), target) || target === path.resolve(opts.skillsDir)) throw new SkillInstallError('Refused: target leaves the skills folder.', 'name');
  if (opts.containRoot) await assertNoLinkedComponents(opts.skillsDir, opts.containRoot);
  if (await targetExists(opts.skillsDir, staged.name)) {
    if (!opts.replace) throw new SkillInstallError(`A skill named "${staged.name}" is already installed there.`, 'exists');
    await fs.rm(target, { recursive: true, force: true });
  }
  await fs.mkdir(opts.skillsDir, { recursive: true });
  if (opts.containRoot) await assertNoLinkedComponents(opts.skillsDir, opts.containRoot);
  await fs.cp(staged.dir, target, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
  const record: InstalledRecord = {
    name: staged.name,
    scope: opts.scope,
    dir: target,
    source: staged.source,
    commit: staged.commit,
    sha256: staged.sha256,
    installedAt: new Date().toISOString(),
  };
  const records = (await readInstalled(opts.homeDir)).filter((r) => path.resolve(r.dir).toLowerCase() !== target.toLowerCase());
  records.push(record);
  await writeInstalled(records, opts.homeDir);
  return record;
}
