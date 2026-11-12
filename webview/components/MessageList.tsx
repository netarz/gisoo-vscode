import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { SessionView } from '../../src/shared/protocol';
import { t } from '../strings';
import { getPersisted, persist } from '../vscode';
import { Icon } from './common';
import { AssistantTurn, SummaryTurn, UserTurn } from './Turns';

const BOTTOM_THRESHOLD = 48;

export function MessageList({ session, showCost }: { session: SessionView; showCost: boolean }): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const restored = useRef(false);

  const scrollToBottom = () => {
    const el = scroller.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
      setShowJump(false);
    }
  };

  // Keep pinned to the bottom while content grows, unless the user scrolled up.
  useLayoutEffect(() => {
    if (atBottom.current) {
      scrollToBottom();
    }
  });

  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) {
      return;
    }
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nowAtBottom = distance <= BOTTOM_THRESHOLD;
      if (nowAtBottom !== atBottom.current) {
        atBottom.current = nowAtBottom;
        setShowJump(!nowAtBottom);
      }
      persist({ scrollTop: nowAtBottom ? undefined : el.scrollTop, sessionId: session.id });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(() => {
      if (atBottom.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(inner);
    if (!restored.current) {
      restored.current = true;
      const saved = getPersisted();
      if (saved.sessionId === session.id && saved.scrollTop !== undefined) {
        el.scrollTop = saved.scrollTop;
        onScroll();
      }
    }
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [session.id]);

  // A new session always starts at the bottom.
  useEffect(() => {
    atBottom.current = true;
    setShowJump(false);
  }, [session.id]);

  const turns = session.turns;
  let lastAssistant = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'assistant') {
      lastAssistant = i;
      break;
    }
  }

  return (
    <div class="messages" ref={scroller}>
      <div class="messages-inner" ref={content}>
        {turns.map((turn, i) => {
          switch (turn.role) {
            case 'user':
              return <UserTurn key={turn.id} turn={turn} />;
            case 'summary':
              return <SummaryTurn key={turn.id} turn={turn} />;
            case 'assistant': {
              const isLast = i === lastAssistant;
              return <AssistantTurn key={turn.id} turn={turn} isLast={isLast} running={isLast ? session.running : false} showCost={showCost} />;
            }
            default:
              return null;
          }
        })}
      </div>
      {showJump ? (
        <button type="button" class="jump-bottom" onClick={scrollToBottom} title={t('scroll.bottom')} aria-label={t('scroll.bottom')}>
          <Icon name="arrow-down" />
        </button>
      ) : null}
    </div>
  );
}
