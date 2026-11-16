/** Sessions as JSON files in <globalStorage>/sessions/<id>.json. Node fs only; the directory is injected. */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SessionSearchHit, SessionSummary } from '../shared/protocol';
import type { SessionData } from '../agent/session';
import { settleTurns } from '../agent/session';
import { fold, queryWords, snippet } from '../shared/search';

/** How much of a chat's message text is kept for search. */
const SEARCH_CHARS = 120_000;

/** What `list()` and `search()` need from one file, kept until the file changes. */
interface Entry {
  mtimeMs: number;
  size: number;
  /** Undefined for an empty or unreadable chat. */
  summary?: SessionSummary;
  /** The title and the user and assistant text, in order. */
  text: string;
  /** `fold(text)`. */
  folded: string;
}

export class SessionStore {
  private readonly dir: string;
  private writes = new Map<string, Promise<void>>();
  private entries = new Map<string, Entry>();

  constructor(storageDir: string) {
    this.dir = path.join(storageDir, 'sessions');
  }

  private file(id: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid session id');
    return path.join(this.dir, `${id}.json`);
  }

  async save(session: SessionData): Promise<void> {
    const target = this.file(session.id);
    const previous = this.writes.get(session.id) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.dir, { recursive: true });
        const tmp = `${target}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(session), 'utf8');
        await fs.rename(tmp, target);
        this.entries.delete(session.id);
      });
    this.writes.set(session.id, next);
    await next;
  }

  async load(id: string): Promise<SessionData | undefined> {
    try {
      const raw = await fs.readFile(this.file(id), 'utf8');
      const data = JSON.parse(raw) as SessionData;
      if (!data || typeof data.id !== 'string' || !Array.isArray(data.messages)) return undefined;
      data.turns = settleTurns(Array.isArray(data.turns) ? data.turns : []);
      data.todos = Array.isArray(data.todos) ? data.todos : [];
      data.allowedCommands = Array.isArray(data.allowedCommands) ? data.allowedCommands : [];
      data.costUsd = typeof data.costUsd === 'number' ? data.costUsd : 0;
      return data;
    } catch {
      return undefined;
    }
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
    try {
      await fs.unlink(this.file(id));
    } catch {
      // already gone
    }
  }

  /**
   * Every chat file with its summary and search text. A file is read and parsed again only when its
   * size or modification time changed, so opening the history panel stays quick with many chats.
   */
  private async scan(): Promise<Entry[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const seen = new Set<string>();
    const out: Entry[] = [];
    await Promise.all(names.map(async (name) => {
      if (!name.endsWith('.json')) return;
      const id = name.slice(0, -5);
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return;
      seen.add(id);
      let stat;
      try {
        stat = await fs.stat(path.join(this.dir, name));
      } catch {
        return;
      }
      let entry = this.entries.get(id);
      if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
        const data = await this.load(id);
        const text = data ? searchText(data) : '';
        entry = {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          summary: data && data.turns.length ? { id: data.id, title: data.title || untitled(data), updatedAt: data.updatedAt, turnCount: data.turns.length, origin: typeof data.origin === 'string' ? data.origin : undefined } : undefined,
          text,
          folded: fold(text),
        };
        this.entries.set(id, entry);
      }
      out.push(entry);
    }));
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.entries.delete(id);
    return out;
  }

  /** Newest first. Sessions without any turn are skipped. */
  async list(limit = 200): Promise<SessionSummary[]> {
    const items = (await this.scan()).flatMap((entry) => (entry.summary ? [entry.summary] : []));
    return items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }

  /** Chats whose title or messages contain every word of `query`, newest first. */
  async search(query: string, limit = 100): Promise<SessionSearchHit[]> {
    const words = queryWords(query);
    if (!words.length) return [];
    const found = (await this.scan())
      .filter((entry) => entry.summary && words.every((word) => entry.folded.includes(word)))
      .sort((a, b) => b.summary!.updatedAt - a.summary!.updatedAt)
      .slice(0, limit);
    return found.map((entry) => ({ id: entry.summary!.id, snippet: snippet(entry.text, words) }));
  }

  /** The newest session imported from `origin` (`source:id`), if any. */
  async findByOrigin(origin: string): Promise<string | undefined> {
    const items = await this.list(Number.MAX_SAFE_INTEGER);
    return items.find((item) => item.origin === origin)?.id;
  }

  /** Most recently updated session id, if any. */
  async latestId(): Promise<string | undefined> {
    const items = await this.list(1);
    return items[0]?.id;
  }
}

/** The text a search looks in: the title, then what the user and the assistant wrote. */
export function searchText(data: SessionData): string {
  const pieces: string[] = [];
  let size = 0;
  const add = (text: string | undefined) => {
    if (!text || size >= SEARCH_CHARS) return;
    const piece = text.length > SEARCH_CHARS - size ? text.slice(0, SEARCH_CHARS - size) : text;
    pieces.push(piece);
    size += piece.length + 1;
  };
  add(data.title);
  for (const turn of data.turns) {
    if (turn.role === 'assistant') {
      for (const part of turn.parts) if (part.kind === 'text') add(part.text);
    } else {
      add(turn.text);
    }
  }
  return pieces.join('\n');
}

function untitled(data: SessionData): string {
  const first = data.turns.find((t) => t.role === 'user');
  return first && first.role === 'user' ? first.text.slice(0, 60) : new Date(data.createdAt).toISOString().slice(0, 16).replace('T', ' ');
}
