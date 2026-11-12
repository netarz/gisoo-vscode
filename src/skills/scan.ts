/**
 * Skill scanner (SPEC-phase2 §7): checks a skill folder before it is installed. Pure: `scanEntries`
 * works on in-memory entries (unit-testable), `scanFolder` walks a folder with lstat (no symlinks).
 * It never executes anything; findings are shown to the user who decides.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type ScanLevel = 'high' | 'warn' | 'info';

export interface ScanFinding {
  level: ScanLevel;
  /** Folder-relative path with forward slashes. */
  file: string;
  line?: number;
  message: string;
}

export interface ScanEntry {
  /** Folder-relative path with forward slashes. */
  path: string;
  size: number;
  isSymlink?: boolean;
  /** POSIX mode bits when known. */
  mode?: number;
  /** File bytes (or text) for content rules; omitted = not scanned for content. */
  content?: Buffer | string;
}

export interface ScanResult {
  findings: ScanFinding[];
  files: number;
  bytes: number;
  /** Set when the skill must not be installed at all (size, symlinks, traversal). */
  refused?: string;
  /** True when at least one `high` finding exists. */
  high: boolean;
}

export const SCAN_MAX_BYTES = 5 * 1024 * 1024;
export const SCAN_MAX_FILES = 300;
export const SCAN_MAX_CONTENT_CHARS = 400_000;

const EXECUTABLE_EXT = new Set(['.exe', '.dll', '.so', '.dylib', '.bin', '.msi', '.com', '.scr', '.app', '.jar', '.pyc', '.wasm']);
const SCRIPT_EXT = new Set(['.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.js', '.mjs', '.cjs', '.py', '.rb', '.pl', '.php']);
const TEXT_EXT = new Set([...SCRIPT_EXT, '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.ts', '.tsx', '.jsx', '.html', '.css', '.xml', '.csv', '.ini', '.cfg', '.env', '.sql', '.r', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '']);

interface ContentRule {
  level: ScanLevel;
  message: string;
  re: RegExp;
  /** Only apply to markdown files (prompt text). */
  markdownOnly?: boolean;
}

const CONTENT_RULES: ContentRule[] = [
  { level: 'high', message: 'downloads and pipes a script into a shell (curl|wget ... | sh)', re: /\b(curl|wget|Invoke-WebRequest|iwr|irm)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|k|da|fi)?sh\b/i },
  { level: 'high', message: 'downloads and runs a script (iex / Invoke-Expression)', re: /\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*\|\s*(iex|Invoke-Expression)\b/i },
  { level: 'high', message: 'recursive delete of a root or home folder (rm -rf /)', re: /\brm\s+-[a-zA-Z]*[rR][a-zA-Z]*\s+(--no-preserve-root\s+)?(\/|~|\$HOME|\/\*|~\/\*)(\s|$)/ },
  { level: 'high', message: 'wipes a drive (Remove-Item / format)', re: /\b(Remove-Item\s+[^\n]*\s-Recurse[^\n]*\s(C:\\|\$env:USERPROFILE|~)|format\s+[a-z]:\s)/i },
  { level: 'high', message: 'base64-decoded execution', re: /\b(base64\s+(-d|--decode|-D)[^\n]*\|\s*(ba|z)?sh\b|exec\s*\(\s*(base64|b64decode|atob)|eval\s*\(\s*(atob|base64|b64decode|Buffer\.from\([^)]*base64)|\[Convert\]::FromBase64String[^\n]*(iex|Invoke-Expression)|echo\s+[A-Za-z0-9+/=]{24,}\s*\|\s*base64\s+(-d|--decode))/i },
  { level: 'high', message: 'reads credential paths (~/.ssh, id_rsa, .aws, .netrc, keychain)', re: /(~|\$HOME|%USERPROFILE%|\/home\/[\w-]+|\/Users\/[\w-]+|\/root)[\\/]\.(ssh|aws|gnupg|netrc|git-credentials|npmrc|docker\/config\.json|kube|config\/gh)\b|\bid_(rsa|ed25519|ecdsa|dsa)\b|\b(security\s+find-(generic|internet)-password|keychain|credential\s*manager|secret-tool\s+lookup|Login Data|Cookies\.sqlite)\b/i },
  { level: 'high', message: 'reads .env files', re: /(^|[\s"'`=(\\/])\.env(\.[\w-]+)?\b(?![\w-]*\.(example|sample|template|md))/i },
  { level: 'high', message: 'sends data to a remote host (upload / POST)', re: /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*(\s-d\s|\s--data(-binary|-raw|-urlencode)?\b|\s-F\s|\s--form\b|\s-T\s|\s--upload-file\b|\s-X\s*POST\b|\s-Method\s+Post\b|\s-InFile\b|\s-Body\b)/i },
  { level: 'high', message: 'opens a raw network connection (nc / bash /dev/tcp)', re: /\b(nc|ncat|netcat)\s+(-\w+\s+)*[\w.-]+\s+\d{2,5}\b|\/dev\/tcp\/[\w.-]+\/\d+/ },
  { level: 'warn', message: 'sends environment variables over the network', re: /\b(fetch|axios|requests\.(post|put)|http\.request|urlopen|XMLHttpRequest)\b[^\n]*\b(process\.env|os\.environ|\$env:)/i },
  { level: 'warn', message: 'modifies shell start-up files or scheduled tasks (persistence)', re: /(\.bashrc|\.zshrc|\.profile|\.bash_profile|crontab\s+-|schtasks\s+\/create|LaunchAgents|\\Run\b|HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run)/i },
  { level: 'warn', message: 'runs with elevated rights (sudo / runas)', re: /\b(sudo\s+|runas\s+\/user|Start-Process[^\n]*-Verb\s+RunAs)/i },
  { level: 'high', message: 'prompt-injection phrase', markdownOnly: true, re: /\b(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules)/i },
  { level: 'high', message: 'prompt-injection phrase (hide from the user)', markdownOnly: true, re: /\b(do\s+not|don'?t|never)\s+(tell|inform|mention|show|reveal|disclose)(\s+(this|it|that))?\s+(to\s+)?the\s+user|\bwithout\s+(telling|informing|asking)\s+the\s+user|\bhide\s+(this|it)\s+from\s+the\s+user|\bsecretly\b/i },
  { level: 'warn', message: 'asks to bypass approval or safety checks', markdownOnly: true, re: /\b(skip|bypass|disable|turn\s+off)\s+(the\s+)?(approval|confirmation|permission|safety|security)\b/i },
  { level: 'high', message: 'hidden characters (zero-width or bidi controls) in text', markdownOnly: true, re: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/ },
];

export function scanEntries(entries: readonly ScanEntry[], opts: { maxBytes?: number; maxFiles?: number } = {}): ScanResult {
  const maxBytes = opts.maxBytes ?? SCAN_MAX_BYTES;
  const maxFiles = opts.maxFiles ?? SCAN_MAX_FILES;
  const findings: ScanFinding[] = [];
  let bytes = 0;
  let refused: string | undefined;
  const refuse = (message: string): void => {
    if (!refused) refused = message;
  };
  if (entries.length > maxFiles) refuse(`Too many files: ${entries.length} (limit ${maxFiles}).`);
  let hasSkillMd = false;
  for (const e of entries) {
    const rel = e.path.replace(/\\/g, '/');
    bytes += e.size;
    if (rel === 'SKILL.md') hasSkillMd = true;
    if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.split('/').includes('..')) {
      findings.push({ level: 'high', file: rel, message: 'path leaves the skill folder' });
      refuse(`"${rel}" points outside the skill folder.`);
      continue;
    }
    if (e.isSymlink) {
      findings.push({ level: 'high', file: rel, message: 'symbolic link' });
      refuse(`"${rel}" is a symbolic link; skills must not contain links.`);
      continue;
    }
    const ext = path.posix.extname(rel).toLowerCase();
    const isMarkdown = ext === '.md' || ext === '.markdown' || ext === '.txt';
    if (EXECUTABLE_EXT.has(ext)) findings.push({ level: 'warn', file: rel, message: 'executable or binary file' });
    else if (e.mode !== undefined && (e.mode & 0o111) !== 0 && !SCRIPT_EXT.has(ext) && ext !== '.md') findings.push({ level: 'warn', file: rel, message: 'file has the executable bit set' });
    if (SCRIPT_EXT.has(ext)) findings.push({ level: 'info', file: rel, message: 'script (runs only through run_command with your approval)' });
    if (e.content === undefined) continue;
    const buf = typeof e.content === 'string' ? Buffer.from(e.content, 'utf8') : e.content;
    if (isBinary(buf)) {
      if (!EXECUTABLE_EXT.has(ext)) findings.push({ level: 'warn', file: rel, message: 'binary file' });
      continue;
    }
    if (!TEXT_EXT.has(ext) && !isMarkdown) continue;
    const text = buf.toString('utf8').slice(0, SCAN_MAX_CONTENT_CHARS);
    findings.push(...scanText(text, rel, isMarkdown));
  }
  if (bytes > maxBytes) refuse(`Too large: ${formatBytes(bytes)} (limit ${formatBytes(maxBytes)}).`);
  if (!hasSkillMd) refuse('SKILL.md is missing at the top of the skill folder.');
  return { findings: dedupe(findings), files: entries.length, bytes, refused, high: findings.some((f) => f.level === 'high') };
}

export function scanText(text: string, file: string, isMarkdown: boolean): ScanFinding[] {
  const out: ScanFinding[] = [];
  const lines = text.split('\n');
  for (const rule of CONTENT_RULES) {
    if (rule.markdownOnly && !isMarkdown) continue;
    for (let i = 0; i < lines.length; i++) {
      if (rule.re.test(lines[i])) {
        out.push({ level: rule.level, file, line: i + 1, message: rule.message });
        break;
      }
    }
  }
  // eslint-disable-next-line no-control-regex -- detecting control characters is the point
  if (isMarkdown && /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)) out.push({ level: 'warn', file, message: 'control characters in text' });
  return out;
}

function dedupe(findings: ScanFinding[]): ScanFinding[] {
  const seen = new Set<string>();
  const order: Record<ScanLevel, number> = { high: 0, warn: 1, info: 2 };
  return findings
    .filter((f) => {
      const key = `${f.level}|${f.file}|${f.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => order[a.level] - order[b.level] || a.file.localeCompare(b.file));
}

export function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Walks a folder (no symlinks followed) and scans every file. */
export async function scanFolder(dir: string): Promise<ScanResult> {
  const root = path.resolve(dir);
  const entries: ScanEntry[] = [];
  const stack = [root];
  let visited = 0;
  while (stack.length) {
    const current = stack.pop() as string;
    if (++visited > 2_000) break;
    let names: string[];
    try {
      names = (await fs.readdir(current)).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const full = path.join(current, name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      let st;
      try {
        st = await fs.lstat(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        entries.push({ path: rel, size: 0, isSymlink: true });
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!st.isFile()) continue;
      let content: Buffer | undefined;
      if (st.size <= SCAN_MAX_BYTES) {
        try {
          content = await fs.readFile(full);
        } catch {
          content = undefined;
        }
      }
      entries.push({ path: rel, size: st.size, mode: st.mode, content });
      if (entries.length > SCAN_MAX_FILES + 1) break;
    }
  }
  return scanEntries(entries);
}

/** Markdown lines for the confirmation dialog / chat. */
export function formatFindings(result: ScanResult, max = 20): string[] {
  const lines = result.findings.slice(0, max).map((f) => `${f.level.toUpperCase()}: ${f.file}${f.line ? `:${f.line}` : ''} - ${f.message}`);
  if (result.findings.length > max) lines.push(`... ${result.findings.length - max} more`);
  return lines;
}
