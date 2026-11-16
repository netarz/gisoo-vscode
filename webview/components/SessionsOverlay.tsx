import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  EXTERNAL_SOURCES,
  type ExternalSessionSummary,
  type ExternalSource,
  type SessionSummary,
} from '../../src/shared/protocol';
import { fold, matchRanges, matchesWords, queryWords } from '../../src/shared/search';
import { t } from '../strings';
import { post } from '../vscode';
import { useAppState } from '../store';
import { ToolIcon } from '../brands';
import { GisooMark } from './GisooMark';
import { Button, Icon, IconButton, Overlay, listKeyHandler, useScrollIntoView } from './common';

/** How long typing must pause before the chats' messages are searched on the host. */
const SEARCH_DELAY_MS = 180;

/** Unique across panel openings, so a late answer to an earlier panel is never shown. */
let searchSeq = 0;

type Filter = 'all' | 'gisoo' | ExternalSource;

const SOURCE_NAMES = new Map<string, string>(EXTERNAL_SOURCES.map((def) => [def.id, def.name]));

/** The tool a Gisoo chat was continued from (`origin` is `source:id`), if it came from one. */
function originSource(item: SessionSummary): ExternalSource | undefined {
  const source = item.origin?.split(':')[0];
  return source && SOURCE_NAMES.has(source) ? (source as ExternalSource) : undefined;
}

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

/** `text` with the searched words marked. */
function Highlight({ text, words }: { text: string; words: string[] }): JSX.Element {
  const ranges = words.length ? matchRanges(text, words) : [];
  if (!ranges.length) {
    return <>{text}</>;
  }
  const out: Array<string | JSX.Element> = [];
  let at = 0;
  ranges.forEach(([start, end], i) => {
    if (start > at) out.push(text.slice(at, start));
    out.push(<mark key={i}>{text.slice(start, end)}</mark>);
    at = end;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

/** The mark of the system a chat was made in: Gisoo, or the tool it was started in. */
function SourceMark({ source }: { source: ExternalSource | undefined }): JSX.Element {
  const name = source ? SOURCE_NAMES.get(source) ?? source : t('sessions.gisoo');
  return (
    <span class="session-source" title={t('sessions.startedIn', { name })}>
      {source ? <ToolIcon source={source} size={16} /> : <GisooMark size={16} class="session-gisoo" />}
    </span>
  );
}

function Row({ id, active, current, onHover, onPick, title, children, extra }: {
  id: string;
  active: boolean;
  current?: boolean;
  onHover: () => void;
  onPick: () => void;
  title?: string;
  children: JSX.Element | JSX.Element[];
  extra?: JSX.Element | null;
}): JSX.Element {
  const ref = useScrollIntoView<HTMLDivElement>(active);
  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={active}
      title={title}
      class={`list-row session-row${active ? ' is-active' : ''}${current ? ' is-current' : ''}`}
      onMouseEnter={onHover}
      onClick={onPick}
    >
      {children}
      {extra ?? null}
    </div>
  );
}

export function SessionsOverlay({ onClose }: { onClose: () => void }): JSX.Element {
  const { sessions, session, external, externalLoading, externalEnabled, sessionHits } = useAppState();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [index, setIndex] = useState(-1);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingSeq, setPendingSeq] = useState(0);
  const words = useMemo(() => queryWords(query), [query]);
  const externalItems = externalEnabled ? external : [];

  // Search inside the messages once typing pauses; again when the list of chats changes.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!words.length) {
      setPendingSeq(0);
      return;
    }
    timer.current = setTimeout(() => {
      const seq = ++searchSeq;
      setPendingSeq(seq);
      post({ type: 'session.search', query: query.trim(), seq });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer.current);
  }, [query, sessions]);
  const hits = pendingSeq && sessionHits && sessionHits.seq === pendingSeq
    ? new Map(sessionHits.hits.map((hit) => [hit.id, hit.snippet]))
    : null;
  const searching = words.length > 0 && hits === null;

  // Which systems have chats here, for the filter chips.
  const chips = useMemo(() => {
    const counts = new Map<'gisoo' | ExternalSource, number>();
    for (const item of sessions) {
      const key = originSource(item) ?? 'gisoo';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const item of externalItems) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
    const order: Array<'gisoo' | ExternalSource> = ['gisoo', ...EXTERNAL_SOURCES.map((def) => def.id)];
    return order.filter((key) => counts.has(key)).map((key) => ({ key, count: counts.get(key)! }));
  }, [sessions, externalItems]);
  const activeFilter: Filter = filter !== 'all' && !chips.some((chip) => chip.key === filter) ? 'all' : filter;

  const shown = useMemo(() => {
    const inFilter = (source: ExternalSource | undefined) =>
      activeFilter === 'all' || (activeFilter === 'gisoo' ? source === undefined : source === activeFilter);
    const gisoo: Array<{ item: SessionSummary; source: ExternalSource | undefined; snippet: string }> = [];
    for (const item of sessions) {
      const source = originSource(item);
      if (!inFilter(source)) continue;
      if (!words.length) {
        gisoo.push({ item, source, snippet: '' });
        continue;
      }
      const titleHit = matchesWords(fold(item.title || ''), words);
      const snippet = hits?.get(item.id);
      if (titleHit || snippet !== undefined) gisoo.push({ item, source, snippet: titleHit ? '' : snippet ?? '' });
    }
    const groups = EXTERNAL_SOURCES
      .filter((def) => activeFilter === 'all' || activeFilter === def.id)
      .map((def) => ({
        source: def.id,
        name: def.name,
        items: externalItems.filter((item) => item.source === def.id && (!words.length || matchesWords(fold(item.title || ''), words))),
      }))
      .filter((group) => group.items.length > 0);
    return { gisoo, groups };
  }, [sessions, externalItems, words, hits, activeFilter]);

  const externalFlat: ExternalSessionSummary[] = shown.groups.flatMap((group) => group.items);
  const total = shown.gisoo.length + externalFlat.length;
  // Start on the open chat; after typing or filtering, on the first result.
  const startIndex = Math.max(0, shown.gisoo.findIndex((entry) => entry.item.id === session.id));
  const safeIndex = total ? Math.min(index < 0 ? startIndex : index, total - 1) : 0;

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
    if (i < shown.gisoo.length) {
      openSession(shown.gisoo[i].item);
    } else if (externalFlat[i - shown.gisoo.length]) {
      importExternal(externalFlat[i - shown.gisoo.length]);
    }
  };
  const onKey = listKeyHandler(total, safeIndex, setIndex, pick, onClose);
  const rowId = (i: number): string | undefined => {
    if (i < shown.gisoo.length) return shown.gisoo[i] ? `session-${shown.gisoo[i].item.id}` : undefined;
    const item = externalFlat[i - shown.gisoo.length];
    return item ? `external-${item.source}-${item.id}` : undefined;
  };
  const setFilterTo = (next: Filter) => {
    setFilter(next);
    setIndex(0);
  };

  let emptyText: string | null = null;
  if (total === 0) {
    if (words.length) emptyText = searching ? t('sessions.searching') : t('sessions.noMatch');
    else if (!(externalEnabled && externalLoading)) emptyText = t('sessions.empty');
  }

  return (
    <Overlay title={t('sessions.title')} onClose={onClose} class="sessions-panel">
      <div class="search-row">
        <Icon name="search" />
        <input
          type="text"
          class="search-input"
          placeholder={t('sessions.search')}
          aria-label={t('sessions.search')}
          value={query}
          onInput={(event) => { setQuery((event.target as HTMLInputElement).value); setIndex(0); }}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded="true"
          aria-controls="session-list"
          aria-activedescendant={rowId(safeIndex)}
          autoComplete="off"
          spellcheck={false}
          dir="auto"
        />
        <IconButton icon="add" label={t('sessions.new')} onClick={() => { post({ type: 'session.new' }); onClose(); }} />
      </div>
      {chips.length > 1 ? (
        <div class="brand-chips" role="toolbar" aria-label={t('sessions.title')}>
          <button type="button" class={`brand-chip${activeFilter === 'all' ? ' is-on' : ''}`} aria-pressed={activeFilter === 'all'} onClick={() => setFilterTo('all')}>
            {t('sessions.all')}
          </button>
          {chips.map((chip) => {
            const name = chip.key === 'gisoo' ? t('sessions.gisoo') : SOURCE_NAMES.get(chip.key) ?? chip.key;
            return (
              <button
                type="button"
                key={chip.key}
                class={`brand-chip${activeFilter === chip.key ? ' is-on' : ''}`}
                title={`${name} (${chip.count})`}
                aria-pressed={activeFilter === chip.key}
                onClick={() => setFilterTo(activeFilter === chip.key ? 'all' : chip.key)}
              >
                {chip.key === 'gisoo' ? <GisooMark size={14} class="session-gisoo" /> : <ToolIcon source={chip.key} size={14} />}
                <span>{name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div class="list" id="session-list" role="listbox" aria-label={t('sessions.title')}>
        {emptyText ? <div class="list-empty">{emptyText}</div> : null}
        {shown.gisoo.map(({ item, source, snippet }, i) => (
          <Row
            key={item.id}
            id={`session-${item.id}`}
            active={i === safeIndex}
            current={item.id === session.id}
            onHover={() => setIndex(i)}
            onPick={() => openSession(item)}
            extra={confirmId === item.id ? (
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
          >
            <SourceMark source={source} />
            <div class="list-main">
              <div class="list-title" dir="auto"><span class="session-title"><Highlight text={item.title || t('header.title.untitled')} words={words} /></span></div>
              {snippet ? <div class="session-snippet" dir="auto"><Highlight text={snippet} words={words} /></div> : null}
              <div class="list-sub">{relativeTime(item.updatedAt)} · {t('sessions.turns', { n: item.turnCount })}</div>
            </div>
          </Row>
        ))}
        {externalEnabled && externalLoading && externalFlat.length === 0 && !words.length ? <div class="list-empty">{t('sessions.external.loading')}</div> : null}
        {shown.groups.map((group) => {
          const start = shown.gisoo.length + externalFlat.findIndex((item) => item.source === group.source);
          return (
            <div key={group.source} class="list-group" role="group" aria-label={t('sessions.external.group', { name: group.name })}>
              <div class="list-group-label session-group-label" title={t('sessions.external.hint')}>
                <ToolIcon source={group.source} size={14} /> <span>{t('sessions.external.group', { name: group.name })}</span>
                <span class="model-group-count">{group.items.length}</span>
              </div>
              {group.items.map((item, j) => {
                const i = start + j;
                return (
                  <Row
                    key={item.id}
                    id={`external-${item.source}-${item.id}`}
                    active={i === safeIndex}
                    title={t('sessions.external.hint')}
                    onHover={() => setIndex(i)}
                    onPick={() => importExternal(item)}
                  >
                    <SourceMark source={item.source} />
                    <div class="list-main">
                      <div class="list-title" dir="auto"><span class="session-title"><Highlight text={item.title || t('header.title.untitled')} words={words} /></span></div>
                      <div class="list-sub">{relativeTime(item.updatedAt)}{item.importedId ? ` · ${t('sessions.external.imported')}` : ''}</div>
                    </div>
                  </Row>
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
