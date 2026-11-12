/** Queued user messages and their injection into the conversation (SPEC §5 step 4). Pure. */
import type { Attachment, QueuedMessage } from '../shared/protocol';
import type { ChatMessage } from '../api/types';

export const INJECTED_PREFIX = '[User added while you were working]: ';

export class MessageQueue {
  private items: QueuedMessage[] = [];
  private seq = 0;

  constructor(private readonly onChange?: (items: QueuedMessage[]) => void) {}

  add(text: string, attachments: Attachment[] = []): QueuedMessage {
    const item: QueuedMessage = { id: `q${Date.now().toString(36)}${(this.seq++).toString(36)}`, text, attachments };
    this.items.push(item);
    this.emit();
    return item;
  }

  edit(id: string, text: string): boolean {
    const item = this.items.find((q) => q.id === id);
    if (!item) return false;
    item.text = text;
    this.emit();
    return true;
  }

  remove(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((q) => q.id !== id);
    if (this.items.length !== before) this.emit();
    return this.items.length !== before;
  }

  /** Takes every queued message, in order, and empties the queue. */
  drain(): QueuedMessage[] {
    const out = this.items;
    this.items = [];
    if (out.length) this.emit();
    return out;
  }

  peek(): readonly QueuedMessage[] {
    return this.items;
  }

  get length(): number {
    return this.items.length;
  }

  clear(): void {
    if (!this.items.length) return;
    this.items = [];
    this.emit();
  }

  private emit(): void {
    this.onChange?.([...this.items]);
  }
}

/** Builds the API user message for messages injected mid-run (attachments rendered as text). */
export function injectedUserMessage(items: QueuedMessage[], renderAttachments: (a: Attachment[]) => string): ChatMessage {
  const body = items
    .map((q) => {
      const extra = renderAttachments(q.attachments);
      return extra ? `${q.text}\n\n${extra}` : q.text;
    })
    .join('\n\n');
  return { role: 'user', content: `${INJECTED_PREFIX}${body}` };
}

/**
 * Appends tool results, then (if any) the injected user message, to the conversation.
 * Order: assistant tool-call message → tool results (in call order) → injected user message.
 */
export function appendStepResults(messages: ChatMessage[], toolResults: ChatMessage[], injected: ChatMessage | undefined): ChatMessage[] {
  const out = [...messages, ...toolResults];
  if (injected) out.push(injected);
  return out;
}
