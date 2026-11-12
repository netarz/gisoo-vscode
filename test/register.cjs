// Mocha require hook: compiles .ts test and source files with esbuild (TypeScript 7 has no JS API for ts-node).
const esbuild = require('esbuild');
const fs = require('fs');
require.extensions['.ts'] = (mod, filename) => {
  const src = fs.readFileSync(filename, 'utf8');
  const { code } = esbuild.transformSync(src, { loader: 'ts', format: 'cjs', target: 'node18', sourcefile: filename, sourcemap: 'inline' });
  mod._compile(code, filename);
};
