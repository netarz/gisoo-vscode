import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AssistantTurnView } from '../../src/shared/protocol';
import { formatTokens } from '../format';
import { t, type StringKey } from '../strings';
import { GisooLoader } from './GisooMark';

const VERBS = 10;
const VERB_EVERY_MS = 3500;
/** No new text, thinking or tool step for this long: say the model is slow, not stuck. */
const SLOW_AFTER_MS = 25_000;

/** Rough output size while streaming (the real usage arrives with turn.end). */
function streamedChars(turn: AssistantTurnView): number {
  let n = 0;
  for (const part of turn.parts) {
    if (part.kind === 'text' || part.kind === 'thinking') n += part.text.length;
    else if (part.kind === 'tool') n += part.call.input.length;
  }
  return n;
}

/**
 * The live line under a running turn: the animated Gisoo mark, a changing verb (or the tool that
 * runs), the seconds since the turn started, the tokens streamed so far and how to stop.
 */
export function WorkingLine({ turn }: { turn: AssistantTurnView }): JSX.Element | null {
  const [now, setNow] = useState(() => Date.now());
  const chars = streamedChars(turn);
  const signature = `${turn.parts.length}:${chars}`;
  const lastChange = useRef({ signature, at: Date.now() });
  if (lastChange.current.signature !== signature) lastChange.current = { signature, at: Date.now() };

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const last = turn.parts[turn.parts.length - 1];
  const tool = last?.kind === 'tool' ? last.call : undefined;
  if (tool?.status === 'awaiting') {
    return (
      <div class="working is-waiting" role="status">
        <GisooLoader size={16} />
        <span class="working-verb">{t('working.approval')}</span>
      </div>
    );
  }

  const started = turn.createdAt || now;
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const slow = now - lastChange.current.at > SLOW_AFTER_MS;
  let verb: string;
  if (tool && (tool.status === 'running' || tool.status === 'pending')) verb = t('working.tool', { name: tool.name });
  else if (last?.kind === 'thinking') verb = t('working.verb.1');
  else verb = t(`working.verb.${(Math.floor((now - started) / VERB_EVERY_MS) % VERBS) + 1}` as StringKey);
  const tokens = Math.round(chars / 4);

  return (
    <div class="working" role="status" aria-live="off">
      <GisooLoader size={16} />
      <span class="working-verb">{verb}…</span>
      <span class="working-meta">
        {'('}
        {t('working.elapsed', { s: elapsed })}
        {tokens > 0 ? <> · {t('working.tokens', { n: formatTokens(tokens) })}</> : null}
        {' · '}
        <span class="working-key">{t('working.stop')}</span>
        {')'}
      </span>
      {slow ? <span class="working-slow">{t('working.slow')}</span> : null}
    </div>
  );
}
