/**
 * Small pure security helpers shared by the host modules (no vscode import, unit-tested).
 */

/** What `WorkspaceConfiguration.inspect()` returns, reduced to the parts used here. */
export interface InspectedSetting<T> {
  defaultValue?: T;
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

/**
 * The user-level value of a setting, ignoring workspace and folder values. A cloned repository can
 * ship `.vscode/settings.json`; settings that move the API key, the approval policy or what runs on
 * the machine must never come from there.
 */
export function userScopeValue<T>(inspected: InspectedSetting<T> | undefined): T | undefined {
  if (!inspected) return undefined;
  return inspected.globalValue !== undefined ? inspected.globalValue : inspected.defaultValue;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

/**
 * A base URL the key may be sent to: https anywhere, or plain http to this machine only.
 * Credentials, query and fragment are refused.
 */
export function isAcceptableBaseUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password || u.search || u.hash) return false;
  if (u.protocol === 'https:') return Boolean(u.hostname);
  return u.protocol === 'http:' && isLoopbackHost(u.hostname);
}

/** A base URL returned by the sign-in server: https on gisoo.pro or one of its subdomains. */
export function isGisooServerBase(url: string): boolean {
  if (!isAcceptableBaseUrl(url)) return false;
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  return u.protocol === 'https:' && !u.port && (host === 'gisoo.pro' || host.endsWith('.gisoo.pro'));
}

/** Parses a dotted IPv4 address; undefined when it is not one. */
function ipv4(host: string): number[] | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return undefined;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : undefined;
}

/**
 * True for hosts web_fetch must never reach: loopback, private, link-local (cloud metadata),
 * carrier-grade NAT, unspecified, multicast, local names, and any IPv6 literal that is not plainly
 * global. Numeric shorthand forms (`2130706433`, `0x7f.1`) are refused as well.
 */
export function isBlockedFetchHost(hostname: string): boolean {
  let host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;
  if (!host.includes('.') && !host.includes(':')) return true; // single-label names resolve on the LAN
  if (host.includes(':')) {
    // IPv6 literal.
    if (host === '::' || host === '::1') return true;
    if (/^(fc|fd|fe[89ab]|ff)/.test(host)) return true;
    if (host.startsWith('::ffff:') || host.startsWith('64:ff9b:') || host.startsWith('::')) return true;
    return false;
  }
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host) || /(^|\.)0x[0-9a-f]+/i.test(host)) {
    const p = ipv4(host);
    if (!p) return true; // a numeric form that is not plain dotted IPv4
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0 && p[2] === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
  }
  return false;
}

/**
 * Resolves a bare program name to an absolute path using only absolute PATH entries, never the
 * current directory. On Windows libuv looks in the cwd first, so spawning `git` inside a cloned
 * repository would run a planted `git.exe`. Returns undefined when nothing is found.
 */
export function resolveExecutable(
  name: string,
  env: { PATH?: string; Path?: string; PATHEXT?: string },
  platform: NodeJS.Platform,
  isFile: (absolute: string) => boolean,
  pathApi: { isAbsolute(p: string): boolean; join(...p: string[]): string; delimiter: string },
): string | undefined {
  if (pathApi.isAbsolute(name)) return isFile(name) ? name : undefined;
  if (/[\\/]/.test(name)) return undefined; // relative paths are never resolved
  const raw = env.PATH ?? env.Path ?? '';
  const dirs = raw.split(pathApi.delimiter).map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter((d) => d && pathApi.isAbsolute(d));
  const win = platform === 'win32';
  const exts = win ? (/\.(exe|com)$/i.test(name) ? [''] : ['.exe', '.com']) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = pathApi.join(dir, name + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}
