import { applyStringEdit, EditError } from '../edits/textEdit';
import { unifiedDiff } from '../edits/unifiedDiff';
import { readText, resolvePath } from './workspace';
import { applyPrepared } from './writeFile';
import type { PreparedEdit, Tool } from './types';

interface Input {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export async function prepareEdit(input: Input): Promise<PreparedEdit> {
  const resolved = await resolvePath(input.path);
  const oldContent = await readText(resolved.absolute);
  if (oldContent === null) throw new EditError(`File not found: ${resolved.relative}. Use write_file to create it.`, 'not_found');
  const result = applyStringEdit(oldContent, String(input.old_string ?? ''), String(input.new_string ?? ''), input.replace_all === true);
  const { diff, stats } = unifiedDiff(oldContent, result.content, resolved.relative);
  return {
    absolutePath: resolved.absolute,
    relativePath: resolved.relative,
    oldContent,
    newContent: result.content,
    diff,
    added: stats.added,
    removed: stats.removed,
    isNewFile: false,
  };
}

export const editFileTool: Tool<Input> = {
  name: 'edit_file',
  description:
    'Replace an exact string in a file with a new string. old_string must appear exactly once (include enough context), unless replace_all is true. Read the file first.',
  permission: 'edit',
  readOnly: false,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path' },
      old_string: { type: 'string', description: 'Exact text to replace (whitespace matters)' },
      new_string: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' },
    },
    required: ['path', 'old_string', 'new_string'],
    additionalProperties: false,
  },
  title: (input) => `Edit ${input.path}`,
  prepare: (input) => prepareEdit(input),
  async run(input, ctx, prepared) {
    const edit = prepared ?? (await prepareEdit(input));
    await applyPrepared(edit, ctx);
    return {
      content: `Edited ${edit.relativePath} (+${edit.added} -${edit.removed} lines)`,
      view: { edit: { path: edit.relativePath, added: edit.added, removed: edit.removed, diff: edit.diff.slice(0, 20_000), isNewFile: false } },
    };
  },
};
