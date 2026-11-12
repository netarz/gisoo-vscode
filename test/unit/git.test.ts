import assert from 'node:assert/strict';
import { GIT_LOG_LIMIT, gitArgv, isValidRef } from '../../src/tools/gitArgv';

describe('git tool: ref validation', () => {
  it('accepts branches, tags, commit ids and relative refs', () => {
    for (const ref of ['main', 'feature/login', 'v1.2.3', 'abc123def', 'HEAD~2', 'HEAD^', 'origin/main', 'release-2026.01']) {
      assert.equal(isValidRef(ref), true, ref);
    }
  });

  it('rejects flag-like, traversal-like and malformed refs', () => {
    for (const ref of ['-rf', '--output=x', 'a..b', 'main.lock', '', 'a b', 'x;rm', '`id`', '$(id)', 'a'.repeat(101), 'ref\n--x']) {
      assert.equal(isValidRef(ref), false, JSON.stringify(ref));
    }
  });
});

describe('git tool: fixed argv', () => {
  it('builds a fixed list per action with the path after --', () => {
    const argv = gitArgv('status', undefined, 'src');
    assert.ok(Array.isArray(argv));
    assert.deepEqual(argv.slice(0, 5), ['--no-pager', '-c', 'color.ui=false', '-c', 'core.quotepath=false']);
    assert.ok(argv.includes('--porcelain=v1'));
    assert.deepEqual(argv.slice(-2), ['--', 'src']);
  });

  it('places the ref before the path and caps log output', () => {
    const log = gitArgv('log', 'main', 'README.md');
    assert.ok(Array.isArray(log));
    assert.ok(log.includes(`--max-count=${GIT_LOG_LIMIT}`));
    assert.ok(log.indexOf('main') < log.indexOf('--'));
    const show = gitArgv('show', undefined, undefined);
    assert.ok(Array.isArray(show) && show.includes('HEAD'));
  });

  it('returns a message for bad input instead of an argument list', () => {
    assert.equal(typeof gitArgv('push', undefined, undefined), 'string');
    assert.equal(typeof gitArgv('diff', '--all', undefined), 'string');
    assert.equal(typeof gitArgv('diff', undefined, '-x'), 'string');
    assert.equal(typeof gitArgv('blame', undefined, undefined), 'string');
  });

  it('never lets a ref or path become a flag', () => {
    for (const action of ['diff', 'log', 'show', 'blame']) {
      const out = gitArgv(action, '-v', 'file.ts');
      assert.equal(typeof out, 'string', action);
    }
    const blame = gitArgv('blame', 'HEAD~1', 'src/a.ts');
    assert.ok(Array.isArray(blame));
    assert.deepEqual(blame.slice(-3), ['HEAD~1', '--', 'src/a.ts']);
  });
});
