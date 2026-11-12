/** PKCE helpers for "Sign in with Gisoo". Pure Node crypto. */
import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** URL-safe random string of exactly `length` characters. */
export function randomUrlSafe(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** S256: base64url(sha256(verifier)). */
export function challengeFor(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier, 'ascii').digest());
}

export interface PkcePair {
  state: string;
  verifier: string;
  challenge: string;
  createdAt: number;
}

export function createPkce(now: number = Date.now()): PkcePair {
  const verifier = randomUrlSafe(64);
  return { state: randomUrlSafe(32), verifier, challenge: challengeFor(verifier), createdAt: now };
}

export const PKCE_TTL_MS = 10 * 60 * 1000;

export function pkceExpired(pair: PkcePair, now: number = Date.now()): boolean {
  return now - pair.createdAt > PKCE_TTL_MS;
}

export const CONNECT_URL = 'https://gisoo.pro/app/vscode/connect';

export function connectUrl(opts: { state: string; challenge: string; redirect: string; region: 'global' | 'iran'; client: string }): string {
  const params = new URLSearchParams({
    state: opts.state,
    challenge: opts.challenge,
    redirect: opts.redirect,
    region: opts.region,
    client: opts.client,
  });
  return `${CONNECT_URL}?${params.toString()}`;
}

/** Parses `?code=…&state=…` from the callback URI query string. */
export function parseCallback(query: string): { code?: string; state?: string } {
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  return { code: params.get('code') ?? undefined, state: params.get('state') ?? undefined };
}

/** Accepts the bare `sk-…` key or a pasted header line; returns undefined when it is not a key. */
export function cleanApiKey(input: string): string | undefined {
  const key = input.trim().replace(/^bearer\s+/i, '');
  return /^sk-[A-Za-z0-9_-]{8,}$/.test(key) ? key : undefined;
}
