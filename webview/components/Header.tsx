import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../strings';
import { post } from '../vscode';
import { useAppState } from '../store';
import { Icon, IconButton } from './common';
import { SessionsOverlay } from './SessionsOverlay';
import { ModelPicker } from './ModelPicker';
import { AccountPanel } from './AccountPanel';
import { AgentsOverlay, isActiveAgent } from './Agents';

type Open = 'none' | 'sessions' | 'models' | 'account' | 'agents';

export function Header(): JSX.Element {
  const { session, account, models, agents, agentsShowSeq } = useAppState();
  const [open, setOpen] = useState<Open>('none');
  const current = models.find((model) => model.id === session.model);
  const modelLabel = current?.name ?? session.model ?? '';
  const title = session.title || t('header.title.untitled');
  const close = () => setOpen('none');
  const runningAgents = agents.filter(isActiveAgent).length;
  const agentsLabel = runningAgents ? `${t('agents.open')} (${t('agents.running', { n: runningAgents })})` : t('agents.open');

  useEffect(() => {
    if (agentsShowSeq > 0) {
      setOpen('agents');
    }
  }, [agentsShowSeq]);

  return (
    <header class="header">
      <button
        type="button"
        class="header-title"
        title={t('header.history')}
        aria-label={`${title} – ${t('header.history')}`}
        aria-expanded={open === 'sessions'}
        onClick={() => {
          if (open === 'sessions') {
            close();
          } else {
            post({ type: 'session.list' });
            setOpen('sessions');
          }
        }}
      >
        <Icon name="history" />
        <span class="header-title-text" dir="auto">{title}</span>
        <Icon name="chevron-down" class="header-chevron" />
      </button>

      {account.signedIn ? (
        <button
          type="button"
          class="header-model"
          title={`${t('header.model')}: ${modelLabel}`}
          aria-label={`${t('header.model')}: ${modelLabel}`}
          aria-expanded={open === 'models'}
          onClick={() => setOpen(open === 'models' ? 'none' : 'models')}
        >
          <span class="header-model-text">{modelLabel}</span>
          <Icon name="chevron-down" class="header-chevron" />
        </button>
      ) : null}

      <IconButton icon="add" label={t('header.newChat')} onClick={() => post({ type: 'session.new' })} />

      {account.signedIn ? (
        <button
          type="button"
          class={`icon-btn header-agents${open === 'agents' ? ' is-active' : ''}`}
          title={agentsLabel}
          aria-label={agentsLabel}
          aria-pressed={open === 'agents'}
          aria-expanded={open === 'agents'}
          onClick={() => setOpen(open === 'agents' ? 'none' : 'agents')}
        >
          <Icon name="server-process" />
          {runningAgents ? <span class="header-badge">{runningAgents}</span> : null}
        </button>
      ) : null}

      {account.signedIn ? (
        <button
          type="button"
          class={`balance-pill${account.error ? ' has-error' : ''}`}
          title={account.error ? t('account.error', { error: account.error }) : t('header.balance')}
          aria-label={`${t('header.balance')}: ${account.balanceDisplay ?? '–'}`}
          aria-expanded={open === 'account'}
          onClick={() => setOpen(open === 'account' ? 'none' : 'account')}
        >
          <Icon name={account.error ? 'warning' : 'account'} />
          <span>{account.balanceDisplay ?? '–'}</span>
        </button>
      ) : (
        <button type="button" class="balance-pill" onClick={() => post({ type: 'auth.signIn' })} title={t('header.signIn')}>
          <Icon name="sign-in" />
          <span>{t('header.signIn')}</span>
        </button>
      )}

      {open === 'sessions' ? <SessionsOverlay onClose={close} /> : null}
      {open === 'models' ? <ModelPicker onClose={close} /> : null}
      {open === 'account' ? <AccountPanel onClose={close} /> : null}
      {open === 'agents' ? <AgentsOverlay onClose={close} /> : null}
    </header>
  );
}
