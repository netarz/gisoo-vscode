import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Attachment, PermissionMode, SlashCommandInfo } from '../../src/shared/protocol';
import { basename, formatPercent, formatUsd } from '../format';
import { t } from '../strings';
import { getPersisted, persist, post } from '../vscode';
import { dispatch, useAppState } from '../store';
import { AttachmentChip } from './Turns';
import { Icon, IconButton, listKeyHandler, useScrollIntoView } from './common';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

type Popover =
  | { kind: 'files'; query: string; start: number; end: number; items: string[]; index: number; requestId: number }
  | { kind: 'commands'; query: string; items: SlashCommandInfo[]; index: number }
  | { kind: 'mode'; index: number };

const modes: { id: PermissionMode; icon: string; label: 'input.mode.ask' | 'input.mode.autoEdit' | 'input.mode.plan'; desc: 'input.mode.ask.desc' | 'input.mode.autoEdit.desc' | 'input.mode.plan.desc' }[] = [
  { id: 'ask', icon: 'shield', label: 'input.mode.ask', desc: 'input.mode.ask.desc' },
  { id: 'autoEdit', icon: 'zap', label: 'input.mode.autoEdit', desc: 'input.mode.autoEdit.desc' },
  { id: 'plan', icon: 'map', label: 'input.mode.plan', desc: 'input.mode.plan.desc' },
];

function PopoverRow({ active, onPick, onHover, children, id }: { active: boolean; onPick: () => void; onHover: () => void; children: JSX.Element | JSX.Element[]; id: string }): JSX.Element {
  const ref = useScrollIntoView<HTMLDivElement>(active);
  return (
    <div ref={ref} id={id} role="option" aria-selected={active} class={`popover-row${active ? ' is-active' : ''}`} onMouseEnter={onHover} onMouseDown={(event) => event.preventDefault()} onClick={onPick}>
      {children}
    </div>
  );
}

function ContextRing({ fraction }: { fraction: number }): JSX.Element {
  const r = 6;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, fraction));
  return (
    <svg class={`ring${pct > 0.85 ? ' is-high' : pct > 0.6 ? ' is-mid' : ''}`} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r={r} class="ring-track" />
      <circle cx="8" cy="8" r={r} class="ring-fill" stroke-dasharray={`${c * pct} ${c}`} transform="rotate(-90 8 8)" />
    </svg>
  );
}

function readImage(file: File): Promise<Attachment | 'too-large' | 'unsupported'> {
  if (!IMAGE_TYPES.includes(file.type)) {
    return Promise.resolve('unsupported');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Promise.resolve('too-large');
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ kind: 'image', dataUri: String(reader.result), label: file.name || 'image' });
    reader.onerror = () => resolve('unsupported');
    reader.readAsDataURL(file);
  });
}

export function InputBar({ starter }: { starter?: { text: string; seq: number } }): JSX.Element {
  const state = useAppState();
  const { session, slashCommands, showCost, fileResults, prefill, attachQueue, focusSeq } = state;
  const running = session.running;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [text, setTextState] = useState(() => getPersisted().draft ?? '');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [popover, setPopover] = useState<Popover | null>(null);
  const composing = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestSeq = useRef(0);

  const setText = (value: string) => {
    setTextState(value);
    persist({ draft: value });
  };

  const resize = () => {
    const el = textarea.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
    }
  };
  useEffect(resize, [text]);

  const focus = () => textarea.current?.focus();
  useEffect(() => {
    if (focusSeq) {
      focus();
    }
  }, [focusSeq]);

  const send = (value: string, extra: Attachment[]) => {
    const body = value.trim();
    if (!body && !extra.length) {
      return;
    }
    post({ type: 'send', text: body, attachments: extra });
    setText('');
    setAttachments([]);
    setPopover(null);
    requestAnimationFrame(resize);
  };

  // Host-driven input changes.
  useEffect(() => {
    if (!prefill) {
      return;
    }
    const extra = [...attachments, ...(prefill.attachments ?? [])];
    if (prefill.send) {
      send(prefill.text, extra);
    } else {
      setText(prefill.text);
      setAttachments(extra);
      focus();
    }
  }, [prefill?.seq]);

  useEffect(() => {
    if (starter?.text) {
      send(starter.text, attachments);
    }
  }, [starter?.seq]);

  useEffect(() => {
    if (attachQueue.length) {
      setAttachments((current) => [...current, ...attachQueue]);
      dispatch({ type: 'ui.attach.consumed' });
      focus();
    }
  }, [attachQueue]);

  // File search results.
  useEffect(() => {
    if (fileResults && popover?.kind === 'files' && fileResults.requestId === popover.requestId) {
      setPopover({ ...popover, items: fileResults.paths.slice(0, 30), index: 0 });
    }
  }, [fileResults]);

  const searchFiles = (query: string, start: number, end: number) => {
    const requestId = ++requestSeq.current;
    setPopover((current) => ({
      kind: 'files', query, start, end, requestId,
      items: current?.kind === 'files' ? current.items : [],
      index: 0,
    }));
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
    }
    searchTimer.current = setTimeout(() => post({ type: 'files.search', query, requestId }), 120);
  };

  const detectTrigger = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const at = /(?:^|\s)@([^\s@]*)$/.exec(before);
    if (at) {
      const start = caret - at[1].length - 1;
      searchFiles(at[1], start, caret);
      return;
    }
    const slash = /^\/(\S*)$/.exec(value);
    if (slash && caret === value.length) {
      const query = slash[1].toLowerCase();
      const items = slashCommands.filter((command) => command.name.toLowerCase().startsWith(query));
      setPopover({ kind: 'commands', query, items, index: 0 });
      return;
    }
    if (popover && popover.kind !== 'mode') {
      setPopover(null);
    }
  };

  const onInput = (event: Event) => {
    const el = event.currentTarget as HTMLTextAreaElement;
    setText(el.value);
    detectTrigger(el.value, el.selectionStart ?? el.value.length);
  };

  const pickFile = (path: string) => {
    if (popover?.kind !== 'files') {
      return;
    }
    const next = `${text.slice(0, popover.start)}${text.slice(popover.end)}`.replace(/\s{2,}/g, ' ');
    setText(next);
    if (!attachments.some((attachment) => attachment.kind === 'file' && attachment.path === path)) {
      setAttachments([...attachments, { kind: 'file', path, label: basename(path) }]);
    }
    setPopover(null);
    focus();
  };

  const pickCommand = (command: SlashCommandInfo) => {
    setText(`/${command.name} `);
    setPopover(null);
    focus();
  };

  const pickMode = (mode: PermissionMode) => {
    if (mode !== session.mode) {
      post({ type: 'mode.set', mode });
    }
    setPopover(null);
    focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (composing.current || event.isComposing || event.keyCode === 229) {
      return;
    }
    if (popover) {
      if (popover.kind === 'files') {
        if (popover.items.length || event.key === 'Escape') {
          listKeyHandler(popover.items.length, popover.index, (index) => setPopover({ ...popover, index }), (index) => pickFile(popover.items[index]), () => setPopover(null))(event);
          if (event.defaultPrevented) {
            return;
          }
        }
      } else if (popover.kind === 'commands') {
        if (popover.items.length || event.key === 'Escape') {
          listKeyHandler(popover.items.length, popover.index, (index) => setPopover({ ...popover, index }), (index) => pickCommand(popover.items[index]), () => setPopover(null))(event);
          if (event.defaultPrevented) {
            return;
          }
        }
      } else if (popover.kind === 'mode') {
        listKeyHandler(modes.length, popover.index, (index) => setPopover({ ...popover, index }), (index) => pickMode(modes[index].id), () => setPopover(null))(event);
        if (event.defaultPrevented) {
          return;
        }
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(text, attachments);
    } else if (event.key === 'Escape' && running) {
      post({ type: 'stop' });
    }
  };

  const addImages = async (files: FileList | File[]) => {
    const added: Attachment[] = [];
    for (const file of Array.from(files)) {
      const result = await readImage(file);
      if (result === 'too-large') {
        dispatch({ type: 'ui.toast', level: 'warning', text: t('input.imageTooLarge') });
      } else if (result === 'unsupported') {
        dispatch({ type: 'ui.toast', level: 'warning', text: t('input.imageUnsupported') });
      } else {
        added.push(result);
      }
    }
    if (added.length) {
      setAttachments((current) => [...current, ...added]);
    }
  };

  const onPaste = (event: ClipboardEvent) => {
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      void addImages(files);
    }
  };

  const onDrop = (event: DragEvent) => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) {
      event.preventDefault();
      void addImages(files.filter((file) => file.type.startsWith('image/')));
    }
  };

  const currentMode = modes.find((mode) => mode.id === session.mode) ?? modes[0];
  const canSend = text.trim().length > 0 || attachments.length > 0;
  const activeId = popover && popover.kind !== 'mode' ? `popover-item-${popover.index}` : undefined;

  return (
    <div class="input-bar" onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
      {popover?.kind === 'files' ? (
        <div class="popover" role="listbox" id="input-popover" aria-label={t('input.attachFile')}>
          {popover.items.length === 0 ? <div class="popover-empty">{t('input.files.empty')}</div> : null}
          {popover.items.map((path, i) => (
            <PopoverRow key={path} id={`popover-item-${i}`} active={i === popover.index} onPick={() => pickFile(path)} onHover={() => setPopover({ ...popover, index: i })}>
              <Icon name="file" />
              <span class="popover-main mono" dir="ltr">{basename(path)}</span>
              <span class="popover-sub mono" dir="ltr">{path}</span>
            </PopoverRow>
          ))}
        </div>
      ) : null}
      {popover?.kind === 'commands' ? (
        <div class="popover" role="listbox" id="input-popover">
          {popover.items.length === 0 ? <div class="popover-empty">{t('input.commands.empty')}</div> : null}
          {popover.items.map((command, i) => (
            <PopoverRow key={command.name} id={`popover-item-${i}`} active={i === popover.index} onPick={() => pickCommand(command)} onHover={() => setPopover({ ...popover, index: i })}>
              <span class="popover-main mono">/{command.name}</span>
              <span class="popover-sub" dir="auto">{command.description}</span>
            </PopoverRow>
          ))}
        </div>
      ) : null}
      {popover?.kind === 'mode' ? (
        <div class="popover popover-mode" role="listbox" aria-label={t('input.mode')}>
          {modes.map((mode, i) => (
            <PopoverRow key={mode.id} id={`mode-item-${i}`} active={i === popover.index} onPick={() => pickMode(mode.id)} onHover={() => setPopover({ kind: 'mode', index: i })}>
              <Icon name={mode.id === session.mode ? 'check' : mode.icon} />
              <span class="popover-main">{t(mode.label)}</span>
              <span class="popover-sub">{t(mode.desc)}</span>
            </PopoverRow>
          ))}
        </div>
      ) : null}

      {attachments.length ? (
        <div class="chips input-chips">
          {attachments.map((attachment, i) => (
            <AttachmentChip key={i} attachment={attachment} onRemove={() => setAttachments(attachments.filter((_, j) => j !== i))} />
          ))}
        </div>
      ) : null}

      <div class="input-box">
        <textarea
          ref={textarea}
          class="input-text"
          dir="auto"
          rows={1}
          value={text}
          placeholder={running ? t('input.placeholderRunning') : t('input.placeholder')}
          aria-label={t('input.placeholder')}
          aria-controls={popover && popover.kind !== 'mode' ? 'input-popover' : undefined}
          aria-activedescendant={activeId}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onClick={(event) => detectTrigger(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
        />
      </div>

      <div class="input-foot">
        <IconButton icon="file-add" label={t('input.attachFile')} onClick={() => post({ type: 'attach.activeFile' })} />
        <IconButton icon="selection" label={t('input.attachSelection')} onClick={() => post({ type: 'attach.selection' })} />
        <button
          type="button"
          class="mode-btn"
          title={`${t('input.mode')}: ${t(currentMode.label)} – ${t(currentMode.desc)}`}
          aria-label={`${t('input.mode')}: ${t(currentMode.label)}`}
          aria-expanded={popover?.kind === 'mode'}
          onClick={() => setPopover(popover?.kind === 'mode' ? null : { kind: 'mode', index: modes.indexOf(currentMode) })}
          onKeyDown={(event) => {
            if (popover?.kind === 'mode') {
              listKeyHandler(modes.length, popover.index, (index) => setPopover({ kind: 'mode', index }), (index) => pickMode(modes[index].id), () => setPopover(null))(event);
            }
          }}
        >
          <Icon name={currentMode.icon} />
          <span>{t(currentMode.label)}</span>
          <Icon name="chevron-up" class="header-chevron" />
        </button>
        <span class="input-foot-spacer" />
        <span class="input-meta" title={t('input.context', { pct: formatPercent(session.contextUsed) })}>
          <ContextRing fraction={session.contextUsed} />
          <span class="input-meta-text">{formatPercent(session.contextUsed)}</span>
        </span>
        {showCost && session.costUsd > 0 ? (
          <span class="input-meta" title={t('input.sessionCost', { cost: formatUsd(session.costUsd) })}>≈ {formatUsd(session.costUsd)}</span>
        ) : null}
        {running ? (
          <>
            {canSend ? <IconButton icon="send" label={t('input.send')} onClick={() => send(text, attachments)} /> : null}
            <button type="button" class="send-btn is-stop" title={t('input.stop')} aria-label={t('input.stop')} onClick={() => post({ type: 'stop' })}>
              <Icon name="debug-stop" />
            </button>
          </>
        ) : (
          <button type="button" class="send-btn" title={t('input.send')} aria-label={t('input.send')} disabled={!canSend} onClick={() => send(text, attachments)}>
            <Icon name="send" />
          </button>
        )}
      </div>
    </div>
  );
}
