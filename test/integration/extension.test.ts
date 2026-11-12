import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getSettings, userSetting } from '../../src/config';
import type { GisooExports } from '../../src/extension';

const EXTENSION_ID = 'gisoo.gisoo-vscode';

interface PackageJson {
  contributes: {
    commands: Array<{ command: string }>;
    views: Record<string, Array<{ id: string }>>;
    configuration: { properties: Record<string, { scope?: string }> };
  };
}

function ext(): vscode.Extension<GisooExports> {
  const found = vscode.extensions.getExtension<GisooExports>(EXTENSION_ID);
  assert.ok(found, `extension ${EXTENSION_ID} is not installed in the test host`);
  return found;
}

async function api(): Promise<GisooExports> {
  const e = ext();
  return e.isActive ? e.exports : e.activate();
}

/** A raw GET with an explicit Host header (fetch() cannot override Host). */
function rawGet(url: string, hostHeader?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers: hostHeader === undefined ? {} : { Host: hostHeader } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

describe('Gisoo extension in a real VS Code', () => {
  let exportsApi: GisooExports;

  before(async () => {
    exportsApi = await api();
  });

  it('activates and returns its exports', () => {
    assert.equal(ext().isActive, true);
    assert.equal(typeof exportsApi.toolNames, 'function');
  });

  it('opens the fixture workspace in a trusted window', () => {
    assert.equal(vscode.workspace.workspaceFolders?.length, 1);
    assert.equal(vscode.workspace.isTrusted, true);
  });

  it('registers every command that package.json contributes', async () => {
    const pkg = ext().packageJSON as PackageJson;
    const wanted = pkg.contributes.commands.map((c) => c.command);
    assert.ok(wanted.length >= 18, 'expected the contributed command list');
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = wanted.filter((id) => !registered.has(id));
    assert.deepEqual(missing, []);
  });

  it('resolves the chat webview view and the gisoo.agents tree view', async () => {
    const pkg = ext().packageJSON as PackageJson;
    const ids = pkg.contributes.views.gisoo.map((v) => v.id);
    assert.deepEqual(ids, ['gisoo.chat', 'gisoo.agents']);
    await vscode.commands.executeCommand('gisoo.chat.focus');
    await vscode.commands.executeCommand('gisoo.agents.focus');
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !(exportsApi.views().chat && exportsApi.views().agents)) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(exportsApi.views(), { chat: true, agents: true });
  });

  it('stays signed out without throwing and runs the account commands safely', async () => {
    assert.equal(exportsApi.account().signedIn, false);
    // showAccount falls through to sign-in; stop and newChat must not throw either. The sign-in command
    // itself is not run: it would open the browser and contact the server.
    await vscode.commands.executeCommand('gisoo.stop');
    await vscode.commands.executeCommand('gisoo.newChat');
    await vscode.commands.executeCommand('gisoo.attachFile');
    await vscode.commands.executeCommand('gisoo.attachSelection');
    assert.equal(exportsApi.account().signedIn, false);
  });

  it('lists the expected tools in trusted mode', () => {
    const names = exportsApi.toolNames({ mode: 'ask', webFetchEnabled: false, workspaceTrusted: true });
    for (const expected of ['read_file', 'list_directory', 'find_files', 'search_text', 'get_diagnostics', 'write_file', 'edit_file', 'run_command', 'todo_write', 'ask_user', 'git', 'project_map', 'symbols', 'definition', 'references', 'preview', 'screenshot', 'memory', 'skill']) {
      assert.ok(names.includes(expected), `missing tool ${expected}; have ${names.join(', ')}`);
    }
    assert.ok(!names.includes('web_fetch'), 'web_fetch must be hidden while gisoo.webFetch.enabled is off');
    const withWeb = exportsApi.toolNames({ mode: 'ask', webFetchEnabled: true, workspaceTrusted: true });
    assert.ok(withWeb.includes('web_fetch'));
  });

  it('hides write tools in plan mode and the command tool in untrusted workspaces', () => {
    const plan = exportsApi.toolNames({ mode: 'plan', webFetchEnabled: false, workspaceTrusted: true });
    assert.ok(plan.includes('read_file') && plan.includes('todo_write'));
    assert.ok(!plan.includes('write_file') && !plan.includes('edit_file') && !plan.includes('run_command'));
    const untrusted = exportsApi.toolNames({ mode: 'ask', webFetchEnabled: false, workspaceTrusted: false });
    assert.ok(!untrusted.includes('run_command'));
  });

  describe('preview server', () => {
    let base = '';

    before(async () => {
      const url = await exportsApi.previewUrl('index.html');
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/index\.html$/);
      base = new URL(url).origin;
    });

    it('answers 200 for index.html on 127.0.0.1 and injects the reload client', async () => {
      const res = await rawGet(`${base}/index.html`);
      assert.equal(res.status, 200);
      assert.match(res.body, /Hello from the fixture/);
      assert.match(res.body, /__gisoo_reload/);
    });

    it('answers 403 for .env and for dotfile folders', async () => {
      assert.equal((await rawGet(`${base}/.env`)).status, 403);
      assert.equal((await rawGet(`${base}/.gisoo/agents/reviewer.md`)).status, 403);
    });

    it('refuses path traversal', async () => {
      const res = await rawGet(`${base}/..%2f..%2fpackage.json`);
      assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
    });

    it('answers 4xx for a wrong Host header', async () => {
      const res = await rawGet(`${base}/index.html`, 'evil.example.com');
      assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
    });
  });

  it('loads the Gisoo and Codex agent definitions from the workspace', async () => {
    const agents = await exportsApi.agents();
    const reviewer = agents.find((a) => a.name === 'reviewer');
    const helper = agents.find((a) => a.name === 'helper');
    assert.ok(reviewer, `agents: ${JSON.stringify(agents)}`);
    assert.equal(reviewer.source, 'gisoo');
    assert.equal(reviewer.scope, 'project');
    assert.ok(helper, `agents: ${JSON.stringify(agents)}`);
    assert.equal(helper.source, 'codex');
    assert.equal(helper.scope, 'project');
  });

  it('loads the demo skill from .agents/skills', async () => {
    const skills = await exportsApi.skillNames();
    assert.ok(skills.includes('demo'), `skills: ${skills.join(', ')}`);
  });

  describe('application-scoped settings ignore workspace values', () => {
    it('the test workspace really carries workspace values for them', () => {
      const fixture = process.env.GISOO_FIXTURE;
      assert.ok(fixture, 'GISOO_FIXTURE is set by test/runIntegration.mjs');
      const written = JSON.parse(fs.readFileSync(path.join(fixture, '.vscode', 'settings.json'), 'utf8')) as Record<string, unknown>;
      assert.equal(written['gisoo.permissionMode'], 'autoEdit');
      assert.equal(written['gisoo.maxCostPerTask'], 999);
      // The workspace root VS Code opened is that same folder.
      assert.equal(path.normalize(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '').toLowerCase(), path.normalize(fixture).toLowerCase());
    });

    it('permissionMode, baseUrl, region, maxCostPerTask, webFetch stay at the user-level defaults', () => {
      const s = getSettings();
      assert.equal(s.permissionMode, 'ask');
      assert.equal(s.baseUrl, '');
      assert.equal(s.region, 'global');
      assert.equal(s.maxCostPerTask, 0);
      assert.equal(s.webFetchEnabled, false);
      assert.equal(userSetting<number>('maxSteps'), 60);
      assert.deepEqual(userSetting<string[]>('allowedCommands'), []);
      assert.equal(userSetting<string>('customInstructions'), '');
    });

    it('the package.json declares these settings application-scoped', () => {
      const pkg = ext().packageJSON as PackageJson;
      const props = pkg.contributes.configuration.properties;
      for (const key of ['gisoo.region', 'gisoo.baseUrl', 'gisoo.permissionMode', 'gisoo.maxCostPerTask', 'gisoo.webFetch.enabled', 'gisoo.allowedCommands', 'gisoo.customInstructions', 'gisoo.maxSteps']) {
        assert.equal(props[key]?.scope, 'application', key);
      }
    });

    it('window-scoped settings such as gisoo.model still honour the workspace', () => {
      assert.equal(getSettings().model, 'fixture-model');
    });
  });
});
