/** Token estimate and compaction boundaries (SPEC §5 step 7). Pure. */
import type { ChatMessage } from '../api/types';

export const CONTEXT_ESTIMATE_CAP = 200_000;
export const COMPACTION_THRESHOLD = 0.8;
export const KEEP_RECENT_TURNS = 6;
/** Rough cost of one image in tokens for the estimate. */
const IMAGE_TOKENS = 1_000;

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  // Persian and other non-Latin scripts tokenise worse than English; weight them a little heavier.
  let latin = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 0x300) latin++;
    else other++;
  }
  return Math.ceil(latin / 4 + other / 2.5);
}

export function estimateMessageTokens(message: ChatMessage): number {
  let tokens = 4; // role and framing
  if (typeof message.content === 'string') tokens += estimateTextTokens(message.content);
  else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text') tokens += estimateTextTokens(part.text);
      else tokens += IMAGE_TOKENS;
    }
  }
  for (const call of message.tool_calls ?? []) {
    tokens += estimateTextTokens(call.function.name) + estimateTextTokens(call.function.arguments) + 8;
  }
  return tokens;
}

export function estimateTokens(messages: readonly ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

export function effectiveContext(contextLength: number | undefined): number {
  const len = contextLength && contextLength > 0 ? contextLength : 128_000;
  return Math.min(CONTEXT_ESTIMATE_CAP, len);
}

export function contextShare(messages: readonly ChatMessage[], contextLength: number | undefined): number {
  return Math.min(1, estimateTokens(messages) / effectiveContext(contextLength));
}

export function needsCompaction(messages: readonly ChatMessage[], contextLength: number | undefined): boolean {
  return estimateTokens(messages) > COMPACTION_THRESHOLD * effectiveContext(contextLength);
}

/**
 * A "turn" starts at a user message (not a tool result) and runs until the next one.
 * Returns the index of the first message that belongs to the last `keepTurns` turns.
 * The system prompt (index 0, role system) is never part of a turn.
 */
export function compactionBoundary(messages: readonly ChatMessage[], keepTurns = KEEP_RECENT_TURNS): number {
  const starts: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'user') starts.push(i);
  }
  if (starts.length <= keepTurns) return messages[0]?.role === 'system' ? 1 : 0;
  return starts[starts.length - keepTurns];
}

export interface CompactionSplit {
  system: ChatMessage[];
  older: ChatMessage[];
  recent: ChatMessage[];
}

/** Splits into system prompt, the messages to summarise, and the verbatim tail. */
export function splitForCompaction(messages: readonly ChatMessage[], keepTurns = KEEP_RECENT_TURNS): CompactionSplit {
  const system = messages.length && messages[0].role === 'system' ? [messages[0]] : [];
  const boundary = compactionBoundary(messages, keepTurns);
  return { system, older: messages.slice(system.length, boundary), recent: messages.slice(boundary) };
}

/** Flattens messages into plain text for the summariser. Tool results are shortened. */
export function transcriptForSummary(messages: readonly ChatMessage[], maxChars = 60_000): string {
  const lines: string[] = [];
  for (const m of messages) {
    let text = '';
    if (typeof m.content === 'string') text = m.content;
    else if (Array.isArray(m.content)) text = m.content.map((p) => (p.type === 'text' ? p.text : '[image]')).join('\n');
    if (m.role === 'tool') text = text.length > 1_500 ? `${text.slice(0, 1_500)}\n[...]` : text;
    if (m.tool_calls?.length) {
      text += `\n${m.tool_calls.map((c) => `[call ${c.function.name} ${c.function.arguments.slice(0, 300)}]`).join('\n')}`;
    }
    lines.push(`${m.role.toUpperCase()}: ${text}`);
  }
  const joined = lines.join('\n\n');
  return joined.length > maxChars ? `${joined.slice(joined.length - maxChars)}` : joined;
}

export const SUMMARY_PROMPT =
  'Summarise the conversation so far for yourself, so you can continue the work without the original messages. ' +
  'Keep: the user goal and constraints, decisions taken, files read or changed (paths and what changed), commands run and their outcome, ' +
  'open problems and the next step. Be precise and compact (under 600 words). Output only the summary.';

export const SUMMARY_TITLE = 'Conversation summary';

/** Builds the compacted message list: system + summary note + recent tail. */
export function applyCompaction(split: CompactionSplit, summary: string): ChatMessage[] {
  const note: ChatMessage = { role: 'assistant', content: `${SUMMARY_TITLE}:\n${summary.trim()}` };
  const ack: ChatMessage = { role: 'user', content: 'Continue from that summary. The messages below are the most recent ones, kept verbatim.' };
  const tail = split.recent[0]?.role === 'user' ? split.recent : split.recent;
  return [...split.system, note, ack, ...tail];
}
