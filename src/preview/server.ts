/**
 * Local preview server (SPEC-phase2 §4). Pure Node: `http`, `fs`, `path`. Serves one workspace folder
 * on 127.0.0.1 at a random free port. Refuses `..`, dotfiles, `.git`, `.env*`, `*.pem`, `*.key` and
 * symlinks that leave the folder; checks the Host header (DNS-rebinding guard); sends
 * `Cache-Control: no-store`; injects a small SSE live-reload client into HTML only.
 */
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';

export const PREVIEW_HOST = '127.0.0.1';
export const RELOAD_PATH = '/__gisoo_reload';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
};

export function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** The Host header must be exactly 127.0.0.1:<port> or localhost:<port> (or the bare host on port 80). */
export function hostAllowed(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const h = hostHeader.trim().toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`;
}

/** Is this URL one the preview tools may open or screenshot? Only http(s) on 127.0.0.1 / localhost. */
export function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  } catch {
    return false;
  }
}

const FORBIDDEN_EXT = new Set(['.pem', '.key']);

/** Any path segment that is a dotfile, .git, .env*, or a secret-looking file is refused. */
export function segmentForbidden(segment: string): boolean {
  const s = segment.toLowerCase();
  if (!s || s === '.' || s === '..') return s === '..';
  if (s.startsWith('.')) return true; // dotfiles incl. .git, .env, .env.local
  if (FORBIDDEN_EXT.has(path.posix.extname(s))) return true;
  return false;
}

export type PathCheck = { ok: true; relative: string } | { ok: false; status: 400 | 403 };

/**
 * Validates and normalises a URL path to a relative POSIX path under the root. Pure: no fs access.
 * Rejects encoded traversal, backslashes, dot segments, dotfiles and secret extensions.
 */
export function checkUrlPath(urlPath: string): PathCheck {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return { ok: false, status: 400 };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { ok: false, status: 400 };
  const parts = decoded.split('/').filter((p) => p !== '' && p !== '.');
  for (const part of parts) if (segmentForbidden(part)) return { ok: false, status: part === '..' ? 400 : 403 };
  if (/^[a-zA-Z]:/.test(parts[0] ?? '')) return { ok: false, status: 400 };
  return { ok: true, relative: parts.join('/') };
}

/** True when `real` (an fs.realpath result) is inside `rootReal`. */
export function insideRoot(rootReal: string, real: string): boolean {
  const rel = path.relative(rootReal, real);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export const RELOAD_SCRIPT = `<script>(function(){try{var s=new EventSource(${JSON.stringify(RELOAD_PATH)});s.onmessage=function(e){if(e.data==='reload'){location.reload();}};}catch(e){}})();</script>`;

/** Inserts the live-reload client before </body> (or at the end) of an HTML document. */
export function injectReload(html: string): string {
  const at = html.toLowerCase().lastIndexOf('</body>');
  if (at < 0) return html + RELOAD_SCRIPT;
  return html.slice(0, at) + RELOAD_SCRIPT + html.slice(at);
}

export interface PreviewServerOptions {
  /** Absolute path of the workspace folder to serve. */
  root: string;
  /** Overrides for tests. */
  realpath?: (p: string) => Promise<string>;
}

export class PreviewServer {
  private server: http.Server | undefined;
  private port = 0;
  private readonly rootReal: Promise<string>;
  private readonly clients = new Set<http.ServerResponse>();
  readonly root: string;

  constructor(private readonly options: PreviewServerOptions) {
    this.root = options.root;
    this.rootReal = (options.realpath ?? fs.realpath)(options.root).catch(() => options.root);
  }

  get url(): string {
    return `http://${PREVIEW_HOST}:${this.port}/`;
  }

  get listening(): boolean {
    return this.server !== undefined && this.port > 0;
  }

  async start(): Promise<string> {
    if (this.server) return this.url;
    const server = http.createServer((req, res) => void this.handle(req, res));
    server.on('error', () => undefined);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, PREVIEW_HOST, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    return this.url;
  }

  /** Tells every open page to reload. */
  reload(): void {
    for (const res of this.clients) {
      try {
        res.write('data: reload\n\n');
      } catch {
        this.clients.delete(res);
      }
    }
  }

  urlFor(relativePath: string): string {
    const rel = relativePath.split(path.sep).join('/').replace(/^\.?\//, '');
    return `${this.url}${rel.split('/').map(encodeURIComponent).join('/')}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.port = 0;
    for (const res of this.clients) {
      try {
        res.end();
      } catch {
        // closing
      }
    }
    this.clients.clear();
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!hostAllowed(req.headers.host, this.port)) {
      res.writeHead(421, { 'Content-Type': 'text/plain' }).end('Misdirected request');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    const urlPath = req.url ?? '/';
    if (urlPath.split('?')[0] === RELOAD_PATH) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    const check = checkUrlPath(urlPath);
    if (!check.ok) {
      res.writeHead(check.status, { 'Content-Type': 'text/plain' }).end(check.status === 403 ? 'Forbidden' : 'Bad request');
      return;
    }
    const rootReal = await this.rootReal;
    let target = path.join(rootReal, ...check.relative.split('/'));
    try {
      let st = await fs.stat(target);
      if (st.isDirectory()) {
        if (!urlPath.split('?')[0].endsWith('/')) {
          res.writeHead(302, { Location: `/${check.relative}/` }).end();
          return;
        }
        target = path.join(target, 'index.html');
        st = await fs.stat(target);
      }
      const real = await (this.options.realpath ?? fs.realpath)(target);
      if (!insideRoot(rootReal, real) || !st.isFile()) {
        res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
        return;
      }
      if (st.size > MAX_FILE_BYTES) {
        res.writeHead(413, { 'Content-Type': 'text/plain' }).end('File too large');
        return;
      }
      const type = mimeFor(real);
      if (type.startsWith('text/html')) {
        const html = injectReload(await fs.readFile(real, 'utf8'));
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(html) });
        res.end(req.method === 'HEAD' ? undefined : html);
        return;
      }
      const bytes = await fs.readFile(real);
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  }
}
