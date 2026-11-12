import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useAppState } from '../store';
import { AgentStrip } from './Agents';
import { Header } from './Header';
import { MessageList } from './MessageList';
import { InputBar } from './InputBar';
import { QueueChips, TodoCard } from './Pinned';
import { EmptyState, SignInCard } from './SignInCard';
import { Toasts } from './common';

export function App(): JSX.Element {
  const state = useAppState();
  const { ready, account, session, showCost, language } = state;
  const [starter, setStarter] = useState<{ text: string; seq: number } | undefined>(undefined);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
  }, [language]);

  if (!ready) {
    return <div class="app app-loading" aria-busy="true" />;
  }

  if (!account.signedIn) {
    return (
      <div class="app">
        <SignInCard />
        <Toasts />
      </div>
    );
  }

  const empty = session.turns.length === 0 && !session.running;

  return (
    <div class="app">
      <Header />
      {empty ? (
        <EmptyState onStarter={(text) => setStarter({ text, seq: (starter?.seq ?? 0) + 1 })} />
      ) : (
        <MessageList session={session} showCost={showCost} />
      )}
      <div class="pinned">
        <TodoCard todos={session.todos} showStart={!session.running} />
        <AgentStrip />
        <QueueChips queue={session.queue} />
      </div>
      <InputBar starter={starter} />
      <Toasts />
    </div>
  );
}
