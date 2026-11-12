import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AgentInfo, AgentStatus } from '../../src/shared/protocol';
import { clampText, formatDuration, formatTokens, formatUsd } from '../format';
import { t, type StringKey } from '../strings';
import { useAppState } from '../store';
import { post } from '../vscode';
import { Icon, IconButton, Overlay } from './common';

const STATUS_ICON: Record<AgentStatus, string> = {
  running: 'loading',
  waiting: 'clock',
  done: 'pass-filled',
  failed: 'error',
  stopped: 'circle-slash',
};

const STATUS_KEY: Record<AgentStatus, StringKey> = {
  running: 'agents.status.running',
  waiting: 'agents.status.waiting',
  done: 'agents.status.done',
  failed: 'agents.status.failed',
  stopped: 'agents.status.stopped',
};

export function isActiveAgent(item: AgentInfo): boolean {
  return item.status === 'running' || item.status === 'waiting';
}

/** A clock that ticks once a second while something runs, so elapsed times stay live. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function elapsed(item: AgentInfo, now: number): string {
  return formatDuration(Math.max(0, (item.endedAt ?? now) - item.startedAt));
}

/** Running agents first (newest start on top), then finished ones by end time. */
function sortAgents(items: AgentInfo[]): AgentInfo[] {
  const rank = (item: AgentInfo): number => (isActiveAgent(item) ? 0 : 1);
  return items.slice().sort((a, b) => rank(a) - rank(b) || (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
}

function AgentRow({ item, now }: { item: AgentInfo; now: number }): JSX.Element {
  const active = isActiveAgent(item);
  return (
    <div class={`agent-row agent-status-${item.status}`} role="listitem">
      <Icon name={STATUS_ICON[item.status]} spin={item.status === 'running'} class="agent-icon" />
      <div class="list-main">
        <div class="list-title agent-title" dir="auto">
          <span class="agent-name">{item.name}</span>
          <span class="agent-model">{item.model}</span>
        </div>
        <div class="list-sub agent-meta">
          <span class="badge agent-badge">{t(STATUS_KEY[item.status])}</span>
          <span>{elapsed(item, now)}</span>
          <span>{t('agents.tokens', { n: formatTokens(item.tokens) })}</span>
          <span>{formatUsd(item.costUsd)}</span>
          {item.parentId ? <span class="agent-parent">{t('agents.parent', { id: item.parentId })}</span> : null}
        </div>
        {item.lastStep ? <div class="list-sub agent-step" dir="auto" title={item.lastStep}>{clampText(item.lastStep, 160)}</div> : null}
      </div>
      <div class="agent-actions">
        {active ? <IconButton icon="debug-stop" label={t('agents.stop')} onClick={() => post({ type: 'agent.stop', id: item.id })} /> : null}
        <IconButton icon="open-preview" label={t('agents.openTranscript')} onClick={() => post({ type: 'agent.open', id: item.id })} />
        {active ? null : <IconButton icon="refresh" label={t('agents.retry')} onClick={() => post({ type: 'agent.retry', id: item.id })} />}
      </div>
    </div>
  );
}

/** The agents panel under the header: every running and finished agent with stop / open / retry. */
export function AgentsOverlay({ onClose }: { onClose: () => void }): JSX.Element {
  const { agents } = useAppState();
  const items = sortAgents(agents);
  const now = useNow(items.some(isActiveAgent));
  return (
    <Overlay title={t('agents.panel.title')} onClose={onClose} class="agents-panel" initialFocus={false}>
      <div class="list agents-list" role="list" aria-label={t('agents.panel.title')}>
        {items.length === 0 ? <div class="list-empty">{t('agents.panel.empty')}</div> : null}
        {items.map((item) => <AgentRow key={item.id} item={item} now={now} />)}
      </div>
    </Overlay>
  );
}

/** Compact chips above the input while agents run: name, elapsed time and a stop button. */
export function AgentStrip(): JSX.Element | null {
  const { agents } = useAppState();
  const running = agents.filter(isActiveAgent);
  const now = useNow(running.length > 0);
  if (!running.length) {
    return null;
  }
  return (
    <div class="agent-strip" aria-label={t('agents.strip.label')}>
      {running.map((item) => (
        <div key={item.id} class={`agent-chip agent-status-${item.status}`} title={item.lastStep ?? t(STATUS_KEY[item.status])}>
          <Icon name={STATUS_ICON[item.status]} spin={item.status === 'running'} />
          <span class="agent-chip-name" dir="auto">{item.name}</span>
          <span class="agent-chip-time">{elapsed(item, now)}</span>
          <IconButton icon="debug-stop" label={t('agents.stop')} class="chip-remove" onClick={() => post({ type: 'agent.stop', id: item.id })} />
        </div>
      ))}
    </div>
  );
}
