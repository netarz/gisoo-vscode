import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ToolCallView, ToolStatus } from '../../src/shared/protocol';
import { basename, commandWord } from '../format';
import { t } from '../strings';
import { post } from '../vscode';
import { Button, Icon, IconButton } from './common';
import { DiffView } from './Diff';

const toolIcons: Record<string, string> = {
  read_file: 'file',
  list_directory: 'list-tree',
  find_files: 'search',
  search_text: 'search',
  get_diagnostics: 'warning',
  write_file: 'new-file',
  edit_file: 'edit',
  run_command: 'terminal',
  todo_write: 'checklist',
  ask_user: 'question',
  web_fetch: 'globe',
};

function statusIcon(status: ToolStatus): JSX.Element {
  switch (status) {
    case 'running':
      return <Icon name="loading" spin class="status status-running" />;
    case 'awaiting':
      return <Icon name="bell-dot" class="status status-awaiting" />;
    case 'done':
      return <Icon name="check" class="status status-done" />;
    case 'error':
      return <Icon name="error" class="status status-error" />;
    case 'rejected':
      return <Icon name="circle-slash" class="status status-rejected" />;
    case 'cancelled':
      return <Icon name="debug-stop" class="status status-cancelled" />;
    default:
      return <Icon name="circle-outline" class="status status-pending" />;
  }
}

function RejectBox({ callId, onDone }: { callId: string; onDone: () => void }): JSX.Element {
  const [note, setNote] = useState('');
  const send = () => {
    post({ type: 'approval', callId, decision: 'reject', note: note.trim() || undefined });
    onDone();
  };
  return (
    <div class="reject-box">
      <input
        type="text"
        class="text-input"
        placeholder={t('tool.rejectNote')}
        aria-label={t('tool.rejectNote')}
        value={note}
        dir="auto"
        onInput={(event) => setNote(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            send();
          } else if (event.key === 'Escape') {
            onDone();
          }
        }}
      />
      <Button kind="danger" onClick={send}>{t('tool.rejectSend')}</Button>
      <Button kind="ghost" onClick={onDone}>{t('turn.cancel')}</Button>
    </div>
  );
}

function ApprovalButtons({ call }: { call: ToolCallView }): JSX.Element {
  const [rejecting, setRejecting] = useState(false);
  if (rejecting) {
    return <RejectBox callId={call.id} onDone={() => setRejecting(false)} />;
  }
  const accept = () => post({ type: 'approval', callId: call.id, decision: 'accept' });
  if (call.command) {
    const word = commandWord(call.command.command);
    return (
      <div class="tool-actions">
        <Button kind="primary" icon="play" onClick={accept}>{t('tool.run')}</Button>
        <Button icon="check-all" onClick={() => post({ type: 'approval', callId: call.id, decision: 'always' })}>{t('tool.alwaysAllow', { word })}</Button>
        <Button kind="danger" icon="close" onClick={() => setRejecting(true)}>{t('tool.reject')}</Button>
      </div>
    );
  }
  return (
    <div class="tool-actions">
      <Button kind="primary" icon="check" onClick={accept}>{t('tool.accept')}</Button>
      <Button kind="danger" icon="close" onClick={() => setRejecting(true)}>{t('tool.reject')}</Button>
      {call.edit ? <Button kind="ghost" icon="diff" onClick={() => post({ type: 'diff.open', callId: call.id })}>{t('tool.openDiff')}</Button> : null}
    </div>
  );
}

function AskUser({ call }: { call: ToolCallView }): JSX.Element {
  const [text, setText] = useState('');
  const question = call.question;
  if (!question) {
    return <></>;
  }
  const answer = (value: string) => {
    if (value.trim()) {
      post({ type: 'answer', callId: call.id, answer: value.trim() });
    }
  };
  const open = !question.answer && (call.status === 'awaiting' || call.status === 'running' || call.status === 'pending');
  return (
    <div class="ask">
      <div class="ask-text" dir="auto">{question.text}</div>
      {question.answer ? <div class="ask-answer" dir="auto">{t('tool.answered', { answer: question.answer })}</div> : null}
      {open && question.options?.length ? (
        <div class="ask-options">
          {question.options.map((option) => (
            <Button key={option} onClick={() => answer(option)}>{option}</Button>
          ))}
        </div>
      ) : null}
      {open ? (
        <div class="ask-free">
          <input
            type="text"
            class="text-input"
            dir="auto"
            placeholder={t('tool.answerPlaceholder')}
            aria-label={t('tool.answerPlaceholder')}
            value={text}
            onInput={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.isComposing) {
                event.preventDefault();
                answer(text);
              }
            }}
          />
          <IconButton icon="send" label={t('tool.answerSend')} onClick={() => answer(text)} disabled={!text.trim()} />
        </div>
      ) : null}
    </div>
  );
}

export function ToolCard({ call }: { call: ToolCallView }): JSX.Element {
  const [open, setOpen] = useState<boolean | null>(null);
  const kind = call.edit ? 'edit' : call.command ? 'command' : call.question ? 'ask' : 'generic';
  const busy = call.status === 'awaiting' || call.status === 'running' || call.status === 'error';
  const isOpen = open ?? (kind === 'ask' || (kind !== 'generic' && busy));
  const icon = toolIcons[call.name] ?? 'tools';

  return (
    <div class={`tool tool-${kind} tool-status-${call.status}${isOpen ? ' is-open' : ''}`}>
      <div
        class="tool-head"
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        title={isOpen ? t('tool.collapse') : t('tool.expand')}
        onClick={() => setOpen(!isOpen)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(!isOpen);
          }
        }}
      >
        <Icon name={icon} class="tool-icon" />
        <span class="tool-title" dir="auto">{call.title}</span>
        {call.edit ? (
          <span class="tool-counts" aria-label={`${t('tool.added', { n: call.edit.added })}, ${t('tool.removed', { n: call.edit.removed })}`}>
            <span class="count-add">+{call.edit.added}</span>
            <span class="count-del">−{call.edit.removed}</span>
          </span>
        ) : null}
        {call.command && call.command.exitCode !== undefined && call.command.exitCode !== null ? (
          <span class={`tool-exit${call.command.exitCode === 0 ? '' : ' is-bad'}`}>{t('tool.exitCode', { code: call.command.exitCode })}</span>
        ) : null}
        <span class="tool-status-text">{t(`tool.status.${call.status}` as const)}</span>
        {statusIcon(call.status)}
        <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} class="tool-chevron" />
      </div>

      {isOpen ? (
        <div class="tool-body">
          {call.edit ? (
            <div class="tool-edit">
              <div class="tool-path-row">
                <button
                  type="button"
                  class="link-btn tool-path"
                  title={`${t('tool.openFile')}: ${call.edit.path}`}
                  onClick={() => post({ type: 'file.open', path: call.edit!.path })}
                >
                  <Icon name="go-to-file" />
                  <span class="mono">{call.edit.path}</span>
                </button>
                {call.edit.isNewFile ? <span class="badge">{t('tool.newFile')}</span> : null}
                {call.status !== 'awaiting' ? (
                  <IconButton icon="diff" label={t('tool.openDiff')} onClick={() => post({ type: 'diff.open', callId: call.id })} />
                ) : null}
              </div>
              {call.edit.diff ? <DiffView diff={call.edit.diff} /> : null}
            </div>
          ) : null}

          {call.command ? (
            <div class="tool-command">
              <pre class="cmd" dir="ltr"><code>{call.command.command}</code></pre>
              {call.command.cwd ? <div class="tool-cwd mono" dir="ltr">{t('tool.cwd', { cwd: call.command.cwd })}</div> : null}
              {call.output !== undefined && call.output !== '' ? (
                <pre class="tool-output" dir="ltr">{call.output}</pre>
              ) : call.status === 'done' ? (
                <div class="tool-output-empty">{t('tool.outputEmpty')}</div>
              ) : null}
            </div>
          ) : null}

          {call.question ? <AskUser call={call} /> : null}

          {kind === 'generic' ? (
            <div class="tool-generic">
              {call.input ? (
                <details open={call.status === 'error'}>
                  <summary>{t('tool.input')}</summary>
                  <pre class="tool-output" dir="ltr">{call.input}</pre>
                </details>
              ) : null}
              {call.output !== undefined ? (
                <details open={call.status === 'error' || call.name !== 'read_file'}>
                  <summary>{t('tool.output')}</summary>
                  <pre class="tool-output" dir="auto">{call.output || t('tool.outputEmpty')}</pre>
                </details>
              ) : null}
            </div>
          ) : null}

          {kind !== 'generic' && call.output && kind !== 'command' ? (
            <pre class="tool-output" dir="auto">{call.output}</pre>
          ) : null}

          {call.status === 'awaiting' && kind !== 'ask' ? <ApprovalButtons call={call} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export function toolFileLabel(call: ToolCallView): string {
  return call.edit ? basename(call.edit.path) : call.title;
}
