/**
 * HTTP client for the Gisoo API (OpenAI-compatible). Pure Node: no VS Code imports.
 * Errors are mapped to GisooError; 429 and 5xx are retried with backoff and jitter.
 */
import type { ChatRequest, MeResponse, TokenResponse, WireModel } from './types';
import { decodeBytes, readChatStream, type StreamEvent } from './stream';
import { isAcceptableBaseUrl } from '../security';

export type GisooErrorCode =
  | 'insufficient_credit'
  | 'invalid_api_key'
  | 'rate_limited'
  | 'model_not_found'
  | 'server'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'bad_request'
  | 'unknown';

export class GisooError extends Error {
  constructor(
    message: string,
    readonly code: GisooErrorCode,
    readonly status?: number,
    readonly apiCode?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'GisooError';
  }

  get retryable(): boolean {
    return this.code === 'rate_limited' || this.code === 'server' || this.code === 'network' || this.code === 'timeout';
  }
}

export interface ClientOptions {
  baseUrl: string;
  /** Returns the current key or undefined when signed out. Never logged. */
  getApiKey: () => Promise<string | undefined> | string | undefined;
  fetchImpl?: typeof fetch;
  /** Default request timeout for JSON calls. */
  timeoutMs?: number;
  /** Time allowed before the first byte of a stream. */
  streamTimeoutMs?: number;
  /** Injected for tests: milliseconds to wait before a retry. */
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
  maxRetries?: { rateLimit: number; server: number };
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function normaliseBaseUrl(url: string): string {
  let base = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  // The key travels in the Authorization header: plain http is allowed only to this machine.
  if (/^http:\/\//i.test(base) && !isAcceptableBaseUrl(base)) base = `https://${base.slice('http://'.length)}`;
  return base;
}

/** Maps a non-2xx response to a GisooError. Body is read when it looks like JSON. */
export async function errorFromResponse(res: Response): Promise<GisooError> {
  let message = `HTTP ${res.status}`;
  let apiCode: string | undefined;
  try {
    const text = await res.text();
    if (text) {
      try {
        const json = JSON.parse(text) as { error?: { message?: string; code?: string; type?: string } | string; message?: string };
        if (typeof json.error === 'string') message = json.error;
        else if (json.error?.message) message = json.error.message;
        else if (json.message) message = json.message;
        if (typeof json.error === 'object' && json.error) apiCode = json.error.code ?? json.error.type;
      } catch {
        message = text.slice(0, 300);
      }
    }
  } catch {
    // ignore body read failures
  }
  const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
  return new GisooError(message, codeFor(res.status, apiCode), res.status, apiCode, retryAfter);
}

export function codeFor(status: number, apiCode?: string): GisooErrorCode {
  if (status === 402 || apiCode === 'insufficient_credit' || apiCode === 'insufficient_quota') return 'insufficient_credit';
  if (status === 401 || apiCode === 'invalid_api_key') return 'invalid_api_key';
  if (status === 429 || apiCode === 'rate_limit_exceeded') return 'rate_limited';
  if (apiCode === 'model_not_found' || (status === 404 && apiCode?.includes('model'))) return 'model_not_found';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'unknown';
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message));
}

function linkSignals(signals: Array<AbortSignal | undefined>): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const listeners: Array<() => void> = [];
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    const onAbort = (): void => controller.abort(s.reason);
    s.addEventListener('abort', onAbort, { once: true });
    listeners.push(() => s.removeEventListener('abort', onAbort));
  }
  return { signal: controller.signal, dispose: () => listeners.forEach((f) => f()) };
}

export class GisooClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly streamTimeoutMs: number;
  private readonly retries: { rateLimit: number; server: number };
  baseUrl: string;

  constructor(private readonly options: ClientOptions) {
    this.baseUrl = normaliseBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.streamTimeoutMs = options.streamTimeoutMs ?? 90_000;
    this.retries = options.maxRetries ?? { rateLimit: 3, server: 2 };
  }

  setBaseUrl(url: string): void {
    this.baseUrl = normaliseBaseUrl(url);
  }

  async models(signal?: AbortSignal): Promise<WireModel[]> {
    const json = await this.json<{ data?: WireModel[] }>('GET', '/models', { auth: false, signal });
    return Array.isArray(json.data) ? json.data : [];
  }

  me(signal?: AbortSignal): Promise<MeResponse> {
    return this.json<MeResponse>('GET', '/me', { signal });
  }

  /** Validates a key without touching the stored one. */
  meWithKey(apiKey: string, signal?: AbortSignal): Promise<MeResponse> {
    return this.json<MeResponse>('GET', '/me', { signal, apiKey });
  }

  usage(group: 'day' | 'model', signal?: AbortSignal): Promise<unknown> {
    return this.json<unknown>('GET', `/usage?group=${group}`, { signal });
  }

  exchangeToken(code: string, verifier: string, signal?: AbortSignal): Promise<TokenResponse> {
    return this.json<TokenResponse>('POST', '/vscode/token', { auth: false, body: { code, verifier }, signal });
  }

  /** Streams a chat completion. Retries happen only before the first byte. */
  async *chat(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const res = await this.send('POST', '/chat/completions', { body: request, signal, timeoutMs: this.streamTimeoutMs, stream: true });
    if (!res.body) throw new GisooError('Empty response body', 'server', res.status);
    const reader = res.body.getReader();
    const bytes: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            if (value) yield value;
          }
        } finally {
          reader.releaseLock();
        }
      },
    };
    try {
      for await (const ev of readChatStream(decodeBytes(bytes))) {
        if (ev.kind === 'error') throw new GisooError(ev.message, codeFor(0, ev.code), undefined, ev.code);
        yield ev;
      }
    } catch (err) {
      if (signal?.aborted || isAbort(err)) throw new GisooError('Stopped', 'aborted');
      if (err instanceof GisooError) throw err;
      throw new GisooError(err instanceof Error ? err.message : String(err), 'network');
    } finally {
      try {
        await reader.cancel();
      } catch {
        // already closed
      }
    }
  }

  private async json<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: { auth?: boolean; body?: unknown; signal?: AbortSignal; apiKey?: string } = {},
  ): Promise<T> {
    const res = await this.send(method, path, { ...opts, timeoutMs: this.timeoutMs });
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GisooError('The server returned something that is not JSON.', 'server', res.status);
    }
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    opts: { auth?: boolean; body?: unknown; signal?: AbortSignal; apiKey?: string; timeoutMs: number; stream?: boolean },
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: opts.stream ? 'text/event-stream' : 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.options.userAgent) headers['User-Agent'] = this.options.userAgent;
    if (opts.auth !== false) {
      const key = opts.apiKey ?? (await this.options.getApiKey());
      if (!key) throw new GisooError('Not signed in.', 'invalid_api_key', 401);
      headers.Authorization = `Bearer ${key}`;
    }
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);

    let rateLimitLeft = this.retries.rateLimit;
    let serverLeft = this.retries.server;
    let attempt = 0;
    while (true) {
      attempt++;
      if (opts.signal?.aborted) throw new GisooError('Stopped', 'aborted');
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(new Error('timeout')), opts.timeoutMs);
      const linked = linkSignals([opts.signal, timeout.signal]);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers, body, signal: linked.signal });
      } catch (err) {
        clearTimeout(timer);
        linked.dispose();
        if (opts.signal?.aborted) throw new GisooError('Stopped', 'aborted');
        const timedOut = timeout.signal.aborted;
        if (serverLeft-- > 0) {
          await this.sleep(backoff(attempt));
          continue;
        }
        if (timedOut) throw new GisooError('The request timed out.', 'timeout');
        throw new GisooError(err instanceof Error ? err.message : 'Network error', 'network');
      }
      // For streams the timer only covers the time to headers; clear it now.
      clearTimeout(timer);
      if (!opts.stream) linked.dispose();
      else opts.signal?.addEventListener('abort', () => linked.dispose(), { once: true });

      if (res.ok) return res;
      const error = await errorFromResponse(res);
      if (error.code === 'rate_limited' && rateLimitLeft-- > 0) {
        await this.sleep(error.retryAfterMs ?? backoff(attempt));
        continue;
      }
      if (error.code === 'server' && serverLeft-- > 0) {
        await this.sleep(backoff(attempt));
        continue;
      }
      throw error;
    }
  }
}

/** Exponential backoff with jitter: 0.5-1 s, 1-2 s, 2-4 s... capped at 8 s. */
export function backoff(attempt: number): number {
  const base = Math.min(8000, 500 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base + Math.random() * base);
}
