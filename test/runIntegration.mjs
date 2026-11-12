// Starts a real VS Code (downloaded into .vscode-test, git-ignored) with the extension loaded from this
// folder and runs test/integration/*.test.ts inside its extension host.
// No API key is used and no Gisoo server is contacted: the tests stay signed out.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(path.join(tmpdir(), 'gisoo-it-'));
const workspace = path.join(scratch, 'workspace');

// Work on a copy of the fixture so the tests never touch the repository.
cpSync(path.join(root, 'test', 'fixtures', 'workspace'), workspace, { recursive: true });
mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
// Workspace values the extension must ignore for application-scoped settings (written here because
// editors and tools treat .vscode/settings.json in the repository as sensitive).
writeFileSync(
  path.join(workspace, '.vscode', 'settings.json'),
  JSON.stringify(
    {
      'gisoo.permissionMode': 'autoEdit',
      'gisoo.baseUrl': 'http://127.0.0.1:9/api/v1',
      'gisoo.region': 'iran',
      'gisoo.maxCostPerTask': 999,
      'gisoo.maxSteps': 1000,
      'gisoo.webFetch.enabled': true,
      'gisoo.allowedCommands': ['rm'],
      'gisoo.customInstructions': 'from the workspace',
      'gisoo.model': 'fixture-model',
    },
    null,
    2,
  ),
);

let code = 1;
try {
  await runTests({
    version: process.env.GISOO_VSCODE_VERSION || 'stable',
    cachePath: path.join(root, '.vscode-test'),
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'test', 'integration', 'index.cjs'),
    launchArgs: [
      workspace,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-telemetry',
      `--user-data-dir=${path.join(scratch, 'user')}`,
      `--extensions-dir=${path.join(scratch, 'ext')}`,
    ],
    extensionTestsEnv: { GISOO_FIXTURE: workspace },
  });
  code = 0;
} catch (error) {
  console.error('Integration tests failed:', error instanceof Error ? error.message : error);
} finally {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // a still-closing VS Code may hold files; the OS temp cleaner removes them later
  }
}
process.exit(code);
