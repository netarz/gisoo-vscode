import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { ModelInfo } from '../../src/shared/protocol';
import { formatContext, formatPerMillion } from '../format';
import { t } from '../strings';
import { post } from '../vscode';
import { useAppState } from '../store';
import { Icon, IconButton, Overlay, listKeyHandler, useScrollIntoView } from './common';

function matches(model: ModelInfo, query: string): boolean {
  if (!query) {
    return true;
  }
  const hay = `${model.name} ${model.id} ${model.description ?? ''}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).every((word) => hay.includes(word));
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
      <Icon name={current ? 'check' : 'circle-outline'} class="model-check" />
      <div class="list-main">
        <div class="list-title">
          <span class="model-name">{model.name}</span>
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

  const { recommended, rest } = useMemo(() => {
    const filtered = models.filter((model) => matches(model, query.trim()));
    const recommended = filtered.filter((model) => model.recommended);
    const rest = filtered.filter((model) => !model.recommended).sort((a, b) => a.name.localeCompare(b.name));
    return { recommended, rest };
  }, [models, query]);
  const flat = [...recommended, ...rest];
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
  const renderGroup = (label: string, items: ModelInfo[]) => {
    if (!items.length) {
      return null;
    }
    const start = offset;
    offset += items.length;
    return (
      <div class="list-group" role="group" aria-label={label}>
        <div class="list-group-label">{label}</div>
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
      <div class="list" id="model-list" role="listbox" aria-label={t('models.title')}>
        {flat.length === 0 ? <div class="list-empty">{t('models.empty')}</div> : null}
        {renderGroup(t('models.recommended'), recommended)}
        {renderGroup(t('models.all'), rest)}
      </div>
    </Overlay>
  );
}
