import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const common = { bundle: true, minify: production, sourcemap: !production, logLevel: 'info', legalComments: 'none' };

const host = { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'] };
const webview = { ...common, entryPoints: ['webview/main.tsx'], outfile: 'media/webview.js', platform: 'browser', format: 'iife', target: 'es2020', jsx: 'automatic', jsxImportSource: 'preact', loader: { '.css': 'text' } };

if (watch) {
  const ctxs = await Promise.all([esbuild.context(host), esbuild.context(webview)]);
  await Promise.all(ctxs.map((c) => c.watch()));
} else {
  await Promise.all([esbuild.build(host), esbuild.build(webview)]);
}
