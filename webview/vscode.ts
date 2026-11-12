import type { WebviewToHost } from '../src/shared/protocol';

export interface PersistedState {
  draft?: string;
  scrollTop?: number;
  sessionId?: string;
}

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): PersistedState | undefined;
  setState(state: PersistedState): void;
}

declare global {
  function acquireVsCodeApi(): VsCodeApi;
}

let api: VsCodeApi | undefined;

function vscode(): VsCodeApi {
  if (!api) {
    api = acquireVsCodeApi();
  }
  return api;
}

/** Send a message to the extension host. Only messages from the protocol are accepted. */
export function post(message: WebviewToHost): void {
  vscode().postMessage(message);
}

export function getPersisted(): PersistedState {
  return vscode().getState() ?? {};
}

let pending: PersistedState | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Merge into the persisted UI state (debounced; the host keeps it across reloads). */
export function persist(patch: PersistedState): void {
  pending = { ...(pending ?? getPersisted()), ...patch };
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    if (pending) {
      vscode().setState(pending);
    }
    pending = undefined;
    timer = undefined;
  }, 150);
}
