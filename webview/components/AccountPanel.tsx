import type { JSX } from 'preact';
import { Links } from '../../src/shared/protocol';
import { formatUsd } from '../format';
import { t } from '../strings';
import { post } from '../vscode';
import { useAppState } from '../store';
import { Button, Icon, IconButton, Overlay } from './common';

export function AccountPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { account, version } = useAppState();
  const limit = account.spendLimitUsd === null || account.spendLimitUsd === undefined ? t('account.noLimit') : formatUsd(account.spendLimitUsd);
  const open = (url: string) => post({ type: 'link.open', url });

  return (
    <Overlay title={t('account.title')} onClose={onClose} class="account-panel">
      {account.error ? (
        <div class="notice notice-warning" dir="auto">
          <Icon name="warning" />
          <span>{t('account.error', { error: account.error })}</span>
        </div>
      ) : null}
      <div class="account-balance">
        <span class="account-balance-label">{t('account.balance')}</span>
        <span class="account-balance-value">{account.balanceDisplay ?? '–'}</span>
        <IconButton icon="refresh" label={t('account.refresh')} onClick={() => post({ type: 'account.refresh' })} />
      </div>
      <dl class="account-facts">
        <dt>{t('account.project')}</dt>
        <dd dir="auto">{account.projectName ?? '–'}</dd>
        <dt>{t('account.key')}</dt>
        <dd dir="auto">
          {account.keyName ?? '–'}
          {account.keyPrefix ? <code class="mono">{account.keyPrefix}…</code> : null}
        </dd>
        <dt>{t('account.spent')}</dt>
        <dd>{formatUsd(account.spentUsd ?? 0)} / {limit}</dd>
        <dt>{account.region === 'iran' ? t('account.region.iran') : t('account.region.global')}</dt>
        <dd><code class="mono">{account.baseUrl}</code></dd>
      </dl>
      <div class="account-actions">
        <Button kind="primary" icon="credit-card" onClick={() => open(Links.addCredit)}>{t('account.addCredit')}</Button>
        <Button icon="key" onClick={() => open(Links.keys)}>{t('account.manageKeys')}</Button>
        <Button icon="sign-out" title={t('account.signOutNote')} onClick={() => { post({ type: 'auth.signOut' }); onClose(); }}>{t('account.signOut')}</Button>
      </div>
      <div class="account-foot">
        <span>{t('account.version', { version })}</span>
        <a href={Links.docs} onClick={(event) => { event.preventDefault(); open(Links.docs); }}>{t('signin.docs')}</a>
      </div>
    </Overlay>
  );
}
