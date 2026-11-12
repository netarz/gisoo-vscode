import assert from 'node:assert/strict';
import { checkUrlPath, hostAllowed, injectReload, isLocalUrl, RELOAD_SCRIPT } from '../../src/preview/server';

describe('preview server: URL path check', () => {
  it('normalises ordinary paths to a relative POSIX path', () => {
    assert.deepEqual(checkUrlPath('/index.html'), { ok: true, relative: 'index.html' });
    assert.deepEqual(checkUrlPath('/'), { ok: true, relative: '' });
    assert.deepEqual(checkUrlPath('/a/./b/c.css?v=1#x'), { ok: true, relative: 'a/b/c.css' });
    assert.deepEqual(checkUrlPath('/caf%C3%A9/page.html'), { ok: true, relative: 'café/page.html' });
  });

  it('rejects traversal, backslashes, drive letters and bad encodings', () => {
    assert.deepEqual(checkUrlPath('/../etc/passwd'), { ok: false, status: 400 });
    assert.deepEqual(checkUrlPath('/a/%2e%2e/b'), { ok: false, status: 400 });
    assert.deepEqual(checkUrlPath('/a\\b.html'), { ok: false, status: 400 });
    assert.deepEqual(checkUrlPath('/C:/Windows/win.ini'), { ok: false, status: 400 });
    assert.deepEqual(checkUrlPath('/%E0%A4%A'), { ok: false, status: 400 });
    assert.deepEqual(checkUrlPath('/a%00.html'), { ok: false, status: 400 });
  });

  it('forbids dotfiles, .git, .env* and key material', () => {
    for (const p of ['/.git/config', '/.env', '/.env.local', '/sub/.secret', '/certs/server.pem', '/id_rsa.key', '/.GIT/HEAD']) {
      assert.deepEqual(checkUrlPath(p), { ok: false, status: 403 }, p);
    }
  });
});

describe('preview server: Host header and local URLs', () => {
  it('accepts only loopback hosts with the exact port', () => {
    assert.equal(hostAllowed('127.0.0.1:4321', 4321), true);
    assert.equal(hostAllowed('localhost:4321', 4321), true);
    assert.equal(hostAllowed('LOCALHOST:4321', 4321), true);
    assert.equal(hostAllowed('127.0.0.1:4322', 4321), false);
    assert.equal(hostAllowed('127.0.0.1', 4321), false);
    assert.equal(hostAllowed('evil.example:4321', 4321), false);
    assert.equal(hostAllowed(undefined, 4321), false);
  });

  it('only allows http(s) URLs on loopback for preview and screenshots', () => {
    assert.equal(isLocalUrl('http://127.0.0.1:3000/'), true);
    assert.equal(isLocalUrl('http://localhost:5173/app'), true);
    assert.equal(isLocalUrl('https://localhost/'), true);
    assert.equal(isLocalUrl('http://example.com/'), false);
    assert.equal(isLocalUrl('file:///etc/passwd'), false);
    assert.equal(isLocalUrl('http://127.0.0.1.evil.com/'), false);
    assert.equal(isLocalUrl('not a url'), false);
  });
});

describe('preview server: live reload injection', () => {
  it('inserts the client before </body> and otherwise appends it', () => {
    const html = '<html><body><p>hi</p></body></html>';
    const out = injectReload(html);
    assert.ok(out.includes(RELOAD_SCRIPT));
    assert.ok(out.indexOf(RELOAD_SCRIPT) < out.indexOf('</body>'));
    assert.equal(injectReload('<p>no body</p>'), `<p>no body</p>${RELOAD_SCRIPT}`);
  });
});
