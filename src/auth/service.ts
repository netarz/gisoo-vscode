/**
 * Sign-in for Gisoo. The API key lives only in SecretStorage (`gisoo.apiKey`); it is never logged,
 * never put in a URL and never sent to the webview. Browser sign-in is PKCE with a one-time code.
 */
import * as vscode from 'vscode';
import { GisooClient, GisooError } from '../api/client';
import type { MeResponse } from '../api/types';
import type { AccountInfo } from '../shared/protocol';
import { baseUrlFromSettings, getSettings } from '../config';
import { isAcceptableBaseUrl, isGisooServerBase } from '../security';
import { hostStr } from '../ui/strings';
import { cleanApiKey, createPkce, parseCallback, type PkcePair } from './pkce';

export const SECRET_KEY = 'gisoo.apiKey';
const BASE_STATE_KEY = 'gisoo.resolvedBaseUrl';
const BROWSER_TIMEOUT_MS = 5 * 60 * 1000;
const KEY_FORMAT = /^sk-(gisoo|ntz)-v1-[A-Za-z0-9_-]{8,}$/;

interface Pending {
  pkce: PkcePair;
  resolve: (info: AccountInfo) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class AuthService implements vscode.UriHandler, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<AccountInfo>();
  readonly onDidChange = this.emitter.event;
  private pending: Pending | undefined;
  private last: AccountInfo;

  constructor(private readonly context: vscode.ExtensionContext, private readonly client: GisooClient) {
    this.last = { signedIn: false, baseUrl: client.baseUrl, region: getSettings().region };
    this.applyBase();
  }

  /** Points the client at the saved or configured base URL. */
  applyBase(): void {
    const s = getSettings();
    const stored = this.context.globalState.get<string>(BASE_STATE_KEY);
    // A saved base came from the sign-in server; it is used only while it is still a gisoo.pro address.
    const saved = typeof stored === 'string' && isGisooServerBase(stored) ? stored : undefined;
    const custom = s.baseUrl && isAcceptableBaseUrl(s.baseUrl) ? s.baseUrl : '';
    this.client.setBaseUrl(custom || (saved && s.region === 'global' ? saved : baseUrlFromSettings(s)));
  }

  get region(): 'global' | 'iran' {
    return getSettings().region;
  }

  async hasKey(): Promise<boolean> {
    return Boolean(await this.context.secrets.get(SECRET_KEY));
  }

  getApiKey(): Promise<string | undefined> {
    return Promise.resolve(this.context.secrets.get(SECRET_KEY));
  }

  // -- Key sign-in -----------------------------------------------------------------------------

  /** Validates the format, then GET /me with that key; stores it only when /me accepts it. */
  async signInWithKey(input: string): Promise<AccountInfo> {
    const key = cleanApiKey(input);
    if (!key || !KEY_FORMAT.test(key)) {
      throw new GisooError('That does not look like a Gisoo key. Keys start with sk-gisoo-v1-', 'invalid_api_key', 401);
    }
    this.applyBase();
    const me = await this.client.meWithKey(key);
    await this.context.secrets.store(SECRET_KEY, key);
    return this.publish(this.fromMe(me));
  }

  // -- Browser sign-in (PKCE) --------------------------------------------------------------------

  async signInWithBrowser(): Promise<AccountInfo> {
    this.cancelPending(new Error('A newer sign-in was started.'));
    const pkce = createPkce();
    const publisher = (this.context.extension.packageJSON as { publisher?: string }).publisher ?? 'gisoo';
    const callback = vscode.Uri.parse(`${vscode.env.uriScheme}://${publisher}.gisoo-vscode/auth`);
    const redirect = (await vscode.env.asExternalUri(callback)).toString(true);
    const region = this.region;
    const host = region === 'iran' ? 'https://ir.gisoo.pro' : 'https://gisoo.pro';
    const params = new URLSearchParams({
      state: pkce.state,
      challenge: pkce.challenge,
      redirect,
      region,
      client: 'vscode',
    });
    const url = `${host}/app/vscode/connect?${params.toString()}`;

    const done = new Promise<AccountInfo>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.pkce.state === pkce.state) this.pending = undefined;
        reject(new Error('Sign-in timed out after 5 minutes. Please try again.'));
      }, BROWSER_TIMEOUT_MS);
      this.pending = { pkce, resolve, reject, timer };
    });
    const opened = await vscode.env.openExternal(vscode.Uri.parse(url));
    if (!opened) this.cancelPending(new Error('Could not open the browser.'));
    return done;
  }

  /** Called by VS Code when `<scheme>://<publisher>.gisoo-vscode/auth?code&state` is opened. */
  async handleUri(uri: vscode.Uri): Promise<void> {
    if (uri.path !== '/auth') return;
    const { code, state } = parseCallback(uri.query);
    const pending = this.pending;
    if (!pending) {
      void vscode.window.showWarningMessage('Gisoo: no sign-in is waiting. Start again from the Gisoo panel.');
      return;
    }
    if (!code || !state || state !== pending.pkce.state) {
      // Ignored rather than cancelled: any web page can open a vscode:// link, and a forged answer
      // must not be able to end the user's real sign-in.
      void vscode.window.showWarningMessage(hostStr(getSettings().language, 'host.auth.foreignAnswer'));
      return;
    }
    try {
      await this.exchange(pending, code);
    } catch {
      // The error already reached signInWithBrowser()'s caller through pending.reject.
    }
  }

  /** For "Enter sign-in code": the code shown on the web page, when the editor did not open. */
  async completeWithCode(code: string): Promise<AccountInfo> {
    const pending = this.pending;
    if (!pending) throw new Error('Start "Sign in with Gisoo" first, then paste the code from the web page.');
    const clean = code.trim();
    if (!/^[A-Za-z0-9_-]{6,200}$/.test(clean)) throw new Error('That code does not look right.');
    return this.exchange(pending, clean);
  }

  private async exchange(pending: Pending, code: string): Promise<AccountInfo> {
    clearTimeout(pending.timer);
    if (this.pending === pending) this.pending = undefined;
    try {
      this.applyBase();
      const token = await this.client.exchangeToken(code, pending.pkce.verifier);
      if (!token.api_key) throw new Error('The server did not return a key.');
      await this.context.secrets.store(SECRET_KEY, token.api_key);
      const s = getSettings();
      if (token.base_url && isGisooServerBase(token.base_url) && s.region === 'global' && !s.baseUrl) {
        await this.context.globalState.update(BASE_STATE_KEY, token.base_url);
        this.client.setBaseUrl(token.base_url);
      }
      const info = await this.refresh();
      pending.resolve(info);
      return info;
    } catch (error) {
      const err = this.explain(error);
      pending.reject(err);
      throw err;
    }
  }

  private explain(error: unknown): Error {
    if (error instanceof GisooError && (error.apiCode === 'invalid_grant' || (error.status === 400 && /invalid_grant/i.test(error.message)))) {
      return new Error('The sign-in code is invalid, already used or expired. Please start the sign-in again.');
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private cancelPending(reason: Error): void {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending = undefined;
    p.reject(reason);
  }

  // -- Account -------------------------------------------------------------------------------------

  async signOut(): Promise<AccountInfo> {
    this.cancelPending(new Error('Signed out.'));
    await this.context.secrets.delete(SECRET_KEY);
    await this.context.globalState.update(BASE_STATE_KEY, undefined);
    this.applyBase();
    return this.publish({ signedIn: false, baseUrl: this.client.baseUrl, region: this.region });
  }

  /** Last known account, without a network call. */
  getAccount(): AccountInfo {
    return this.last;
  }

  /** Fetches /me. Never throws: failures are reported in `error`. */
  async refresh(): Promise<AccountInfo> {
    if (!(await this.hasKey())) {
      return this.publish({ signedIn: false, baseUrl: this.client.baseUrl, region: this.region });
    }
    try {
      return this.publish(this.fromMe(await this.client.me()));
    } catch (error) {
      const code = error instanceof GisooError ? error.code : undefined;
      return this.publish({
        ...this.last,
        signedIn: code !== 'invalid_api_key',
        baseUrl: this.client.baseUrl,
        region: this.region,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private fromMe(me: MeResponse): AccountInfo {
    return {
      signedIn: true,
      balanceDisplay: me.balance?.usd_display,
      balanceUsd: me.balance?.usd,
      status: me.status,
      projectName: me.project?.name,
      keyName: me.key?.name,
      keyPrefix: me.key?.prefix,
      spendLimitUsd: me.key?.spend_limit_usd,
      spentUsd: me.key?.spent_usd,
      baseUrl: this.client.baseUrl,
      region: this.region,
    };
  }

  private publish(info: AccountInfo): AccountInfo {
    this.last = info;
    this.emitter.fire(info);
    return info;
  }

  dispose(): void {
    this.cancelPending(new Error('Extension deactivated.'));
    this.emitter.dispose();
  }
}
