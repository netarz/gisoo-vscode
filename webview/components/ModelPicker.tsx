import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { ModelInfo } from '../../src/shared/protocol';
import { formatContext, formatPerMillion } from '../format';
import { t } from '../strings';
import { post } from '../vscode';
import { useAppState } from '../store';
import { BrandIcon, brandOf, brandRank, type BrandDef } from '../brands';
import { Icon, IconButton, Overlay, listKeyHandler, useScrollIntoView } from './common';
import { compact, fold, matchesWords, queryWords } from '../../src/shared/search';

/**
 * How well a model answers the query: 0 when its name starts with it, 1 when the name contains it,
 * 2 for any other match (id, brand, description), -1 for none. Folded, so case, Persian letters and
 * separators do not matter: «gpt4o» finds `gpt-4o`, «anthropic» finds every Claude.
 */
function score(model: ModelInfo, words: string[], whole: string): number {
  if (!words.length) {
    return 2;
  }
  const name = fold(model.name);
  const hay = `${name} ${fold(model.id)} ${fold(brandOf(model.id)?.name ?? '')} ${fold(model.description ?? '')}`;
  if (!matchesWords(hay, words, compact(`${model.name} ${model.id}`))) {
    return -1;
  }
  const nameCompact = compact(model.name);
  if (name.startsWith(whole) || nameCompact.startsWith(whole)) {
    return 0;
  }
  return name.includes(whole) || nameCompact.includes(whole) ? 1 : 2;
}

function ModelRow({ model, active, current, onPick, onHover }: {
  model: ModelInfo; active: boolean; current: boolean; onPick: () => void; onHover: () => void;
}): JSX.Element {
  const ref = useScrollIntoView<HTMLDivElement>(active);
  const hasPrice = model.inputPerMillion !== undefined || model.outputPerMillion !== undefined;
  return (
    <div
      ref={ref}
      id={`model-${model.id}`}
      role="option"
      aria-selected={active}
      class={`list-row model-row${active ? ' is-active' : ''}${current ? ' is-current' : ''}`}
      onMouseEnter={onHover}
      onClick={onPick}
      title={model.description ?? model.id}
    >
      <span class="model-brand"><BrandIcon brand={brandOf(model.id)} size={18} /></span>
      <div class="list-main">
        <div class="list-title">
          <span class="model-name">{model.name}</span>
          {current ? <Icon name="check" class="model-check" /> : null}
          {model.isFree ? <span class="badge badge-free">{t('models.free')}</span> : null}
          {model.vision ? <span class="badge" title={t('models.vision')} aria-label={t('models.vision')}><Icon name="eye" /></span> : null}
          {model.reasoning ? <span class="badge" title={t('models.reasoning')} aria-label={t('models.reasoning')}><Icon name="lightbulb" /></span> : null}
        </div>
        <div class="list-sub model-meta">
          <span class="model-id">{model.id}</span>
          {model.contextLength ? <span title={t('models.context')}><Icon name="symbol-ruler" /> {formatContext(model.contextLength)}</span> : null}
          {hasPrice ? (
            <span title={t('models.price')}>
              {formatPerMillion(model.inputPerMillion)} / {formatPerMillion(model.outputPerMillion)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ModelPicker({ onClose }: { onClose: () => void }): JSX.Element {
  const { models, session } = useAppState();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const [brandKey, setBrandKey] = useState<string | null>(null);

  // Brands present in the catalogue, with counts, in the fixed brand order; unknown ones are "other".
  const brandChips = useMemo(() => {
    const counts = new Map<string, { brand: BrandDef | undefined; count: number }>();
    for (const model of models) {
      const brand = brandOf(model.id);
      const key = brand?.key ?? 'other';
      const entry = counts.get(key) ?? { brand, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
    return [...counts.entries()].sort((a, b) => brandRank(a[1].brand) - brandRank(b[1].brand)).map(([key, v]) => ({ key, ...v }));
  }, [models]);

  const { recommended, groups } = useMemo(() => {
    const words = queryWords(query);
    const whole = compact(query);
    const scores = new Map<string, number>();
    const filtered = models.filter((model) => {
      if (brandKey !== null && (brandOf(model.id)?.key ?? 'other') !== brandKey) return false;
      const value = score(model, words, whole);
      scores.set(model.id, value);
      return value >= 0;
    });
    const byScore = (a: ModelInfo, b: ModelInfo) => (scores.get(a.id)! - scores.get(b.id)!) || a.name.localeCompare(b.name);
    const recommended = brandKey === null ? filtered.filter((model) => model.recommended) : [];
    const byBrand = new Map<string, { brand: BrandDef | undefined; items: ModelInfo[] }>();
    for (const model of filtered) {
      if (brandKey === null && model.recommended) continue;
      const brand = brandOf(model.id);
      const key = brand?.key ?? 'other';
      const group = byBrand.get(key) ?? { brand, items: [] };
      group.items.push(model);
      byBrand.set(key, group);
    }
    const groups = [...byBrand.values()].sort((a, b) => brandRank(a.brand) - brandRank(b.brand));
    for (const group of groups) group.items.sort(byScore);
    if (words.length) recommended.sort(byScore);
    return { recommended, groups };
  }, [models, query, brandKey]);
  const flat = [...recommended, ...groups.flatMap((group) => group.items)];
  const safeIndex = Math.min(index, Math.max(0, flat.length - 1));

  const pick = (model: ModelInfo | undefined) => {
    if (!model) {
      return;
    }
    if (model.id !== session.model) {
      post({ type: 'model.set', id: model.id });
    }
    onClose();
  };
  const onKey = listKeyHandler(flat.length, safeIndex, setIndex, (i) => pick(flat[i]), onClose);

  let offset = 0;
  const renderGroup = (label: string, items: ModelInfo[], brand?: BrandDef | null) => {
    if (!items.length) {
      return null;
    }
    const start = offset;
    offset += items.length;
    return (
      <div class="list-group" role="group" aria-label={label}>
        <div class="list-group-label model-group-label">
          {brand !== undefined ? <BrandIcon brand={brand ?? undefined} size={14} /> : null}
          <span>{label}</span>
          <span class="model-group-count">{items.length}</span>
        </div>
        {items.map((model, i) => (
          <ModelRow
            key={model.id}
            model={model}
            active={start + i === safeIndex}
            current={model.id === session.model}
            onPick={() => pick(model)}
            onHover={() => setIndex(start + i)}
          />
        ))}
      </div>
    );
  };

  return (
    <Overlay title={t('models.title')} onClose={onClose} class="models-panel">
      <div class="search-row">
        <Icon name="search" />
        <input
          type="text"
          class="search-input"
          placeholder={t('models.search')}
          aria-label={t('models.search')}
          value={query}
          onInput={(event) => { setQuery((event.target as HTMLInputElement).value); setIndex(0); }}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded="true"
          aria-controls="model-list"
          aria-activedescendant={flat[safeIndex] ? `model-${flat[safeIndex].id}` : undefined}
          autoComplete="off"
          spellcheck={false}
        />
        <IconButton icon="refresh" label={t('models.refresh')} onClick={() => post({ type: 'models.refresh' })} />
      </div>
      {brandChips.length > 1 ? (
        <div class="brand-chips" role="toolbar" aria-label={t('models.title')}>
          <button type="button" class={`brand-chip${brandKey === null ? ' is-on' : ''}`} onClick={() => { setBrandKey(null); setIndex(0); }}>
            {t('models.allBrands')}
          </button>
          {brandChips.map((chip) => (
            <button
              type="button"
              key={chip.key}
              class={`brand-chip${brandKey === chip.key ? ' is-on' : ''}`}
              title={`${chip.brand?.name ?? t('models.other')} (${chip.count})`}
              aria-pressed={brandKey === chip.key}
              onClick={() => { setBrandKey(brandKey === chip.key ? null : chip.key); setIndex(0); }}
            >
              <BrandIcon brand={chip.brand} size={14} />
              <span>{chip.brand?.name ?? t('models.other')}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div class="list" id="model-list" role="listbox" aria-label={t('models.title')}>
        {flat.length === 0 ? <div class="list-empty">{t('models.empty')}</div> : null}
        {renderGroup(t('models.recommended'), recommended)}
        {groups.map((group) => renderGroup(group.brand?.name ?? t('models.other'), group.items, group.brand ?? null))}
      </div>
    </Overlay>
  );
}
