/** Small line diff (Myers, O(ND)) and unified-diff rendering. Pure, no dependencies. */

export type DiffOp = { kind: 'equal' | 'add' | 'remove'; line: string };

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

/** Myers diff on lines; falls back to a trivial diff for very large inputs. */
export function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n * m > 4_000_000) {
    return [...a.map((line) => ({ kind: 'remove', line }) as DiffOp), ...b.map((line) => ({ kind: 'add', line }) as DiffOp)];
  }
  // Trim common prefix/suffix to keep the edit graph small.
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) start++;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const core = myers(a.slice(start, endA), b.slice(start, endB));
  return [
    ...a.slice(0, start).map((line) => ({ kind: 'equal', line }) as DiffOp),
    ...core,
    ...a.slice(endA).map((line) => ({ kind: 'equal', line }) as DiffOp),
  ];
}

function myers(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((line) => ({ kind: 'add', line }) as DiffOp);
  if (m === 0) return a.map((line) => ({ kind: 'remove', line }) as DiffOp);
  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }
  // Backtrack.
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: 'equal', line: a[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        ops.push({ kind: 'add', line: b[y - 1] });
        y--;
      } else {
        ops.push({ kind: 'remove', line: a[x - 1] });
        x--;
      }
    }
  }
  return ops.reverse();
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function diffStats(ops: DiffOp[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === 'add') added++;
    else if (op.kind === 'remove') removed++;
  }
  return { added, removed };
}

/** Renders a unified diff with `context` lines around each change (git style headers). */
export function unifiedDiff(oldText: string, newText: string, pathLabel: string, context = 3): { diff: string; stats: DiffStats } {
  const ops = diffLines(oldText, newText);
  const stats = diffStats(ops);
  if (!stats.added && !stats.removed) return { diff: '', stats };
  const header = `--- a/${pathLabel}\n+++ b/${pathLabel}\n`;
  const hunks: string[] = [];
  let i = 0;
  let oldLine = 1;
  let newLine = 1;
  while (i < ops.length) {
    if (ops[i].kind === 'equal') {
      oldLine++;
      newLine++;
      i++;
      continue;
    }
    // Start of a change: back up `context` equal lines.
    let start = i;
    let ctxBefore = 0;
    while (start > 0 && ctxBefore < context && ops[start - 1].kind === 'equal') {
      start--;
      ctxBefore++;
    }
    // Extend to the end of this hunk: changes separated by at most 2*context equal lines.
    let end = i;
    let equalRun = 0;
    let j = i;
    while (j < ops.length) {
      if (ops[j].kind === 'equal') {
        equalRun++;
        if (equalRun > 2 * context) break;
      } else {
        equalRun = 0;
        end = j + 1;
      }
      j++;
    }
    const tail = Math.min(ops.length, end + context);
    const hunkOps = ops.slice(start, tail);
    const hunkOldStart = oldLine - ctxBefore;
    const hunkNewStart = newLine - ctxBefore;
    let oldCount = 0;
    let newCount = 0;
    const body: string[] = [];
    for (const op of hunkOps) {
      if (op.kind === 'equal') {
        oldCount++;
        newCount++;
        body.push(` ${op.line}`);
      } else if (op.kind === 'remove') {
        oldCount++;
        body.push(`-${op.line}`);
      } else {
        newCount++;
        body.push(`+${op.line}`);
      }
    }
    hunks.push(`@@ -${hunkOldStart},${oldCount} +${hunkNewStart},${newCount} @@\n${body.join('\n')}\n`);
    // Advance counters over consumed ops.
    for (let k = i; k < tail; k++) {
      const op = ops[k];
      if (op.kind === 'equal') {
        oldLine++;
        newLine++;
      } else if (op.kind === 'remove') oldLine++;
      else newLine++;
    }
    i = tail;
  }
  return { diff: header + hunks.join(''), stats };
}
