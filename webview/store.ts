import { useEffect, useState } from 'preact/hooks';
import type { HostToWebview } from '../src/shared/protocol';
import { setStrings } from './strings';
import { initialState, reducer, type Action, type AppState } from './state';

// ---------------------------------------------------------------------------
// A tiny store: one state object, one reducer, subscribers re-render.
// ---------------------------------------------------------------------------

let state: AppState = initialState;
const listeners = new Set<(state: AppState) => void>();

export function getState(): AppState {
  return state;
}

export function subscribe(listener: (state: AppState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dispatch(action: Action): void {
  const next = reducer(state, action);
  if (next !== state) {
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
  }
}

/** Subscribe a component to the whole app state. */
export function useAppState(): AppState {
  const [snapshot, setSnapshot] = useState(state);
  useEffect(() => subscribe(setSnapshot), []);
  return snapshot;
}

// ---------------------------------------------------------------------------
// Streaming deltas are coalesced and flushed at most ~30 times a second, so a
// chatty model does not force a markdown parse per token.
// ---------------------------------------------------------------------------

interface PendingDelta { turnId: string; kind: 'text' | 'thinking'; text: string }
const pendingDeltas: PendingDelta[] = [];
let flushScheduled = false;
let lastFlush = 0;
const MIN_FRAME_MS = 32;

function flushDeltas(): void {
  flushScheduled = false;
  lastFlush = performance.now();
  const batch = pendingDeltas.splice(0, pendingDeltas.length);
  for (const delta of batch) {
    dispatch({ type: 'turn.delta', turnId: delta.turnId, kind: delta.kind, text: delta.text });
  }
}

function scheduleFlush(): void {
  if (flushScheduled) {
    return;
  }
  flushScheduled = true;
  const wait = Math.max(0, MIN_FRAME_MS - (performance.now() - lastFlush));
  if (wait === 0) {
    requestAnimationFrame(flushDeltas);
  } else {
    setTimeout(() => requestAnimationFrame(flushDeltas), wait);
  }
}

function queueDelta(delta: PendingDelta): void {
  const last = pendingDeltas[pendingDeltas.length - 1];
  if (last && last.turnId === delta.turnId && last.kind === delta.kind) {
    last.text += delta.text;
  } else {
    pendingDeltas.push({ ...delta });
  }
  scheduleFlush();
}

/** Entry point for every message from the extension host. */
export function handleHostMessage(message: HostToWebview): void {
  if (message.type === 'turn.delta') {
    queueDelta({ turnId: message.turnId, kind: message.kind, text: message.text });
    return;
  }
  // Keep ordering: anything else lands after the deltas that preceded it.
  if (pendingDeltas.length) {
    flushDeltas();
  }
  if (message.type === 'init') {
    setStrings(message.state.strings);
    document.documentElement.dir = message.state.language === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = message.state.language;
  }
  dispatch(message);
}
