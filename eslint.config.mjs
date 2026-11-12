// Minimal flat config: ESLint recommended + typescript-eslint recommended (no type-aware rules).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'media/**', 'out/**', '.vscode-test/**', '.work/**', 'node_modules/**', 'test/fixtures/**', 'docs/**', 'l10n/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['**/*.cjs', '**/*.mjs', '**/*.js'],
    languageOptions: { globals: { require: 'readonly', module: 'writable', exports: 'writable', process: 'readonly', console: 'readonly', __dirname: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
