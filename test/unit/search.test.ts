import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { compact, fold, matchRanges, matchesWords, queryWords, snippet } from '../../src/shared/search';
import { SessionStore, searchText } from '../../src/sessions/store';
import { createSession, type SessionData } from '../../src/agent/session';

describe('search folding', () => {
  it('treats Arabic and Persian letters, digits, case and the half-space alike', () => {
    assert.equal(fold('كيف'), fold('کیف'));
    assert.equal(fold('۱۲۳ ٤٥'), '123 45');
    assert.equal(fold('GPT-4o'), 'gpt-4o');
    assert.equal(fold('می‌خواهم'), fold('میخواهم'));
    assert.equal(fold('سَلام'), 'سلام');
  });

  it('drops separators in compact form', () => {
    assert.equal(compact('gpt-4o mini'), 'gpt4omini');
    assert.ok(matchesWords(fold('openai/gpt-4o'), queryWords('gpt4o'), compact('openai/gpt-4o')));
    assert.ok(!matchesWords(fold('openai/gpt-4o'), queryWords('gpt4o')));
  });

  it('needs every word', () => {
    assert.ok(matchesWords(fold('fix the login bug'), queryWords('LOGIN fix')));
    assert.ok(!matchesWords(fold('fix the login bug'), queryWords('login crash')));
    assert.deepEqual(queryWords('   '), []);
  });

  it('maps matches back to the original text', () => {
    const text = 'Hello مي‌خواهم World';
    const ranges = matchRanges(text, queryWords('میخواهم'));
    assert.equal(ranges.length, 1);
    assert.equal(text.slice(ranges[0][0], ranges[0][1]), 'مي‌خواهم');
    assert.deepEqual(matchRanges('aXa', ['a']), [[0, 1], [2, 3]]);
  });

  it('cuts a one-line snippet around the first match', () => {
    const long = `${'lorem ipsum '.repeat(30)}the needle is here\nand more ${'dolor sit '.repeat(30)}`;
    const piece = snippet(long, ['needle']);
    assert.ok(piece.startsWith('… '));
    assert.ok(piece.endsWith(' …'));
    assert.ok(piece.includes('the needle is here and more'));
    assert.ok(!piece.includes('\n'));
    assert.equal(snippet('nothing', ['needle']), '');
  });
});

describe('session search', () => {
  let dir: string;
  let store: SessionStore;

  function chat(title: string, user: string, answer: string, updatedAt: number): SessionData {
    const data = createSession('auto', 'ask');
    data.title = title;
    data.updatedAt = updatedAt;
    data.turns = [
      { role: 'user', id: 'u1', text: user, attachments: [], createdAt: updatedAt },
      { role: 'assistant', id: 'a1', model: 'auto', parts: [{ kind: 'text', text: answer }], streaming: false, hasCheckpoint: false, createdAt: updatedAt },
    ] as SessionData['turns'];
    return data;
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gisoo-search-'));
    store = new SessionStore(dir);
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('finds chats by what was written in them, newest first, with a snippet', async () => {
    const older = chat('Refactor', 'please refactor the payment module', 'Done, the PaymentService is split.', 1000);
    const newer = chat('Bug', 'login fails with كد ۴۰۴', 'The payment callback route was missing.', 2000);
    await store.save(older);
    await store.save(newer);

    const hits = await store.search('payment');
    assert.deepEqual(hits.map((hit) => hit.id), [newer.id, older.id]);
    assert.ok(hits[0].snippet.toLowerCase().includes('payment'));

    assert.deepEqual((await store.search('کد 404')).map((hit) => hit.id), [newer.id]);
    assert.deepEqual(await store.search('nothing-like-this'), []);
    assert.deepEqual(await store.search('  '), []);
  });

  it('sees a changed or deleted chat on the next search', async () => {
    const data = chat('Notes', 'first text', 'ok', 1000);
    await store.save(data);
    assert.equal((await store.search('second')).length, 0);

    data.turns.push({ role: 'user', id: 'u2', text: 'second text', attachments: [], createdAt: 1100 } as SessionData['turns'][number]);
    await store.save(data);
    assert.equal((await store.search('second')).length, 1);

    await store.delete(data.id);
    assert.equal((await store.search('first')).length, 0);
    assert.equal((await store.list()).length, 0);
  });

  it('keeps the search text to the title and the conversation', () => {
    const data = chat('Title here', 'question', 'answer', 1);
    assert.equal(searchText(data), 'Title here\nquestion\nanswer');
  });
});
