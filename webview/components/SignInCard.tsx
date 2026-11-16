import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Links } from '../../src/shared/protocol';
import { t } from '../strings';
import { post } from '../vscode';
import { useAppState } from '../store';
import { Button, Icon } from './common';
import { GisooMark } from './GisooMark';

export function SignInCard(): JSX.Element {
  const { account } = useAppState();
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const waiting = Boolean(account.signInWaiting);
  const showCode = waiting || codeOpen;

  // A new answer from the host (error or success) ends the "sending" state.
  useEffect(() => setSending(false), [account.signInError, account.signedIn, account.signInWaiting]);
  useEffect(() => {
    if (showCode) input.current?.focus();
  }, [showCode]);

  const submit = (event?: Event): void => {
    event?.preventDefault();
    const value = code.trim();
    if (!value || sending) return;
    setSending(true);
    post({ type: 'auth.submitCode', code: value });
  };
  const onPaste = (event: ClipboardEvent): void => {
    const pasted = event.clipboardData?.getData('text') ?? '';
    if (!pasted.trim()) return;
    event.preventDefault();
    setCode(pasted.trim());
    setSending(true);
    post({ type: 'auth.submitCode', code: pasted.trim() });
  };

  return (
    <div class="signin">
      <div class="signin-card">
        <GisooMark size={40} class="signin-logo" />
        <h2 class="signin-title">{t('signin.title')}</h2>
        <p class="signin-value">{t(showCode ? (waiting ? 'signin.step.code' : 'signin.codeHint') : 'signin.value')}</p>
        {account.error && !account.signInError ? (
          <div class="notice notice-warning" dir="auto"><Icon name="warning" /><span>{t('account.error', { error: account.error })}</span></div>
        ) : null}

        {showCode ? (
          <form class="signin-code" onSubmit={submit}>
            <div class="code-row">
              <input
                ref={input}
                class={`code-input${account.signInError ? ' has-error' : ''}`}
                type="text"
                dir="ltr"
                autoComplete="one-time-code"
                spellcheck={false}
                placeholder="ABCD-EFGH-IJKL"
                aria-label={t('signin.code')}
                value={code}
                onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)}
                onPaste={onPaste}
                disabled={sending}
              />
              <button type="submit" class="btn btn-primary" disabled={!code.trim() || sending}>
                {sending ? <Icon name="loading" spin /> : null}
                <span>{t('signin.codeSubmit')}</span>
              </button>
            </div>
            {account.signInError ? (
              <p class="signin-error" role="alert" dir="auto">{account.signInError}</p>
            ) : null}
            <div class="signin-links">
              {waiting ? (
                <>
                  <a href="#" onClick={(event) => { event.preventDefault(); post({ type: 'auth.copyLink' }); }}>{t('signin.copyLink')}</a>
                  <span aria-hidden="true">·</span>
                  <a href="#" onClick={(event) => { event.preventDefault(); post({ type: 'auth.openLink' }); }}>{t('signin.openPage')}</a>
                </>
              ) : (
                <a href="#" onClick={(event) => { event.preventDefault(); setCode(''); post({ type: 'auth.signIn' }); }}>{t('signin.openPage')}</a>
              )}
              <span aria-hidden="true">·</span>
              <a href="#" onClick={(event) => { event.preventDefault(); setCode(''); setCodeOpen(false); if (waiting) post({ type: 'auth.cancel' }); }}>{t('signin.cancel')}</a>
            </div>
          </form>
        ) : (
          <>
            <div class="signin-actions">
              <Button kind="primary" icon="sign-in" onClick={() => post({ type: 'auth.signIn' })}>{t('signin.gisoo')}</Button>
              <Button icon="key" onClick={() => post({ type: 'auth.apiKey' })}>{t('signin.apiKey')}</Button>
              <Button kind="ghost" icon="symbol-key" onClick={() => setCodeOpen(true)}>{t('signin.code')}</Button>
            </div>
            <a class="signin-docs" href={Links.docs} onClick={(event) => { event.preventDefault(); post({ type: 'link.open', url: Links.docs }); }}>
              {t('signin.docs')}
            </a>
          </>
        )}
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
      <div class="empty-mark"><GisooMark size={22} /></div>
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
