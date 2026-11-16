import * as assert from 'node:assert/strict';
import { createPkce, extractSignInCode, parseCallback, pkceExpired } from '../../src/auth/pkce';
import { STRINGS } from '../../src/ui/strings';
import { en as webviewStrings } from '../../webview/strings';

describe('sign-in code', () => {
  it('accepts the code as the web page shows it', () => {
    assert.equal(extractSignInCode('MN8H-8NTK-4HH5'), 'MN8H-8NTK-4HH5');
    assert.equal(extractSignInCode('  mn8h-8ntk-4hh5\n'), 'mn8h-8ntk-4hh5');
  });

  it('drops spaces a copy from the page may carry', () => {
    assert.equal(extractSignInCode('MN8H 8NTK 4HH5'), 'MN8H8NTK4HH5');
  });

  it('takes the code out of a pasted callback URL', () => {
    assert.equal(extractSignInCode('vscode://gisoo.gisoo-vscode/auth?code=AB12-CD34-EF56&state=xyz'), 'AB12-CD34-EF56');
    assert.equal(extractSignInCode('https://example.test/cb?state=1&code=AB12%2DCD34'), 'AB12-CD34');
  });

  it('refuses empty, short or foreign input', () => {
    assert.equal(extractSignInCode(''), undefined);
    assert.equal(extractSignInCode('   '), undefined);
    assert.equal(extractSignInCode('abc'), undefined);
    assert.equal(extractSignInCode('<script>alert(1)</script>'), undefined);
    assert.equal(extractSignInCode('x'.repeat(201)), undefined);
  });
});

describe('PKCE pair', () => {
  it('carries state, verifier and creation time that survive JSON storage', () => {
    const pair = createPkce(1000);
    const restored = JSON.parse(JSON.stringify(pair)) as typeof pair;
    assert.deepEqual(restored, pair);
    assert.ok(pair.state.length >= 16 && pair.verifier.length >= 43);
  });

  it('expires', () => {
    const pair = createPkce(0);
    assert.equal(pkceExpired(pair, 1000), false);
    assert.equal(pkceExpired(pair, 24 * 60 * 60 * 1000), true);
  });

  it('parses the callback query', () => {
    assert.deepEqual(parseCallback('code=abc&state=def'), { code: 'abc', state: 'def' });
  });
});

describe('panel strings', () => {
  it('has a Persian text for every key the panel uses', () => {
    const missing = Object.keys(webviewStrings).filter((key) => !(key in STRINGS));
    assert.deepEqual(missing, []);
  });

  it('keeps placeholders identical in both languages', () => {
    for (const [key, entry] of Object.entries(STRINGS) as Array<[string, { en: string; fa: string }]>) {
      const names = (text: string): string => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      assert.equal(names(entry.fa), names(entry.en), key);
    }
  });
});
