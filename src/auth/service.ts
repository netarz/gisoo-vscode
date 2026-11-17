/**
 * Sign-in for Gisoo. The API key lives only in SecretStorage (`gisoo.apiKey`); it is never logged,
 * never put in a URL and never sent to the webview. Browser sign-in is PKCE with a one-time code.
 */
import * as vscode from 'vscode';
import { GisooClient, GisooError } from '../api/client';
import type { MeResponse } from '../api/types';
import type { AccountInfo } from '../shared/protocol';
import { formatCoins, toNumber, usdToCoins } from '../shared/coins';
import { baseUrlFromSettings, getSettings } from '../config';
import { isAcceptableBaseUrl, isGisooServerBase } from '../security';
import { hostStr, type HostStringKey } from '../ui/strings';
import { cleanApiKey, createPkce, extractSignInCode, parseCallback, type PkcePair } from './pkce';

export const SECRET_KEY = 'gisoo.apiKey';
const BASE_STATE_KEY = 'gisoo.resolvedBaseUrl';
/** How long a started browser sign-in waits for its code. Matches the server's code lifetime. */
const BROWSER_TIMEOUT_MS = 15 * 60 * 1000;
/**
 * The PKCE pair of a sign-in in progress. Kept in SecretStorage, not only in memory, so the code
 * can still be redeemed after the window reloads, after the in-memory wait gave up, or in another
 * window of the same editor (the browser hands the URI to whichever window was used last).
 */
const PENDING_SECRET = 'gisoo.pendingSignIn';
const KEY_FORMAT = /^sk-(gisoo|ntz)-v1-[A-Za-z0-9_-]{8,}$/;

/** What is kept between windows and reloads: the PKCE pair and the page it was started with. */
interface StoredPending extends PkcePair {
  url?: string;
}

interface Pending {
  pkce: PkcePair;
  /** The sign-in page, so the panel can copy or reopen it without starting a new sign-in. */
  url?: string;
  resolve: (info: AccountInfo) => void;
  reject: (error: Error) => void;
  /** Undefined for a pair restored from storage: nobody is awaiting it. */
  timer: NodeJS.Timeout | undefined;
}


export class AuthService implements vscode.UriHandler, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<AccountInfo>();
  readonly onDidChange = this.emitter.event;
  private pending: Pending | undefined;
  private last: AccountInfo;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext, private readonly client: GisooClient) {
    this.last = { signedIn: false, baseUrl: client.baseUrl, region: getSettings().region };
    this.applyBase();
    // Another window signed in, started a sign-in or signed out: follow it here too.
    this.subscriptions.push(context.secrets.onDidChange((e) => {
      if (e.key === SECRET_KEY) void this.refresh();
      if (e.key === PENDING_SECRET) void this.syncWaiting();
    }));
    void this.syncWaiting();
  }

  private tr(key: HostStringKey, ...args: Array<string | number>): string {
    return hostStr(getSettings().language, key, ...args);
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
    this.cancelPending(new Error(this.tr('host.auth.superseded')));
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
      // The consent page names the app that asks: Gisoo Desktop runs this same code under its own scheme.
      client: vscode.env.uriScheme === 'gisoo-desktop' ? 'desktop' : 'vscode',
    });
    const url = `${host}/app/vscode/connect?${params.toString()}`;

    await this.storePending(pkce, url);
    const done = new Promise<AccountInfo>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.pkce.state === pkce.state) this.pending = undefined;
        void this.clearPending().then(() => this.publishWaiting(false));
        reject(new Error(this.tr('host.auth.timeout')));
      }, BROWSER_TIMEOUT_MS);
      this.pending = { pkce, url, resolve, reject, timer };
    });
    // Callers that do not await (the panel) must not see an unhandled rejection.
    done.catch(() => undefined);
    this.publishWaiting(true, url);
    // `false` also means the user chose "Copy" in VS Code's link dialog to open the page somewhere
    // else (another browser, a phone). The sign-in stays open either way: the panel keeps waiting
    // for the code and offers the link again.
    await vscode.env.openExternal(vscode.Uri.parse(url));
    return done;
  }

  /** The page of the sign-in in progress, if any. */
  async signInUrl(): Promise<string | undefined> {
    if (this.pending?.url) return this.pending.url;
    return (await this.loadPending())?.url;
  }

  /** Copies the sign-in page to the clipboard. False when no sign-in is waiting. */
  async copySignInLink(): Promise<boolean> {
    const url = await this.signInUrl();
    if (!url) return false;
    await vscode.env.clipboard.writeText(url);
    return true;
  }

  /** Opens the page of the sign-in in progress again, without starting a new one. */
  async reopenSignInPage(): Promise<boolean> {
    const url = await this.signInUrl();
    if (!url) return false;
    await vscode.env.openExternal(vscode.Uri.parse(url));
    return true;
  }

  /** Abandons a sign-in in progress (the Cancel button on the panel). */
  async cancelSignIn(): Promise<void> {
    this.cancelPending(new Error(this.tr('host.auth.cancelled')));
    await this.clearPending();
    this.publishWaiting(false);
  }

  /** Called by VS Code when `<scheme>://<publisher>.gisoo-vscode/auth?code&state` is opened. */
  async handleUri(uri: vscode.Uri): Promise<void> {
    if (uri.path !== '/auth') return;
    const { code, state } = parseCallback(uri.query);
    if (!code || !state) return;
    const pending = await this.findPending(state);
    if (!pending) {
      // Ignored rather than cancelled: any web page can open a vscode:// link, and a forged answer
      // must not be able to end the user's real sign-in.
      const waiting = Boolean(this.pending) || Boolean(await this.loadPending());
      void vscode.window.showWarningMessage(this.tr(waiting ? 'host.auth.foreignAnswer' : 'host.auth.noPending'));
      return;
    }
    try {
      const info = await this.exchange(pending, code);
      void vscode.window.showInformationMessage(info.balanceCoins !== undefined ? this.tr('host.signedInWithBalance', formatCoins(info.balanceCoins, getSettings().language)) : this.tr('host.signedIn'));
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  /** The code shown on the web page, pasted into the panel or the "Enter sign-in code" box. */
  async completeWithCode(input: string): Promise<AccountInfo> {
    const code = extractSignInCode(input);
    if (!code) throw this.fail(this.tr('host.auth.badCode'));
    const pending = await this.findPending();
    if (!pending) throw this.fail(this.tr('host.auth.noPending'));
    return this.exchange(pending, code);
  }

  /**
   * The sign-in a code belongs to: this window's live one, else the stored pair (another window, a
   * reload, or after the in-memory wait ended). With `state`, only a matching pair is returned.
   */
  private async findPending(state?: string): Promise<Pending | undefined> {
    if (this.pending && (!state || this.pending.pkce.state === state)) return this.pending;
    const stored = await this.loadPending();
    if (!stored || (state && stored.state !== state)) return undefined;
    return { pkce: stored, url: stored.url, resolve: () => undefined, reject: () => undefined, timer: undefined };
  }

  private async storePending(pkce: PkcePair, url: string): Promise<void> {
    const stored: StoredPending = { ...pkce, url };
    await this.context.secrets.store(PENDING_SECRET, JSON.stringify(stored));
  }

  private async loadPending(): Promise<StoredPending | undefined> {
    const raw = await this.context.secrets.get(PENDING_SECRET);
    if (!raw) return undefined;
    try {
      const p = JSON.parse(raw) as StoredPending;
      if (typeof p.state !== 'string' || typeof p.verifier !== 'string' || typeof p.createdAt !== 'number') return undefined;
      if (p.url !== undefined && (typeof p.url !== 'string' || !p.url.startsWith('https://'))) p.url = undefined;
      if (Date.now() - p.createdAt > BROWSER_TIMEOUT_MS) {
        await this.clearPending();
        return undefined;
      }
      return p;
    } catch {
      return undefined;
    }
  }

  private async clearPending(): Promise<void> {
    await this.context.secrets.delete(PENDING_SECRET);
  }

  private async syncWaiting(): Promise<void> {
    const waiting = Boolean(this.pending) || Boolean(await this.loadPending());
    const url = waiting ? await this.signInUrl() : undefined;
    if (Boolean(this.last.signInWaiting) !== waiting || this.last.signInUrl !== url) this.publishWaiting(waiting, url);
  }

  private publishWaiting(waiting: boolean, url?: string): void {
    this.publish({
      ...this.last,
      signInWaiting: waiting ? true : undefined,
      signInUrl: waiting ? url : undefined,
      signInError: undefined,
    });
  }

  /** Puts the message on the sign-in card as well as returning it. */
  private fail(message: string): Error {
    this.publish({ ...this.last, signInError: message });
    return new Error(message);
  }

  private async exchange(pending: Pending, code: string): Promise<AccountInfo> {
    if (pending.timer) clearTimeout(pending.timer);
    if (this.pending === pending) this.pending = undefined;
    try {
      this.applyBase();
      const token = await this.client.exchangeToken(code, pending.pkce.verifier);
      if (!token.api_key) throw new Error(this.tr('host.auth.noKey'));
      await this.context.secrets.store(SECRET_KEY, token.api_key);
      const s = getSettings();
      if (token.base_url && isGisooServerBase(token.base_url) && s.region === 'global' && !s.baseUrl) {
        await this.context.globalState.update(BASE_STATE_KEY, token.base_url);
        this.client.setBaseUrl(token.base_url);
      }
      // The code is spent: the stored pair would only produce invalid_grant from now on.
      await this.clearPending();
      const info = await this.refresh();
      pending.resolve(info);
      return info;
    } catch (error) {
      const err = this.explain(error);
      // A wrong code keeps the sign-in open (the user may have mistyped); only an expired pair ends it.
      const waiting = Boolean(this.pending) || Boolean(await this.loadPending());
      const url = waiting ? await this.signInUrl() : undefined;
      this.publish({ ...this.last, signInWaiting: waiting ? true : undefined, signInUrl: url, signInError: err.message });
      pending.reject(err);
      throw err;
    }
  }

  private explain(error: unknown): Error {
    if (error instanceof GisooError && (error.apiCode === 'invalid_grant' || (error.status === 400 && /invalid_grant/i.test(error.message)))) {
      return new Error(this.tr('host.auth.codeRejected'));
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private cancelPending(reason: Error): void {
    const p = this.pending;
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    this.pending = undefined;
    p.reject(reason);
  }

  // -- Account -------------------------------------------------------------------------------------

  async signOut(): Promise<AccountInfo> {
    this.cancelPending(new Error(this.tr('host.auth.cancelled')));
    await this.clearPending();
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
    const balanceUsd = toNumber(me.balance?.usd);
    const coinRate = toNumber(me.balance?.coin_rate);
    const limitUsd = me.key?.spend_limit_usd === null ? null : toNumber(me.key?.spend_limit_usd);
    const spentUsd = toNumber(me.key?.spent_usd);
    return {
      signedIn: true,
      balanceCoins: toNumber(me.balance?.coins) ?? usdToCoins(balanceUsd, coinRate),
      coinRate,
      balanceUsd,
      status: me.status,
      projectName: me.project?.name,
      keyName: me.key?.name,
      keyPrefix: me.key?.prefix,
      spendLimitUsd: limitUsd,
      spentUsd,
      spendLimitCoins: limitUsd === null ? null : usdToCoins(limitUsd, coinRate),
      spentCoins: usdToCoins(spentUsd, coinRate),
      baseUrl: this.client.baseUrl,
      region: this.region,
    };
  }

  private publish(info: AccountInfo): AccountInfo {
    // A signed-in account is never waiting for a sign-in and carries no sign-in error.
    if (info.signedIn && !info.error) info = { ...info, signInWaiting: undefined, signInUrl: undefined, signInError: undefined };
    this.last = info;
    this.emitter.fire(info);
    return info;
  }

  dispose(): void {
    this.cancelPending(new Error(this.tr('host.auth.cancelled')));
    for (const d of this.subscriptions) d.dispose();
    this.emitter.dispose();
  }
}
