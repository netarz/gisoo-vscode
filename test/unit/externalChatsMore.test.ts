import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listClineSessions, clineTaskRoots, readClineCwd, readClineTranscript } from '../../src/sessions/external/cline';
import { listCopilotSessions, readCopilotTranscript } from '../../src/sessions/external/copilot';
import { geminiHome, geminiProjectHashes, listGeminiSessions, readGeminiTranscript, sha256 } from '../../src/sessions/external/gemini';
import { appDataRoot, fileUriToPath, userDataDirs } from '../../src/sessions/external/vscodeData';
import { ExternalChats, SOURCE_LABELS, transcriptToSession } from '../../src/sessions/external';
import { EXTERNAL_SOURCES } from '../../src/shared/protocol';

const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'external');
const WORKSPACE = '/work/demo';

describe('external chats from more tools', () => {
  let home: string;
  let userDir: string;
  let geminiDir: string;

  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gisoo-external-more-'));
    fs.cpSync(FIXTURES, home, { recursive: true });
    userDir = path.join(home, 'config', 'Code', 'User');
    geminiDir = path.join(home, 'gemini', '.gemini');
  });

  after(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  describe('source list', () => {
    it('is data driven: every source has a name and a codicon, in the documented order', () => {
      assert.deepEqual(EXTERNAL_SOURCES.map((s) => s.id), ['claude-code', 'codex', 'copilot', 'gemini-cli', 'cline', 'roo-code', 'kilo-code']);
      for (const s of EXTERNAL_SOURCES) {
        assert.ok(s.name && s.icon);
        assert.equal(SOURCE_LABELS[s.id], s.name);
      }
    });
  });

  describe('VS Code user data', () => {
    it('finds the user data folder per platform', () => {
      assert.equal(appDataRoot('/h', { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32'), 'C:\\Users\\u\\AppData\\Roaming');
      assert.equal(appDataRoot('/h', {}, 'darwin'), path.join('/h', 'Library', 'Application Support'));
      assert.equal(appDataRoot('/h', {}, 'linux'), path.join('/h', '.config'));
      assert.deepEqual(userDataDirs('/h', { XDG_CONFIG_HOME: '/x' }, 'linux', ['Code']), [path.join('/x', 'Code', 'User')]);
    });

    it('turns folder URIs into paths and ignores remote ones', () => {
      assert.equal(fileUriToPath('file:///c%3A/Projects/my%20app'), 'c:/Projects/my app');
      assert.equal(fileUriToPath('file:///home/u/app'), '/home/u/app');
      assert.equal(fileUriToPath('vscode-remote://ssh-remote%2Bhost/www/x'), undefined);
    });
  });

  describe('Copilot reader', () => {
    it('lists only chats of this folder: the remote window and other folders are ignored', async () => {
      const items = await listCopilotSessions([userDir], WORKSPACE);
      assert.deepEqual(items.map((i) => i.id).sort(), ['11111111-aaaa-4aaa-8aaa-111111111111', '22222222-bbbb-4bbb-8bbb-222222222222']);
      assert.ok(items.every((i) => i.source === 'copilot'));
      assert.deepEqual(await listCopilotSessions([userDir], '/work/none'), []);
      assert.deepEqual(await listCopilotSessions([path.join(home, 'missing')], WORKSPACE), []);
    });

    it('takes the title from the custom title, else from the first prompt, and counts turns', async () => {
      const items = await listCopilotSessions([userDir], WORKSPACE);
      const log = items.find((i) => i.id.startsWith('1111'));
      const plain = items.find((i) => i.id.startsWith('2222'));
      assert.equal(log?.title, 'Upload retry');
      assert.equal(log?.messageCount, 4);
      assert.equal(plain?.title, 'Explain the build script');
    });

    it('replays the patch log into turns, skipping thinking, tool calls and the injected prompt', async () => {
      const file = path.join(userDir, 'workspaceStorage', 'aaa111', 'chatSessions', '11111111-aaaa-4aaa-8aaa-111111111111.jsonl');
      const t = await readCopilotTranscript(file);
      assert.deepEqual(t.turns.map((x) => x.role), ['user', 'assistant', 'user', 'assistant']);
      assert.equal(t.turns[0].text, 'Add a retry to the upload helper');
      assert.equal(t.turns[1].text, 'I will wrap the call in \n\na loop that retries three times, in `upload.ts`');
      assert.equal(t.turns[1].at, 1786278260000);
      assert.equal(t.turns[3].text, 'Done, see `upload.test.ts`.');
      const all = t.turns.map((x) => x.text).join('\n');
      assert.doesNotMatch(all, /secret reasoning|injected reminder|Reading file/);
    });

    it('reads the older single-document format', async () => {
      const file = path.join(userDir, 'workspaceStorage', 'aaa111', 'chatSessions', '22222222-bbbb-4bbb-8bbb-222222222222.json');
      const t = await readCopilotTranscript(file);
      assert.deepEqual(t.turns.map((x) => x.text), ['Explain the build script', 'It runs esbuild.']);
    });

    it('survives a broken file and a chat without messages', async () => {
      const dir = path.join(userDir, 'workspaceStorage', 'aaa111', 'chatSessions');
      const broken = await readCopilotTranscript(path.join(dir, '33333333-cccc-4ccc-8ccc-333333333333.json'));
      assert.equal(broken.turns.length, 0);
      const items = await listCopilotSessions([userDir], WORKSPACE);
      assert.ok(!items.some((i) => i.id.startsWith('3333') || i.id.startsWith('4444')));
    });
  });

  describe('Gemini CLI reader', () => {
    it('finds the project folder by the SHA-256 of the root and by the short name of newer versions', async () => {
      assert.ok(geminiProjectHashes('c:\\Work\\Demo\\').has(sha256('c:\\Work\\Demo')));
      assert.ok(geminiProjectHashes('c:\\Work\\Demo').has(sha256('c:/Work/Demo')));
      assert.equal(geminiHome('/h', { GEMINI_CLI_HOME: '/g' }), path.join('/g', '.gemini'));
      const items = await listGeminiSessions(geminiDir, WORKSPACE);
      assert.deepEqual(items.map((i) => i.id).sort(), ['session-2026-11-05T09-00-aaaa1111', 'session-2026-11-06T09-00-bbbb2222', 'session-2026-11-07T09-00-dddd4444']);
      assert.ok(items.every((i) => i.source === 'gemini-cli'));
      assert.deepEqual(await listGeminiSessions(geminiDir, '/work/none'), []);
    });

    it('titles a chat from its summary, else from the first prompt', async () => {
      const items = await listGeminiSessions(geminiDir, WORKSPACE);
      assert.equal(items.find((i) => i.id.endsWith('bbbb2222'))?.title, 'Licence question');
      assert.equal(items.find((i) => i.id.endsWith('aaaa1111'))?.title, 'Summarise the README @README.md');
      assert.equal(items.find((i) => i.id.endsWith('aaaa1111'))?.messageCount, 4);
    });

    it('keeps only user and model text, without thoughts, tool calls, info lines or referenced file bodies', async () => {
      const [item] = (await listGeminiSessions(geminiDir, WORKSPACE)).filter((i) => i.id.endsWith('aaaa1111'));
      const t = await readGeminiTranscript(item.filePath);
      assert.deepEqual(t.turns.map((x) => x.role), ['user', 'assistant', 'user', 'assistant']);
      assert.equal(t.turns[0].text, 'Summarise the README @README.md');
      assert.equal(t.turns[2].text, 'Thanks, and the licence?');
      assert.equal(t.turns[0].at, Date.parse('2026-11-05T09:00:01.000Z'));
      assert.doesNotMatch(t.turns.map((x) => x.text).join('\n'), /secret file body|hidden|cancelled|read_file/);
    });

    it('ignores a broken file and a chat with no user message', async () => {
      const items = await listGeminiSessions(geminiDir, WORKSPACE);
      assert.ok(!items.some((i) => i.id.includes('broken') || i.id.includes('empty')));
    });
  });

  describe('Cline, Roo Code and Kilo Code reader', () => {
    const roots = (source: 'cline' | 'roo-code' | 'kilo-code') => clineTaskRoots([userDir], source);

    it('reads the working directory from the environment block, and nothing else', async () => {
      const dir = path.join(userDir, 'globalStorage', 'saoudrizwan.claude-dev', 'tasks');
      assert.equal(await readClineCwd(path.join(dir, '1786300000000')), '/work/demo');
      assert.equal(await readClineCwd(path.join(dir, '1786200000000')), '/work/other');
      assert.equal(await readClineCwd(path.join(dir, '1785900000000')), undefined);
      assert.equal(await readClineCwd(path.join(dir, 'nope')), undefined);
    });

    it('lists only tasks of this folder; tasks without a known folder, a panel log or valid JSON are skipped', async () => {
      const items = await listClineSessions(roots('cline'), WORKSPACE, 'cline');
      assert.deepEqual(items.map((i) => i.id), ['1786300000000']);
      assert.equal(items[0].source, 'cline');
      assert.equal(items[0].title, 'Fix the flaky test');
      assert.deepEqual(await listClineSessions(roots('cline'), '/work/none', 'cline'), []);
    });

    it('reads Roo Code and Kilo Code from their own extension folders', async () => {
      const roo = await listClineSessions(roots('roo-code'), WORKSPACE, 'roo-code');
      const kilo = await listClineSessions(roots('kilo-code'), WORKSPACE, 'kilo-code');
      assert.deepEqual(roo.map((i) => [i.source, i.title]), [['roo-code', 'Roo task: add dark mode']]);
      assert.deepEqual(kilo.map((i) => [i.source, i.title]), [['kilo-code', 'Kilo task: rename the module']]);
    });

    it('keeps the conversation text only: no API logs, reasoning, tool asks, command output or partial messages', async () => {
      const [item] = await listClineSessions(roots('cline'), WORKSPACE, 'cline');
      const t = await readClineTranscript(item.filePath, 'cline');
      assert.deepEqual(t.turns.map((x) => x.role), ['user', 'assistant', 'user', 'assistant']);
      assert.equal(t.turns[0].text, 'Fix the flaky test');
      assert.equal(t.turns[1].text, 'I will read the file first.\n\nWhich file should I change?');
      assert.equal(t.turns[2].text, 'The one in src.');
      assert.equal(t.turns[3].text, 'Changed src/a.ts.');
      assert.equal(t.turns[0].at, 1786300000000);
      assert.doesNotMatch(t.turns.map((x) => x.text).join('\n'), /secret request|private reasoning|readFile|ls output|partial streaming|thinking/);
    });
  });

  describe('ExternalChats with every tool', () => {
    it('lists all new sources for the folder and reads each listed chat', async () => {
      const chats = new ExternalChats({
        home,
        platform: 'linux',
        env: { XDG_CONFIG_HOME: path.join(home, 'config'), GEMINI_CLI_HOME: path.join(home, 'gemini'), CLAUDE_CONFIG_DIR: path.join(home, 'none'), CODEX_HOME: path.join(home, 'none') },
      });
      const items = await chats.list([WORKSPACE]);
      const counts: Record<string, number> = {};
      for (const i of items) counts[i.source] = (counts[i.source] ?? 0) + 1;
      assert.deepEqual(counts, { copilot: 2, 'gemini-cli': 3, cline: 1, 'roo-code': 1, 'kilo-code': 1 });
      for (const item of items) {
        const t = await chats.read(item.source, item.id);
        assert.ok(t && t.turns.length >= 2, `${item.source}:${item.id} should read`);
        assert.equal(t.source, item.source);
      }
      // another folder asked afterwards must not be answered from the first folder's cache
      assert.deepEqual(await chats.list(['/work/none']), []);
      assert.equal((await chats.list(['/work/other'])).filter((i) => i.source === 'cline').length, 1);
    });

    it('turns an imported chat into a Gisoo session labelled with its tool', async () => {
      const chats = new ExternalChats({
        home,
        platform: 'linux',
        env: { XDG_CONFIG_HOME: path.join(home, 'config'), GEMINI_CLI_HOME: path.join(home, 'none'), CLAUDE_CONFIG_DIR: path.join(home, 'none'), CODEX_HOME: path.join(home, 'none') },
      });
      const [item] = (await chats.list([WORKSPACE])).filter((i) => i.source === 'roo-code');
      const t = await chats.read('roo-code', item.id);
      assert.ok(t);
      const session = transcriptToSession(t, 'm', 'ask', 'Continue.');
      assert.equal(session.origin, `roo-code:${item.id}`);
      assert.equal(session.title, 'Roo task: add dark mode · Roo Code');
      assert.match(String(session.messages[0].content), /started in Roo Code/);
    });
  });
});
