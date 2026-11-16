import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ExternalSessionSummary, ExternalSource, SessionSummary } from '../../src/shared/protocol';
import { t } from '../strings';
import { post } from '../vscode';
import { useAppState } from '../store';
import { Button, Icon, IconButton, Overlay, listKeyHandler } from './common';

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) {
    return t('sessions.justNow');
  }
  if (minutes < 60) {
    return t('sessions.minutesAgo', { n: minutes });
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return t('sessions.hoursAgo', { n: hours });
  }
  return t('sessions.daysAgo', { n: Math.round(hours / 24) });
}

const EXTERNAL_SOURCES: Array<{ source: ExternalSource; name: string; icon: string }> = [
  { source: 'claude-code', name: 'Claude Code', icon: 'sparkle' },
  { source: 'codex', name: 'Codex', icon: 'terminal' },
];

export function SessionsOverlay({ onClose }: { onClose: () => void }): JSX.Element {
  const { sessions, session, external, externalLoading, externalEnabled } = useAppState();
  const groups = externalEnabled
    ? EXTERNAL_SOURCES.map((def) => ({ ...def, items: external.filter((item) => item.source === def.source) })).filter((group) => group.items.length > 0)
    : [];
  const externalFlat: ExternalSessionSummary[] = groups.flatMap((group) => group.items);
  const total = sessions.length + externalFlat.length;
  const [index, setIndex] = useState(Math.max(0, sessions.findIndex((item) => item.id === session.id)));
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const openSession = (item: SessionSummary) => {
    if (item.id !== session.id) {
      post({ type: 'session.open', id: item.id });
    }
    onClose();
  };
  const importExternal = (item: ExternalSessionSummary) => {
    post({ type: 'external.import', source: item.source, id: item.id });
    onClose();
  };
  const pick = (i: number) => {
    if (i < sessions.length) {
      openSession(sessions[i]);
    } else if (externalFlat[i - sessions.length]) {
      importExternal(externalFlat[i - sessions.length]);
    }
  };
  const onKey = listKeyHandler(total, index, setIndex, pick, onClose);
  const activeId = index < sessions.length
    ? (sessions[index] ? `session-${sessions[index].id}` : undefined)
    : (externalFlat[index - sessions.length] ? `external-${externalFlat[index - sessions.length].source}-${externalFlat[index - sessions.length].id}` : undefined);

  return (
    <Overlay title={t('sessions.title')} onClose={onClose} class="sessions-panel" initialFocus={false}>
      <div class="overlay-actions">
        <Button kind="primary" icon="add" onClick={() => { post({ type: 'session.new' }); onClose(); }}>{t('sessions.new')}</Button>
      </div>
      <div class="list" role="listbox" tabIndex={0} onKeyDown={onKey} aria-label={t('sessions.title')} aria-activedescendant={activeId}>
        {sessions.length === 0 && externalFlat.length === 0 && !externalLoading ? <div class="list-empty">{t('sessions.empty')}</div> : null}
        {sessions.map((item, i) => (
          <div
            key={item.id}
            id={`session-${item.id}`}
            role="option"
            aria-selected={i === index}
            class={`list-row session-row${i === index ? ' is-active' : ''}${item.id === session.id ? ' is-current' : ''}`}
            onMouseEnter={() => setIndex(i)}
            onClick={() => openSession(item)}
          >
            <Icon name={item.id === session.id ? 'comment-discussion' : 'comment'} />
            <div class="list-main">
              <div class="list-title" dir="auto">{item.title || t('header.title.untitled')}</div>
              <div class="list-sub">{relativeTime(item.updatedAt)} · {t('sessions.turns', { n: item.turnCount })}</div>
            </div>
            {confirmId === item.id ? (
              <span class="list-confirm" onClick={(event) => event.stopPropagation()}>
                <span>{t('sessions.deleteConfirm')}</span>
                <Button kind="danger" onClick={() => { post({ type: 'session.delete', id: item.id }); setConfirmId(null); }}>{t('sessions.delete')}</Button>
                <Button kind="ghost" onClick={() => setConfirmId(null)}>{t('turn.cancel')}</Button>
              </span>
            ) : (
              <IconButton
                icon="trash"
                label={t('sessions.delete')}
                class="list-row-action"
                onClick={(event) => { event.stopPropagation(); setConfirmId(item.id); }}
              />
            )}
          </div>
        ))}
        {externalEnabled && externalLoading && externalFlat.length === 0 ? <div class="list-empty">{t('sessions.external.loading')}</div> : null}
        {groups.map((group) => {
          const start = sessions.length + externalFlat.findIndex((item) => item.source === group.source);
          return (
            <div key={group.source} class="list-group" role="group" aria-label={t('sessions.external.group', { name: group.name })}>
              <div class="list-group-label" title={t('sessions.external.hint')}>
                <Icon name={group.icon} /> <span>{t('sessions.external.group', { name: group.name })}</span>
              </div>
              {group.items.map((item, j) => {
                const i = start + j;
                return (
                  <div
                    key={item.id}
                    id={`external-${item.source}-${item.id}`}
                    role="option"
                    aria-selected={i === index}
                    title={t('sessions.external.hint')}
                    class={`list-row session-row${i === index ? ' is-active' : ''}`}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => importExternal(item)}
                  >
                    <Icon name="comment" />
                    <div class="list-main">
                      <div class="list-title" dir="auto">{item.title || t('header.title.untitled')}</div>
                      <div class="list-sub">{relativeTime(item.updatedAt)}{item.importedId ? ` · ${t('sessions.external.imported')}` : ''}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        {externalEnabled && externalLoading && externalFlat.length > 0 ? <div class="list-empty">{t('sessions.external.loading')}</div> : null}
      </div>
    </Overlay>
  );
}
