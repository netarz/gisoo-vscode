/**
 * Pure SSE parsing and tool-call stitching for streamed chat completions.
 * No VS Code or network imports: unit-tested on its own.
 */
import type { ToolCall, WireUsage } from './types';

/** Turns raw text chunks (any split points, LF or CRLF) into the `data:` payload of each SSE event. */
export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];

  /** Feed a chunk; returns the complete event payloads found so far. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      const event = this.consumeLine(line);
      if (event !== undefined) out.push(event);
    }
    return out;
  }

  /** Flush at end of stream (a last event without a trailing blank line). */
  end(): string[] {
    const out: string[] = [];
    if (this.buffer.length) {
      const line = this.buffer.endsWith('\r') ? this.buffer.slice(0, -1) : this.buffer;
      this.buffer = '';
      const event = this.consumeLine(line);
      if (event !== undefined) out.push(event);
    }
    if (this.dataLines.length) {
      out.push(this.dataLines.join('\n'));
      this.dataLines = [];
    }
    return out;
  }

  private consumeLine(line: string): string | undefined {
    if (line === '') {
      if (!this.dataLines.length) return undefined;
      const payload = this.dataLines.join('\n');
      this.dataLines = [];
      return payload;
    }
    if (line.startsWith(':')) return undefined; // comment / keep-alive
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.dataLines.push(value);
    // `event:`, `id:`, `retry:` are ignored: the API only uses data lines.
    return undefined;
  }
}

/** Stitches `delta.tool_calls[]` fragments by index into complete tool calls. */
export class ToolCallStitcher {
  private readonly calls = new Map<number, ToolCall>();

  add(fragments: WireToolCallDelta[] | undefined): void {
    if (!fragments) return;
    for (const frag of fragments) {
      const index = typeof frag.index === 'number' ? frag.index : this.calls.size;
      let call = this.calls.get(index);
      if (!call) {
        call = { id: '', type: 'function', function: { name: '', arguments: '' } };
        this.calls.set(index, call);
      }
      if (frag.id) call.id = frag.id;
      if (frag.function?.name) call.function.name += frag.function.name;
      if (frag.function?.arguments) call.function.arguments += frag.function.arguments;
    }
  }

  get size(): number {
    return this.calls.size;
  }

  /** Calls in index order; missing ids get a stable synthetic id. */
  result(): ToolCall[] {
    return [...this.calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, call]) => ({
        ...call,
        id: call.id || `call_${index}`,
        function: { ...call.function },
      }));
  }
}

export interface WireToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

export interface WireChunk {
  id?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: WireToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  usage?: WireUsage | null;
  error?: { message?: string; type?: string; code?: string };
}

export type StreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'usage'; usage: WireUsage }
  | { kind: 'error'; message: string; code?: string }
  | { kind: 'done'; toolCalls: ToolCall[]; finishReason: string | null };

/**
 * Consumes decoded text chunks of a chat completion stream and yields high-level events.
 * Always ends with exactly one `done` event (unless the source throws).
 */
export async function* readChatStream(chunks: AsyncIterable<string>): AsyncGenerator<StreamEvent> {
  const parser = new SseParser();
  const stitcher = new ToolCallStitcher();
  let finishReason: string | null = null;
  let finished = false;

  const handle = (payload: string): StreamEvent[] => {
    const events: StreamEvent[] = [];
    const trimmed = payload.trim();
    if (!trimmed) return events;
    if (trimmed === '[DONE]') {
      finished = true;
      return events;
    }
    let chunk: WireChunk;
    try {
      chunk = JSON.parse(trimmed) as WireChunk;
    } catch {
      return events; // ignore malformed keep-alives
    }
    if (chunk.error) {
      events.push({ kind: 'error', message: chunk.error.message ?? 'Unknown error', code: chunk.error.code ?? chunk.error.type });
      return events;
    }
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;
      if (delta) {
        if (delta.content) events.push({ kind: 'text', text: delta.content });
        const reasoning = delta.reasoning ?? delta.reasoning_content;
        if (reasoning) events.push({ kind: 'reasoning', text: reasoning });
        if (delta.tool_calls) stitcher.add(delta.tool_calls);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    if (chunk.usage && typeof chunk.usage.prompt_tokens === 'number') {
      events.push({ kind: 'usage', usage: chunk.usage });
    }
    return events;
  };

  for await (const chunk of chunks) {
    for (const payload of parser.push(chunk)) {
      for (const ev of handle(payload)) yield ev;
    }
    if (finished) break;
  }
  if (!finished) {
    for (const payload of parser.end()) {
      for (const ev of handle(payload)) yield ev;
    }
  }
  yield { kind: 'done', toolCalls: stitcher.result(), finishReason };
}

/** Decodes a byte stream to text chunks (UTF-8 safe across chunk boundaries). */
export async function* decodeBytes(source: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8');
  for await (const bytes of source) {
    const text = decoder.decode(bytes, { stream: true });
    if (text) yield text;
  }
  const rest = decoder.decode();
  if (rest) yield rest;
}
