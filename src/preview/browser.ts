/**
 * Finds a headless-capable Chromium-family browser (Chrome, Edge, Chromium, Brave) in the standard
 * Windows, macOS and Linux locations, or uses the `gisoo.browserPath` setting. Pure Node.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

function windowsCandidates(): string[] {
  const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LocalAppData']].filter((r): r is string => Boolean(r));
  const rel = [
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
    ['Chromium', 'Application', 'chrome.exe'],
    ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
  ];
  const out: string[] = [];
  for (const root of roots) for (const parts of rel) out.push(path.join(root, ...parts));
  return out;
}

function macCandidates(): string[] {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ];
}

function linuxCandidates(): string[] {
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser'];
  const dirs = ['/usr/bin', '/usr/local/bin', '/snap/bin', '/opt/google/chrome'];
  const out: string[] = [];
  for (const dir of dirs) for (const n of names) out.push(path.join(dir, n));
  out.push('/opt/google/chrome/chrome');
  return out;
}

export function browserCandidates(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') return windowsCandidates();
  if (platform === 'darwin') return macCandidates();
  return linuxCandidates();
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    const st = await fs.stat(file);
    return st.isFile();
  } catch {
    return false;
  }
}

/** The configured browser when it exists, else the first standard candidate found; undefined if none. */
export async function findBrowser(configured: string | undefined): Promise<string | undefined> {
  const custom = (configured ?? '').trim();
  if (custom && (await isExecutable(custom))) return custom;
  for (const c of browserCandidates()) if (await isExecutable(c)) return c;
  return undefined;
}

export interface ScreenshotArgs {
  url: string;
  outFile: string;
  width: number;
  height: number;
  waitMs: number;
}

/** The fixed headless argument list; never a shell string. */
export function screenshotArgv(a: ScreenshotArgs): string[] {
  return [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-background-networking',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${a.width},${a.height}`,
    `--virtual-time-budget=${a.waitMs}`,
    `--screenshot=${a.outFile}`,
    a.url,
  ];
}
