/** Snapshots of files before the first write in a turn; restore per turn. */
import { deleteFile, writeText } from '../tools/workspace';

export class Checkpoints {
  /** turnId -> absolute path -> previous content (null = did not exist). */
  private readonly byTurn = new Map<string, Map<string, string | null>>();
  private readonly order: string[] = [];
  private readonly maxTurns = 50;

  /** Records the previous content once per turn and file. */
  record(turnId: string, absolutePath: string, previous: string | null): void {
    let files = this.byTurn.get(turnId);
    if (!files) {
      files = new Map();
      this.byTurn.set(turnId, files);
      this.order.push(turnId);
      while (this.order.length > this.maxTurns) {
        const old = this.order.shift();
        if (old) this.byTurn.delete(old);
      }
    }
    if (!files.has(absolutePath)) files.set(absolutePath, previous);
  }

  has(turnId: string): boolean {
    return (this.byTurn.get(turnId)?.size ?? 0) > 0;
  }

  files(turnId: string): string[] {
    return [...(this.byTurn.get(turnId)?.keys() ?? [])];
  }

  latestTurnId(): string | undefined {
    for (let i = this.order.length - 1; i >= 0; i--) if (this.has(this.order[i])) return this.order[i];
    return undefined;
  }

  /** Restores every file of the turn; returns the number of files restored. */
  async restore(turnId: string): Promise<number> {
    const files = this.byTurn.get(turnId);
    if (!files) return 0;
    let count = 0;
    for (const [absolutePath, previous] of files) {
      if (previous === null) await deleteFile(absolutePath);
      else await writeText(absolutePath, previous, false).catch(() => writeText(absolutePath, previous, true));
      count++;
    }
    this.byTurn.delete(turnId);
    return count;
  }

  clear(): void {
    this.byTurn.clear();
    this.order.length = 0;
  }
}
