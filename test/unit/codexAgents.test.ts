import assert from 'node:assert/strict';
import { parseCodexAgent, parseSimpleToml } from '../../src/agents/definitions';

describe('Codex agent TOML reader', () => {
  it('reads top-level string keys, both quote styles and comments', () => {
    const data = parseSimpleToml([
      '# a comment',
      'name = "reviewer"',
      "description = 'Reviews pull requests' # trailing comment",
      'model = "gpt-5"',
      'count = 3',
      'enabled = true',
    ].join('\n'));
    assert.equal(data.name, 'reviewer');
    assert.equal(data.description, 'Reviews pull requests');
    assert.equal(data.model, 'gpt-5');
    assert.equal(data.count, undefined);
    assert.equal(data.enabled, undefined);
  });

  it('reads multi-line strings and keeps literal fences verbatim', () => {
    const data = parseSimpleToml([
      'developer_instructions = """',
      'Line one',
      'Line "two" with \\t tab',
      '"""',
      "notes = '''",
      'raw \\n stays',
      "'''",
    ].join('\n'));
    assert.equal(data.developer_instructions, 'Line one\nLine "two" with \t tab\n');
    assert.equal(data.notes, 'raw \\n stays\n');
  });

  it('ignores keys inside tables', () => {
    const data = parseSimpleToml(['name = "top"', '[tool]', 'name = "nested"'].join('\n'));
    assert.equal(data.name, 'top');
  });

  it('builds an AgentDefinition with source codex and the file name as fallback', () => {
    const def = parseCodexAgent(
      ['description = "Finds flaky tests"', 'developer_instructions = """', 'You hunt flaky tests.', '"""'].join('\n'),
      { path: '/repo/.codex/agents/flaky-hunter.toml', scope: 'project' },
    );
    assert.ok(def);
    assert.equal(def.name, 'flaky-hunter');
    assert.equal(def.source, 'codex');
    assert.equal(def.scope, 'project');
    assert.equal(def.description, 'Finds flaky tests');
    assert.equal(def.prompt, 'You hunt flaky tests.');
    assert.equal(def.tools, undefined);
  });

  it('rejects names that are not safe identifiers', () => {
    assert.equal(parseCodexAgent('name = "bad name!"', { path: '/x/a.toml', scope: 'user' }), undefined);
  });
});
