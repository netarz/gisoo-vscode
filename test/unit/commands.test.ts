import * as assert from 'node:assert/strict';
import { commandInfos, expandCommand, findCommand, neutraliseShellLines, parseCustomCommand, splitArguments, substituteArguments, type CustomCommand } from '../../src/context/commands';

const meta = { path: '/p/.gisoo/commands/fix.md', scope: 'project' as const, source: 'gisoo' as const };

describe('custom command arguments', () => {
  it('replaces $ARGUMENTS with the whole string', () => {
    assert.equal(substituteArguments('Fix issue $ARGUMENTS now', '#12 quickly'), 'Fix issue #12 quickly now');
  });

  it('replaces $1..$9 with quoted-aware positionals', () => {
    assert.equal(substituteArguments('file=$1 msg=$2 none=$3', 'a.ts "two words"'), 'file=a.ts msg=two words none=');
    assert.equal(splitArguments(`one 'two three' "four"`).join('|'), 'one|two three|four');
  });

  it('does not touch $10 or $ARGUMENTSX and appends unused arguments', () => {
    assert.equal(substituteArguments('cost $10 and $ARGUMENTSX', ''), 'cost $10 and $ARGUMENTSX');
    assert.equal(substituteArguments('Review the code.', 'src/a.ts'), 'Review the code.\n\nArguments: src/a.ts');
  });

  it('never executes shell lines', () => {
    const out = neutraliseShellLines('Status:\n!`git status`\nDone');
    assert.doesNotMatch(out, /^!`/m);
    assert.match(out, /not executed by Gisoo: `git status`/);
  });
});

describe('custom command files', () => {
  it('parses frontmatter description and argument-hint', () => {
    const cmd = parseCustomCommand('---\ndescription: Fix an issue\nargument-hint: <number>\n---\nFix issue $ARGUMENTS.', { ...meta, name: 'fix' });
    assert.ok(cmd);
    assert.equal(cmd.description, 'Fix an issue');
    assert.equal(cmd.argumentHint, '<number>');
    assert.equal(expandCommand(cmd, '42'), 'Fix issue 42.');
    assert.deepEqual(commandInfos([cmd])[0], { name: 'fix', description: 'Fix an issue (<number>)', source: 'project' });
  });

  it('uses the first body line as description when there is no frontmatter', () => {
    const cmd = parseCustomCommand('# Title\nDo the thing.\n', { ...meta, name: 'thing' });
    assert.equal(cmd?.description, 'Do the thing.');
  });

  it('refuses reserved and invalid names', () => {
    assert.equal(parseCustomCommand('x', { ...meta, name: 'init' }), undefined);
    assert.equal(parseCustomCommand('x', { ...meta, name: 'memory' }), undefined);
    assert.equal(parseCustomCommand('x', { ...meta, name: 'bad name' }), undefined);
    assert.ok(parseCustomCommand('x', { ...meta, name: 'frontend:component' }));
  });

  it('finds commands case-insensitively', () => {
    const cmds: CustomCommand[] = [{ name: 'Deploy', description: '', body: 'go', path: '/x', scope: 'user', source: 'claude' }];
    assert.equal(findCommand(cmds, 'deploy')?.name, 'Deploy');
    assert.equal(findCommand(cmds, 'other'), undefined);
  });
});
