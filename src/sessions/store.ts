/** Sessions as JSON files in <globalStorage>/sessions/<id>.json. Node fs only; the directory is injected. */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SessionSummary } from '../shared/protocol';
import type { SessionData } from '../agent/session';
import { settleTurns } from '../agent/session';

export class SessionStore {
  private readonly dir: string;
  private writes = new Map<string, Promise<void>>();

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
    try {
      await fs.unlink(this.file(id));
    } catch {
      // already gone
    }
  }

  /** Newest first. Sessions without any turn are skipped. */
  async list(limit = 200): Promise<SessionSummary[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const items: SessionSummary[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const data = await this.load(name.slice(0, -5));
      if (!data || !data.turns.length) continue;
      items.push({ id: data.id, title: data.title || untitled(data), updatedAt: data.updatedAt, turnCount: data.turns.length });
    }
    return items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }

  /** Most recently updated session id, if any. */
  async latestId(): Promise<string | undefined> {
    const items = await this.list(1);
    return items[0]?.id;
  }
}

function untitled(data: SessionData): string {
  const first = data.turns.find((t) => t.role === 'user');
  return first && first.role === 'user' ? first.text.slice(0, 60) : new Date(data.createdAt).toISOString().slice(0, 16).replace('T', ' ');
}
