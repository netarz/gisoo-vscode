import { lookup } from 'node:dns/promises';
import { isBlockedFetchHost } from '../security';
import type { Tool } from './types';

interface Input {
  url: string;
}

export const WEB_FETCH_MAX_BYTES = 100 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

/**
 * Why a URL may not be fetched, or undefined when it may. Local, private and link-local targets
 * (other machines on the LAN, cloud metadata, services on this machine) are refused, both by name
 * and by every address the name resolves to. URLs with user:password are refused too.
 */
async function refusedTarget(url: URL): Promise<string | undefined> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Only http and https URLs are allowed.';
  if (url.username || url.password) return 'URLs with credentials are not allowed.';
  const refusal = 'web_fetch only reaches public internet addresses; local and private network addresses are refused.';
  if (isBlockedFetchHost(url.hostname)) return refusal;
  try {
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((a) => isBlockedFetchHost(a.address))) return refusal;
  } catch {
    return 'The host name could not be resolved.';
  }
  return undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export const webFetchTool: Tool<Input> = {
  name: 'web_fetch',
  description:
    'Fetch a public http(s) URL and return its text (HTML is reduced to plain text, max 100 KB). The user approves each fetch; local and private network addresses are refused. Only available when the user enabled gisoo.webFetch.enabled.',
  permission: 'read',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Absolute http or https URL' } },
    required: ['url'],
    additionalProperties: false,
  },
  title: (input) => `Fetch ${(input.url ?? '').slice(0, 120)}`,
  async run(input, ctx) {
    if (!ctx.settings.webFetchEnabled) {
      return { content: 'web_fetch is disabled. The user can enable it with the setting gisoo.tools.webFetch.', isError: true };
    }
    let url: URL;
    try {
      url = new URL(String(input.url ?? ''));
    } catch {
      return { content: 'url must be an absolute http(s) URL', isError: true };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { content: 'Only http and https URLs are allowed.', isError: true };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onAbort = () => controller.abort();
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      // Redirects are followed by hand so every hop goes through the same host check.
      let res: Response | undefined;
      for (let hop = 0; ; hop++) {
        const refused = await refusedTarget(url);
        if (refused) return { content: refused, isError: true };
        res = await fetch(url.toString(), {
          signal: controller.signal,
          redirect: 'manual',
          credentials: 'omit',
          headers: { accept: 'text/html, text/plain, application/json;q=0.9, */*;q=0.5' },
        });
        const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        if (!location) break;
        await res.body?.cancel().catch(() => undefined);
        if (hop >= MAX_REDIRECTS) return { content: 'Too many redirects.', isError: true };
        try {
          url = new URL(location, url);
        } catch {
          return { content: 'The page redirected to an invalid URL.', isError: true };
        }
      }
      if (!res) return { content: 'Fetch failed.', isError: true };
      const type = res.headers.get('content-type') ?? '';
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      let truncated = false;
      if (reader) {
        while (size < WEB_FETCH_MAX_BYTES) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            size += value.byteLength;
          }
        }
        if (size >= WEB_FETCH_MAX_BYTES) {
          truncated = true;
          await reader.cancel().catch(() => undefined);
        }
      }
      const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, WEB_FETCH_MAX_BYTES);
      let text = buffer.toString('utf8');
      if (/text\/html/i.test(type)) text = stripHtml(text);
      const header = `HTTP ${res.status} ${type ? `(${type.split(';')[0]})` : ''}`.trim();
      return {
        content: `${header}\n\n${text}${truncated ? '\n\n[truncated at 100 KB]' : ''}`,
        isError: res.status >= 400,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Fetch failed: ${message}`, isError: true };
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener('abort', onAbort);
    }
  },
};
