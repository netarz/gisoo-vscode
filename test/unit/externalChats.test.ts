import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cleanClaudeUserText, listClaudeSessions, readClaudeTranscript } from '../../src/sessions/external/claudeCode';
import { codexUserText, isInjectedCodexText, listCodexSessions, readCodexTranscript } from '../../src/sessions/external/codex';
import { ExternalChats, originKey, transcriptToSession } from '../../src/sessions/external';
import { normalizeDir, sameDir } from '../../src/sessions/external/lines';

const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'external');
const WORKSPACE = '/work/demo';
const CLAUDE_A = 'a1111111-1111-4111-8111-111111111111';
const CLAUDE_B = 'b2222222-2222-4222-8222-222222222222';
const CODEX_X = '0191aaaa-0000-7000-8000-000000000001';

describe('external chats', () => {
  let home: string;
  let claudeDir: string;
  let codexDir: string;

  before(() => {
    // Work on a copy so the file times can be set without touching the repository.
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gisoo-external-'));
    fs.cpSync(FIXTURES, home, { recursive: true });
    claudeDir = path.join(home, 'claude');
    codexDir = path.join(home, 'codex');
    const stamp = (file: string, iso: string) => fs.utimesSync(file, new Date(iso), new Date(iso));
    stamp(path.join(claudeDir, 'projects', '-work-demo', `${CLAUDE_A}.jsonl`), '2026-11-01T11:00:00Z');
    stamp(path.join(claudeDir, 'projects', '-work-demo', `${CLAUDE_B}.jsonl`), '2026-11-02T11:00:00Z');
  });

  after(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  describe('folder matching', () => {
    it('compares folders ignoring slash style, trailing slash and (off Linux) case', () => {
      assert.equal(normalizeDir('C:\\Work\\Demo\\', 'win32'), 'c:/work/demo');
      assert.equal(sameDir('C:\\Work\\Demo', 'c:/work/demo/', 'win32'), true);
      assert.equal(sameDir('/work/demo', '/work/other', 'linux'), false);
      assert.equal(sameDir('/Work/Demo', '/work/demo', 'linux'), false);
      assert.equal(sameDir('/Work/Demo', '/work/demo', 'darwin'), true);
    });
  });

  describe('Claude Code reader', () => {
    it('strips reminders and tooling wrappers from user text', () => {
      assert.equal(cleanClaudeUserText('<system-reminder>x</system-reminder>\nhello'), 'hello');
      assert.equal(cleanClaudeUserText('<command-name>/init</command-name>'), '');
      assert.equal(cleanClaudeUserText('[Request interrupted by user]'), '');
    });

    it('lists only chats of the same folder, newest first, with the best title', async () => {
      const items = await listClaudeSessions(claudeDir, WORKSPACE);
      assert.deepEqual(items.map((i) => i.id), [CLAUDE_B, CLAUDE_A]);
      assert.equal(items[0].title, 'Dark mode toggle added');
      assert.equal(items[1].title, 'Fix the login bug');
      assert.ok(items.every((i) => i.source === 'claude-code'));
      assert.ok(items[0].updatedAt > items[1].updatedAt);
    });

    it('falls back to the first real prompt when there is no title line', async () => {
      const file = path.join(claudeDir, 'projects', '-work-demo', `${CLAUDE_B}.jsonl`);
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l && !l.includes('"summary"'));
      const bare = path.join(home, 'bare');
      fs.mkdirSync(path.join(bare, 'projects', '-work-demo'), { recursive: true });
      fs.writeFileSync(path.join(bare, 'projects', '-work-demo', 'e5555555.jsonl'), lines.join('\n') + '\n');
      const [item] = await listClaudeSessions(bare, WORKSPACE);
      assert.equal(item.title, 'Add a dark mode toggle');
    });

    it('returns nothing for a folder without chats', async () => {
      assert.deepEqual(await listClaudeSessions(claudeDir, '/work/none'), []);
      assert.deepEqual(await listClaudeSessions(path.join(home, 'missing'), WORKSPACE), []);
    });

    it('reads turns, skipping sidechain, meta, thinking and bad lines', async () => {
      const t = await readClaudeTranscript(path.join(claudeDir, 'projects', '-work-demo', `${CLAUDE_A}.jsonl`));
      assert.equal(t.title, 'Fix the login bug');
      assert.deepEqual(t.turns.map((x) => x.role), ['user', 'assistant']);
      assert.equal(t.turns[0].text, 'Please fix the login bug');
      const reply = t.turns[1].text;
      assert.match(reply, /Let me look at the auth file\./);
      assert.match(reply, /\[used tool Read: src\/auth\.ts\]/);
      assert.match(reply, /\[tool result\]\nexport function login/);
      assert.match(reply, /Fixed: the token/);
      assert.doesNotMatch(reply, /secret thoughts/);
      const all = t.turns.map((x) => x.text).join('\n');
      assert.doesNotMatch(all, /sidechain|meta text|house rules/);
      assert.equal(t.turns[0].at, Date.parse('2026-11-01T10:00:00.000Z'));
    });
  });

  describe('Codex reader', () => {
    it('recognises text Codex injected itself', () => {
      assert.equal(isInjectedCodexText('# AGENTS.md instructions for /x\n\n<INSTRUCTIONS>a</INSTRUCTIONS>'), true);
      assert.equal(isInjectedCodexText('<environment_context><cwd>/x</cwd></environment_context>'), true);
      assert.equal(isInjectedCodexText('Rename the config loader'), false);
      assert.equal(codexUserText([{ type: 'input_text', text: '<environment_context>x</environment_context>' }]), '');
      assert.equal(codexUserText([{ type: 'input_text', text: 'hi' }, { type: 'input_image' }]), 'hi\n[1 image attached]');
    });

    it('lists chats of the folder, using the index name, and skips sub-agents and empty chats', async () => {
      const items = await listCodexSessions(codexDir, WORKSPACE);
      assert.deepEqual(items.map((i) => i.id), [CODEX_X]);
      assert.equal(items[0].source, 'codex');
      assert.equal(items[0].title, 'Rename the loader');
      assert.equal(items[0].messageCount, 2);
    });

    it('reads the real conversation without injected text or reasoning', async () => {
      const [item] = await listCodexSessions(codexDir, WORKSPACE);
      const t = await readCodexTranscript(item.filePath, 'Rename the loader');
      assert.deepEqual(t.turns.map((x) => x.role), ['user', 'assistant']);
      assert.equal(t.turns[0].text, 'Rename the config loader');
      assert.match(t.turns[1].text, /I will rename it now\./);
      assert.match(t.turns[1].text, /\[used tool shell: git mv a\.ts b\.ts\]/);
      assert.match(t.turns[1].text, /\[tool result\]\nrenamed/);
      assert.match(t.turns[1].text, /Renamed to b\.ts\./);
      assert.doesNotMatch(t.turns.map((x) => x.text).join('\n'), /AGENTS|environment_context|Always be brief/);
    });
  });

  describe('ExternalChats', () => {
    it('lists both sources newest first and reads only listed ids', async () => {
      const chats = new ExternalChats({ home, platform: 'linux', env: { CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir, XDG_CONFIG_HOME: path.join(home, 'no-config'), GEMINI_CLI_HOME: path.join(home, 'no-gemini') } });
      assert.equal(await chats.read('codex', CODEX_X), undefined);
      const items = await chats.list([WORKSPACE]);
      assert.equal(items.length, 3);
      for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].updatedAt >= items[i].updatedAt);
      assert.deepEqual(new Set(items.map((i) => i.source)), new Set(['claude-code', 'codex']));
      const t = await chats.read('claude-code', CLAUDE_A);
      assert.equal(t?.turns.length, 2);
    });
  });

  describe('transcriptToSession', () => {
    it('builds a Gisoo session with history, origin and a closing notice', async () => {
      const t = await readClaudeTranscript(path.join(claudeDir, 'projects', '-work-demo', `${CLAUDE_A}.jsonl`));
      const session = transcriptToSession(t, 'gisoo-model', 'ask', 'Continue here.');
      assert.equal(session.origin, originKey('claude-code', CLAUDE_A));
      assert.equal(session.origin, `claude-code:${CLAUDE_A}`);
      assert.equal(session.title, 'Fix the login bug · Claude Code');
      assert.equal(session.turns.length, 2);
      assert.deepEqual(session.messages.map((m) => m.role), ['user', 'assistant']);
      assert.match(String(session.messages[0].content), /imported into Gisoo[\s\S]*Please fix the login bug/);
      const last = session.turns[session.turns.length - 1];
      assert.equal(last.role, 'assistant');
      if (last.role === 'assistant') {
        assert.deepEqual(last.parts[last.parts.length - 1], { kind: 'notice', level: 'info', text: 'Continue here.' });
      }
    });

    it('adds a trailing assistant turn for the notice when the chat ends with the user', () => {
      const session = transcriptToSession(
        { source: 'codex', id: 'x', title: 'Only a question', turns: [{ role: 'user', text: 'Hello?' }], omitted: 4, skippedLines: 0 },
        'm',
        'ask',
        'Note.',
      );
      assert.equal(session.turns.length, 2);
      assert.equal(session.turns[1].role, 'assistant');
      assert.match(String(session.messages[0].content), /4 earlier messages/);
    });
  });
});
