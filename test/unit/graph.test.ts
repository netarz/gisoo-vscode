import assert from 'node:assert/strict';
import {
  affectedBy,
  capToBudget,
  clampBudget,
  cleanGraphArg,
  GRAPH_BUDGET_CAP,
  indexGraph,
  parseGraph,
  pathBetween,
  queryGraph,
  TRUNCATION_MARK,
} from '../../src/graph/query';

const sample = {
  built_at_commit: 'abcdef1234567890',
  nodes: [
    { id: 'auth.login', label: 'login', source_file: 'src/auth.ts', file_type: 'function' },
    { id: 'auth.verify', label: 'verifyToken', source_file: 'src/auth.ts', file_type: 'function' },
    { id: 'http.handler', label: 'handleRequest', source_file: 'src/http.ts', file_type: 'function' },
    { id: 'db.users', label: 'UsersTable', source_file: 'src/db.ts', file_type: 'class' },
  ],
  links: [
    { source: 'http.handler', target: 'auth.login', relation: 'calls' },
    { source: 'auth.login', target: 'auth.verify', relation: 'calls' },
    { source: 'auth.login', target: 'db.users', relation: 'reads' },
  ],
};

describe('graph.json fallback', () => {
  it('parses the nodes/links shape and the nodes/edges shape', () => {
    const a = parseGraph(sample);
    assert.equal(a.nodes.length, 4);
    assert.equal(a.edges.length, 3);
    assert.equal(a.builtAtCommit, 'abcdef1234567890');
    const b = parseGraph({ nodes: [{ id: 'x', name: 'X' }, { id: 'y' }], edges: [{ from: 'x', to: 'y' }] });
    assert.equal(b.nodes.length, 2);
    assert.deepEqual(b.edges[0], { source: 'x', target: 'y', relation: undefined });
    assert.deepEqual(parseGraph('nonsense'), { nodes: [], edges: [] });
  });

  it('answers a label query with the matching node and its relations', () => {
    const index = indexGraph(parseGraph(sample));
    const text = queryGraph(index, 'login', 1500);
    assert.match(text, /login/);
    assert.match(text, /verifyToken|UsersTable/);
    assert.match(queryGraph(index, 'nothing-like-this-zzz', 1500), /No node/);
  });

  it('walks dependents breadth-first for graph_affected and finds paths', () => {
    const index = indexGraph(parseGraph(sample));
    const affected = affectedBy(index, 'verifyToken', 1500);
    assert.match(affected, /login/);
    assert.match(affected, /handleRequest/);
    const path = pathBetween(index, 'handleRequest', 'UsersTable', 1500);
    assert.match(path, /2 hops/);
  });

  it('marks truncated answers', () => {
    const long = Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
    const capped = capToBudget(long, 300);
    assert.ok(capped.length < long.length);
    assert.ok(capped.endsWith(TRUNCATION_MARK));
    assert.equal(capToBudget('short', 300), 'short');
  });

  it('sanitises CLI arguments and clamps the budget', () => {
    assert.equal(cleanGraphArg('  --force   rm  '), 'force rm');
    assert.equal(cleanGraphArg(undefined), '');
    assert.equal(cleanGraphArg('a'.repeat(500)).length, 300);
    assert.equal(clampBudget(undefined, 1500), 1500);
    assert.equal(clampBudget(99_999, 1500), GRAPH_BUDGET_CAP);
    assert.equal(clampBudget(10, 1500), 200);
    assert.equal(clampBudget(Number.NaN, 700), 700);
  });
});
