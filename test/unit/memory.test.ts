import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { looksLikeSecret, MemoryError, MemoryStore, memoryDir, quickMemoryFrom, toMemoryName } from '../../src/context/memory';

describe('memory names and paths', () => {
  const store = new MemoryStore({ dir: path.join(os.tmpdir(), 'gisoo-memory-guard'), source: 'gisoo', label: 'Gisoo memory', writable: true });

  it('accepts lowercase names and adds .md', () => {
    assert.equal(store.resolve('build-steps'), path.join(store.dir, 'build-steps.md'));
    assert.equal(store.resolve('notes-2.md'), path.join(store.dir, 'notes-2.md'));
  });

  it('refuses names that are not lowercase letters, digits and dashes', () => {
    for (const bad of ['Build.md', 'a b.md', 'x_y.md', 'a/b.md', '..\\x.md', '../x.md', 'a'.repeat(65), '']) {
      assert.throws(() => store.resolve(bad), (e: unknown) => e instanceof MemoryError && (e.reason === 'name' || e.reason === 'empty' || e.reason === 'outside'), `accepted ${JSON.stringify(bad)}`);
    }
  });

  it('builds the per-project folder from a slug like Claude Code', () => {
    const dir = memoryDir('/home/u', 'C:\\Projects\\my app');
    assert.ok(dir.endsWith(path.join('.gisoo', 'projects', 'C--Projects-my-app', 'memory')));
  });

  it('turns free text into a file name', () => {
    assert.equal(toMemoryName('Prefers Tabs, not spaces!'), 'prefers-tabs-not-spaces.md');
    assert.equal(toMemoryName('!!!'), undefined);
  });
});

describe('memory secret refusal', () => {
  it('detects keys, tokens, private keys, passwords and card numbers', () => {
    assert.ok(looksLikeSecret('key sk-abcdefghijklmnopqrstuvwxyz'));
    assert.ok(looksLikeSecret('ghp_abcdefghijklmnopqrstuvwxyz0123456789'));
    assert.ok(looksLikeSecret('-----BEGIN RSA PRIVATE KEY-----'));
    assert.ok(looksLikeSecret('the password is hunter2secret'));
    assert.ok(looksLikeSecret('card 4111 1111 1111 1111'));
    assert.ok(looksLikeSecret('Authorization: Bearer abcdefghijklmnopqrstuvwxyz'));
  });

  it('accepts ordinary notes', () => {
    assert.equal(looksLikeSecret('The user prefers tabs and runs tests with npm test.'), undefined);
    assert.equal(looksLikeSecret('Issue #1234 tracks the 2026-11-12 release.'), undefined);
  });
});

describe('memory store on disk', () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gisoo-memory-'));
    store = new MemoryStore({ dir, source: 'gisoo', label: 'Gisoo memory', writable: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes a file with frontmatter and an index line, then deletes it', async () => {
    const r = await store.write('build-steps', 'Run npm run build before tests.', { description: 'How to build', type: 'project' });
    assert.equal(r.entry.name, 'build-steps.md');
    const text = await fs.readFile(r.path, 'utf8');
    assert.match(text, /^---\nname: build-steps\ndescription: How to build\nmetadata:\n {2}type: project\n---/);
    const index = await fs.readFile(store.indexPath, 'utf8');
    assert.match(index, /- \[build-steps\]\(build-steps\.md\) — How to build/);
    await store.write('build-steps', 'Changed.', { description: 'Updated' });
    const again = await fs.readFile(store.indexPath, 'utf8');
    assert.equal((again.match(/build-steps\.md/g) ?? []).length, 1);
    await store.delete('build-steps');
    assert.doesNotMatch(await fs.readFile(store.indexPath, 'utf8'), /build-steps/);
    assert.deepEqual(await store.list(), []);
  });

  it('refuses secrets and empty content', async () => {
    await assert.rejects(store.write('token', 'api_key = abcdefghijklmnopqrstuvwxyz'), (e: unknown) => e instanceof MemoryError && e.reason === 'secret');
    await assert.rejects(store.write('empty', '   '), (e: unknown) => e instanceof MemoryError && e.reason === 'empty');
    assert.deepEqual(await store.list(), []);
  });

  it('refuses writes on a read-only store', async () => {
    const ro = new MemoryStore({ dir, source: 'claude', label: 'Claude memory', writable: false });
    await assert.rejects(ro.write('x', 'y'), (e: unknown) => e instanceof MemoryError && e.reason === 'readonly');
    await assert.rejects(ro.delete('x'), (e: unknown) => e instanceof MemoryError && e.reason === 'readonly');
  });
});

describe('quick memory (#text)', () => {
  it('names the file after the first words', () => {
    const q = quickMemoryFrom('# Prefer tabs over spaces in this repo always');
    assert.ok(q);
    assert.equal(q.name, 'prefer-tabs-over-spaces-in-this.md');
    assert.equal(q.body, 'Prefer tabs over spaces in this repo always');
  });

  it('falls back to a dated name for non-ASCII text and refuses empty text', () => {
    const q = quickMemoryFrom('#کاربر تب را ترجیح می‌دهد', new Date('2026-11-12T10:00:00Z'));
    assert.ok(q);
    assert.match(q.name, /^note-20261112-\d+\.md$/);
    assert.equal(quickMemoryFrom('#   '), undefined);
  });
});
