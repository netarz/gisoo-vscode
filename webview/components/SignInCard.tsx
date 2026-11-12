import type { JSX } from 'preact';
import { Links } from '../../src/shared/protocol';
import { t } from '../strings';
import { post } from '../vscode';
import { useAppState } from '../store';
import { Button, Icon } from './common';

export function SignInCard(): JSX.Element {
  const { account } = useAppState();
  return (
    <div class="signin">
      <div class="signin-card">
        <div class="signin-mark"><Icon name="sparkle" /></div>
        <h2 class="signin-title">{t('signin.title')}</h2>
        <p class="signin-value">{t('signin.value')}</p>
        {account.error ? (
          <div class="notice notice-warning" dir="auto"><Icon name="warning" /><span>{t('account.error', { error: account.error })}</span></div>
        ) : null}
        <div class="signin-actions">
          <Button kind="primary" icon="sign-in" onClick={() => post({ type: 'auth.signIn' })}>{t('signin.gisoo')}</Button>
          <Button icon="key" onClick={() => post({ type: 'auth.apiKey' })}>{t('signin.apiKey')}</Button>
          <Button kind="ghost" icon="symbol-key" onClick={() => post({ type: 'auth.enterCode' })}>{t('signin.code')}</Button>
        </div>
        <a class="signin-docs" href={Links.docs} onClick={(event) => { event.preventDefault(); post({ type: 'link.open', url: Links.docs }); }}>
          {t('signin.docs')}
        </a>
      </div>
    </div>
  );
}

const starters = [
  { icon: 'book', label: 'empty.starter.explain', prompt: 'empty.starter.explain.prompt' },
  { icon: 'bug', label: 'empty.starter.bug', prompt: 'empty.starter.bug.prompt' },
  { icon: 'beaker', label: 'empty.starter.tests', prompt: 'empty.starter.tests.prompt' },
  { icon: 'git-pull-request', label: 'empty.starter.review', prompt: 'empty.starter.review.prompt' },
] as const;

export function EmptyState({ onStarter }: { onStarter: (text: string) => void }): JSX.Element {
  return (
    <div class="empty">
      <div class="empty-mark"><Icon name="sparkle" /></div>
      <h2 class="empty-title">{t('empty.title')}</h2>
      <p class="empty-hint">{t('empty.hint')}</p>
      <div class="starters">
        {starters.map((starter) => (
          <button type="button" class="starter" key={starter.label} onClick={() => onStarter(t(starter.prompt))}>
            <Icon name={starter.icon} />
            <span>{t(starter.label)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
