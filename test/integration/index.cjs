// Mocha entry point loaded by VS Code's extension host (see test/runIntegration.mjs).
// TypeScript tests are compiled on the fly with esbuild, like test/register.cjs does for the unit tests.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const Mocha = require('mocha');

require.extensions['.ts'] = (mod, filename) => {
  const src = fs.readFileSync(filename, 'utf8');
  const { code } = esbuild.transformSync(src, { loader: 'ts', format: 'cjs', target: 'node18', sourcefile: filename, sourcemap: 'inline' });
  mod._compile(code, filename);
};

exports.run = () =>
  new Promise((resolve, reject) => {
    const mocha = new Mocha({ ui: 'bdd', color: false, timeout: 60000 });
    for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.ts')).sort()) mocha.addFile(path.join(__dirname, file));
    mocha.run((failures) => (failures ? reject(new Error(`${failures} integration test(s) failed`)) : resolve()));
  });
