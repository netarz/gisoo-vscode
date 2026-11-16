/** Chats from other AI coding tools, read-only. No vscode imports: the readers are unit tested in Node. */
import type { ExternalSource } from '../../shared/protocol';

export type { ExternalSource };

/** One chat found on disk for the current workspace folder. */
export interface ExternalSession {
  source: ExternalSource;
  /** The tool's own session id. */
  id: string;
  title: string;
  /** File modification time (ms). */
  updatedAt: number;
  /** User and assistant turns, when the file was small enough to count; otherwise undefined. */
  messageCount?: number;
  /** Absolute path of the transcript file. Stays in the extension host. */
  filePath: string;
}

/** A conversation turn turned into plain text. */
export interface ExternalTurn {
  role: 'user' | 'assistant';
  text: string;
  /** ms since epoch, when the line had a timestamp. */
  at?: number;
}

export interface ExternalTranscript {
  source: ExternalSource;
  id: string;
  title: string;
  turns: ExternalTurn[];
  /** Turns left out at the start because the chat was too long to carry over. */
  omitted: number;
  /** Lines too large to parse that were skipped. */
  skippedLines: number;
}

export interface ListOptions {
  /** Newest chats kept per source. */
  limit?: number;
}

export const SOURCE_LABELS: Record<ExternalSource, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};
