import type { JSX } from 'preact';
import { memo } from 'preact/compat';
import { useState } from 'preact/hooks';
import {
  Links,
  NoticeCodes,
  type AssistantPart,
  type AssistantTurnView,
  type Attachment,
  type SummaryTurnView,
  type UserTurnView,
} from '../../src/shared/protocol';
import { formatDuration, formatTokens, formatUsd } from '../format';
import { t } from '../strings';
import { post } from '../vscode';
import { Button, Icon, IconButton } from './common';
import { Markdown } from './Markdown';
import { ToolCard } from './ToolCard';

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove?: () => void }): JSX.Element {
  const icon = attachment.kind === 'image' ? 'file-media' : attachment.kind === 'selection' ? 'selection' : 'file';
  const title = attachment.path
    ? `${attachment.path}${attachment.startLine ? `:${attachment.startLine}-${attachment.endLine}` : ''}`
    : attachment.label;
  return (
    <span class={`chip chip-${attachment.kind}`} title={title}>
      {attachment.kind === 'image' && attachment.dataUri ? <img class="chip-thumb" src={attachment.dataUri} alt="" /> : <Icon name={icon} />}
      <span class="chip-label" dir="auto">{attachment.label}</span>
      {attachment.startLine ? <span class="chip-range">{attachment.startLine}–{attachment.endLine}</span> : null}
      {onRemove ? <IconButton icon="close" label={t('input.removeAttachment')} onClick={onRemove} class="chip-remove" /> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// User turn
// ---------------------------------------------------------------------------

export const UserTurn = memo(function UserTurn({ turn }: { turn: UserTurnView }): JSX.Element {
  return (
    <div class={`turn turn-user${turn.injected ? ' is-injected' : ''}`}>
      <div class="bubble bubble-user" dir="auto">
        {turn.injected ? <div class="bubble-tag"><Icon name="arrow-small-right" />{t('turn.injected')}</div> : null}
        {turn.attachments.length ? (
          <div class="chips">
            {turn.attachments.map((attachment, i) => <AttachmentChip key={i} attachment={attachment} />)}
          </div>
        ) : null}
        <div class="bubble-text">{turn.text}</div>
      </div>
    </div>
  );
});

export const SummaryTurn = memo(function SummaryTurn({ turn }: { turn: SummaryTurnView }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div class="turn turn-summary">
      <button type="button" class="summary-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="fold" />
        <span>{t('turn.summary')}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} />
      </button>
      {open ? <Markdown text={turn.text} class="summary-body" /> : null}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Assistant turn parts
// ---------------------------------------------------------------------------

function ThinkingBlock({ text, live }: { text: string; live: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const preview = text.replace(/\s+/g, ' ').trim().slice(-140);
  return (
    <div class={`thinking${open ? ' is-open' : ''}`}>
      <button type="button" class="thinking-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name={live ? 'loading' : 'lightbulb'} spin={live} />
        <span class="thinking-label">{live ? t('turn.thinkingLive') : t('turn.thinking')}</span>
        {!open && preview ? <span class="thinking-preview" dir="auto">{preview}</span> : null}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} />
      </button>
      {open ? <div class="thinking-body" dir="auto">{text}</div> : null}
    </div>
  );
}

function NoticeCard({ part, canRetry }: { part: Extract<AssistantPart, { kind: 'notice' }>; canRetry: boolean }): JSX.Element {
  const icon = part.level === 'error' ? 'error' : part.level === 'warning' ? 'warning' : 'info';
  const actions: JSX.Element[] = [];
  if (part.code === NoticeCodes.insufficientCredit) {
    actions.push(<Button key="credit" kind="primary" icon="credit-card" onClick={() => post({ type: 'link.open', url: Links.addCredit })}>{t('notice.addCredit')}</Button>);
  } else if (part.code === NoticeCodes.invalidKey) {
    actions.push(<Button key="signin" kind="primary" icon="sign-in" onClick={() => post({ type: 'auth.signIn' })}>{t('notice.signIn')}</Button>);
  } else if (part.code === NoticeCodes.maxSteps) {
    actions.push(<Button key="continue" kind="primary" icon="debug-continue" onClick={() => post({ type: 'send', text: t('notice.continueText'), attachments: [] })}>{t('notice.continue')}</Button>);
  }
  if (canRetry && part.level === 'error' && part.code !== NoticeCodes.maxSteps && part.code !== NoticeCodes.invalidKey) {
    actions.push(<Button key="retry" icon="refresh" onClick={() => post({ type: 'retry' })}>{t('notice.retry')}</Button>);
  }
  return (
    <div class={`notice notice-${part.level}`} role={part.level === 'error' ? 'alert' : undefined}>
      <Icon name={icon} />
      <div class="notice-body">
        <div class="notice-text" dir="auto">{part.text}</div>
        {actions.length ? <div class="notice-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

function RestoreButton({ turnId }: { turnId: string }): JSX.Element {
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <span class="restore-confirm">
        <span>{t('turn.restoreConfirm')}</span>
        <Button kind="danger" onClick={() => { post({ type: 'checkpoint.restore', turnId }); setConfirm(false); }}>{t('turn.restoreYes')}</Button>
        <Button kind="ghost" onClick={() => setConfirm(false)}>{t('turn.cancel')}</Button>
      </span>
    );
  }
  return <IconButton icon="discard" label={t('turn.restoreTitle')} onClick={() => setConfirm(true)}>{t('turn.restore')}</IconButton>;
}

function TurnFooter({ turn, showCost }: { turn: AssistantTurnView; showCost: boolean }): JSX.Element {
  const usage = turn.usage;
  const text = turn.parts.filter((part) => part.kind === 'text').map((part) => (part as { text: string }).text).join('\n\n');
  return (
    <div class="turn-foot">
      <span class="turn-model" title={t('header.model')}>{turn.model}</span>
      {usage ? (
        <span class="turn-tokens" title={t('turn.tokensTitle', { in: usage.promptTokens, cached: usage.cachedTokens, out: usage.completionTokens })}>
          <Icon name="arrow-up" />{formatTokens(usage.promptTokens)} <Icon name="arrow-down" />{formatTokens(usage.completionTokens)}
        </span>
      ) : null}
      {showCost && usage?.costUsd !== undefined ? (
        <span class="turn-cost" title={t('turn.costTitle')}>{t('turn.cost', { cost: formatUsd(usage.costUsd) })}</span>
      ) : null}
      {turn.durationMs !== undefined ? <span class="turn-duration">{formatDuration(turn.durationMs)}</span> : null}
      {turn.stopped ? <span class="turn-stopped"><Icon name="debug-stop" />{t('turn.stopped')}</span> : null}
      <span class="turn-foot-spacer" />
      {text ? <IconButton icon="copy" label={t('turn.copy')} onClick={() => post({ type: 'code.copy', code: text })} /> : null}
      {turn.hasCheckpoint ? <RestoreButton turnId={turn.id} /> : null}
    </div>
  );
}

export interface AssistantTurnProps {
  turn: AssistantTurnView;
  /** Only the last assistant turn may offer Retry. */
  isLast: boolean;
  running: boolean;
  showCost: boolean;
}

export const AssistantTurn = memo(function AssistantTurn({ turn, isLast, running, showCost }: AssistantTurnProps): JSX.Element {
  const parts = turn.parts;
  const lastIndex = parts.length - 1;
  return (
    <div class={`turn turn-assistant${turn.streaming ? ' is-streaming' : ''}`}>
      <div class="turn-body">
        {parts.map((part, i) => {
          const active = turn.streaming && i === lastIndex;
          switch (part.kind) {
            case 'text':
              return <Markdown key={i} text={part.text} streaming={active} />;
            case 'thinking':
              return <ThinkingBlock key={i} text={part.text} live={active} />;
            case 'tool':
              return <ToolCard key={part.call.id} call={part.call} />;
            case 'notice':
              return <NoticeCard key={i} part={part} canRetry={isLast && !running} />;
            default:
              return null;
          }
        })}
        {turn.streaming && (parts.length === 0 || parts[lastIndex].kind === 'tool') ? (
          <div class="working"><Icon name="loading" spin /><span>{t('turn.working')}</span></div>
        ) : null}
      </div>
      {!turn.streaming ? <TurnFooter turn={turn} showCost={showCost} /> : null}
    </div>
  );
});
