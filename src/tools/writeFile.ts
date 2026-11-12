import { unifiedDiff } from '../edits/unifiedDiff';
import { readText, resolvePath, writeText } from './workspace';
import type { PreparedEdit, Tool, ToolContext } from './types';

interface Input {
  path: string;
  content: string;
}

export async function prepareWrite(input: Input): Promise<PreparedEdit> {
  const resolved = await resolvePath(input.path);
  const content = typeof input.content === 'string' ? input.content : '';
  const oldContent = await readText(resolved.absolute);
  const { diff, stats } = unifiedDiff(oldContent ?? '', content, resolved.relative);
  return {
    absolutePath: resolved.absolute,
    relativePath: resolved.relative,
    oldContent,
    newContent: content,
    diff,
    added: stats.added,
    removed: stats.removed,
    isNewFile: oldContent === null,
  };
}

export async function applyPrepared(prepared: PreparedEdit, ctx: ToolContext): Promise<void> {
  ctx.checkpoint(prepared.absolutePath, prepared.oldContent);
  await writeText(prepared.absolutePath, prepared.newContent, prepared.isNewFile);
}

export const writeFileTool: Tool<Input> = {
  name: 'write_file',
  description: 'Create a new file or overwrite an existing one with the full content. For small changes to an existing file use edit_file instead.',
  permission: 'edit',
  readOnly: false,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path' },
      content: { type: 'string', description: 'The complete file content' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  title: (input) => `Write ${input.path}`,
  prepare: (input) => prepareWrite(input),
  async run(input, ctx, prepared) {
    const edit = prepared ?? (await prepareWrite(input));
    await applyPrepared(edit, ctx);
    const verb = edit.isNewFile ? 'Created' : 'Wrote';
    return {
      content: `${verb} ${edit.relativePath} (+${edit.added} -${edit.removed} lines)`,
      view: { edit: { path: edit.relativePath, added: edit.added, removed: edit.removed, diff: edit.diff.slice(0, 20_000), isNewFile: edit.isNewFile } },
    };
  },
};
