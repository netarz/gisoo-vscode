import { formatWithLineNumbers, readText, resolveReadPath } from './workspace';
import type { Tool } from './types';

interface Input {
  path: string;
  offset?: number;
  limit?: number;
}

export const MAX_LINES = 2000;

export const readFileTool: Tool<Input> = {
  name: 'read_file',
  description:
    'Read a text file from the workspace with line numbers. Returns at most 2000 lines; use offset (1-based line) and limit to read more of a long file.',
  permission: 'read',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path' },
      offset: { type: 'integer', minimum: 1, description: 'First line to read (1-based)' },
      limit: { type: 'integer', minimum: 1, description: 'Number of lines to read (max 2000)' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  title: (input) => {
    const range = input.offset || input.limit ? ` (lines ${input.offset ?? 1}-${(input.offset ?? 1) + Math.min(input.limit ?? MAX_LINES, MAX_LINES) - 1})` : '';
    return `Read ${input.path}${range}`;
  },
  async run(input) {
    const resolved = await resolveReadPath(input.path);
    const text = await readText(resolved.absolute);
    if (text === null) return { content: `File not found: ${resolved.relative}`, isError: true };
    const lines = text.split('\n');
    const start = Math.max(1, Math.floor(input.offset ?? 1));
    const limit = Math.min(MAX_LINES, Math.max(1, Math.floor(input.limit ?? MAX_LINES)));
    const slice = lines.slice(start - 1, start - 1 + limit);
    if (!slice.length) return { content: `${resolved.relative} has ${lines.length} lines; offset ${start} is past the end.`, isError: true };
    let body = formatWithLineNumbers(slice.join('\n'), start);
    const end = start - 1 + slice.length;
    if (end < lines.length) body += `\n\n[${lines.length - end} more lines; call again with offset ${end + 1}]`;
    return { content: body, display: `${slice.length} lines (${start}-${end} of ${lines.length})` };
  },
};
