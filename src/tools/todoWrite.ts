import type { Todo } from '../shared/protocol';
import type { Tool } from './types';

interface Input {
  todos: Todo[];
}

const STATUSES = new Set(['pending', 'in_progress', 'done']);

export const todoWriteTool: Tool<Input> = {
  name: 'todo_write',
  description:
    'Replace the visible task list (your plan) for this run. Call it when you start multi-step work and again whenever an item changes status. Keep items short and concrete.',
  permission: 'none',
  readOnly: false,
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
          },
          required: ['content', 'status'],
          additionalProperties: false,
        },
      },
    },
    required: ['todos'],
    additionalProperties: false,
  },
  title: (input) => {
    const todos = Array.isArray(input.todos) ? input.todos : [];
    const done = todos.filter((t) => t.status === 'done').length;
    return `Plan: ${done}/${todos.length} done`;
  },
  async run(input, ctx) {
    const todos = (Array.isArray(input.todos) ? input.todos : [])
      .filter((t) => t && typeof t.content === 'string' && t.content.trim())
      .map((t) => ({ content: t.content.trim(), status: STATUSES.has(t.status) ? t.status : 'pending' }));
    ctx.setTodos(todos);
    const text = todos.map((t) => `[${t.status === 'done' ? 'x' : t.status === 'in_progress' ? '>' : ' '}] ${t.content}`).join('\n');
    return { content: `Plan updated (${todos.length} items).`, display: text };
  },
};
