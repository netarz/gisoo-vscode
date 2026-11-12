import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { capInstruction, findImportTokens, isInsideFolder, MAX_INSTRUCTION_FILE_CHARS, resolveImportPath, resolveImports, TRUNCATION_MARK } from '../../src/context/instructions';
import { PathGuardError, resolveWorkspacePath } from '../../src/tools/pathGuard';

const root = path.resolve('/ws/project');
const home = path.resolve('/home/user');
const importing = path.join(root, 'GISOO.md');
const opts = { allowedRoots: [root, path.join(home, '.gisoo'), path.join(home, '.claude')], homeDir: home };

describe('instruction @imports', () => {
  it('finds @path tokens at line start and after whitespace only', () => {
    const tokens = findImportTokens('@docs/rules.md\nsee @./a.md and mail me@example.com\n');
    assert.deepEqual(
      tokens.map((t) => t.target),
      ['docs/rules.md', './a.md'],
    );
  });

  it('ignores tokens inside code spans and fences', () => {
    const text = 'use `@skip.md`\n```\n@fenced.md\n```\n@real.md';
    assert.deepEqual(
      findImportTokens(text).map((t) => t.target),
      ['real.md'],
    );
  });

  it('resolves relative and ~ imports inside allowed roots', () => {
    assert.equal(resolveImportPath('docs/rules.md', importing, opts), path.join(root, 'docs', 'rules.md'));
    assert.equal(resolveImportPath('~/.gisoo/GISOO.md', importing, opts), path.join(home, '.gisoo', 'GISOO.md'));
  });

  it('refuses imports that leave the allowed roots or enter .git', () => {
    assert.equal(resolveImportPath('../../etc/passwd', importing, opts), undefined);
    assert.equal(resolveImportPath('~/.ssh/id_rsa', importing, opts), undefined);
    assert.equal(resolveImportPath(path.join(root, '.git', 'config'), importing, opts), undefined);
    assert.equal(resolveImportPath(path.resolve('/elsewhere/x.md'), importing, opts), undefined);
  });

  it('inlines imports recursively, keeps unresolved ones as text and stops cycles', async () => {
    const files: Record<string, string> = {
      [path.join(root, 'docs', 'a.md')]: 'A says hi\n@b.md',
      [path.join(root, 'docs', 'b.md')]: 'B here @a.md',
    };
    const readFile = async (p: string): Promise<string | null> => files[p] ?? null;
    const result = await resolveImports('Top @docs/a.md @missing.md @../outside.md', importing, { ...opts, readFile });
    assert.match(result.text, /\[Imported from a\.md\]/);
    assert.match(result.text, /\[Imported from b\.md\]/);
    assert.match(result.text, /B here @a\.md/);
    assert.match(result.text, /@missing\.md/);
    assert.match(result.text, /@\.\.\/outside\.md/);
    assert.deepEqual(result.imported.sort(), [path.join(root, 'docs', 'a.md'), path.join(root, 'docs', 'b.md')].sort());
  });

  it('stops at the depth limit', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) files[path.join(root, `f${i}.md`)] = `level ${i} @f${i + 1}.md`;
    const readFile = async (p: string): Promise<string | null> => files[p] ?? null;
    const result = await resolveImports('@f0.md', importing, { ...opts, readFile, maxDepth: 3 });
    assert.match(result.text, /level 2/);
    assert.doesNotMatch(result.text, /level 3/);
  });

  it('caps a file and marks the truncation', () => {
    const big = 'x'.repeat(MAX_INSTRUCTION_FILE_CHARS + 10);
    const capped = capInstruction(big);
    assert.equal(capped.truncated, true);
    assert.ok(capped.text.endsWith(TRUNCATION_MARK));
    assert.equal(capInstruction('short').truncated, false);
  });

  it('isInsideFolder handles the root itself and siblings', () => {
    assert.equal(isInsideFolder(root, root), true);
    assert.equal(isInsideFolder(root, path.join(root, 'a')), true);
    assert.equal(isInsideFolder(root, `${root}-other`), false);
  });
});

describe('workspace path guard', () => {
  const realpath = async (p: string): Promise<string> => p;

  it('accepts relative paths inside the workspace', async () => {
    const r = await resolveWorkspacePath('src/index.ts', [root], realpath);
    assert.equal(r.relative, 'src/index.ts');
    assert.equal(r.root, root);
  });

  it('refuses paths outside the workspace and inside .git', async () => {
    await assert.rejects(resolveWorkspacePath('../outside.txt', [root], realpath), (e: unknown) => e instanceof PathGuardError && e.reason === 'outside');
    await assert.rejects(resolveWorkspacePath('.git/config', [root], realpath), (e: unknown) => e instanceof PathGuardError && e.reason === 'git');
    await assert.rejects(resolveWorkspacePath('', [root], realpath), (e: unknown) => e instanceof PathGuardError && e.reason === 'empty');
    await assert.rejects(resolveWorkspacePath('a.txt', [], realpath), (e: unknown) => e instanceof PathGuardError && e.reason === 'no_workspace');
  });

  it('follows symlinks that escape the workspace', async () => {
    // Like fs.realpath: throws for paths that do not exist; "link" points outside the workspace.
    const escaping = async (p: string): Promise<string> => {
      if (p === root) return p;
      if (p === path.join(root, 'link')) return path.resolve('/elsewhere');
      throw new Error('ENOENT');
    };
    await assert.rejects(resolveWorkspacePath('link/secret.txt', [root], escaping), (e: unknown) => e instanceof PathGuardError && e.reason === 'outside');
  });
});
