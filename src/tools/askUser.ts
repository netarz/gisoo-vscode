import type { Tool } from './types';

interface Input {
  question: string;
  options?: string[];
}

export const askUserTool: Tool<Input> = {
  name: 'ask_user',
  description:
    'Ask the user a question and wait for the answer. Use it for decisions that are theirs to make (which approach, which file, confirm a risky step). Optional options become buttons.',
  permission: 'none',
  readOnly: false,
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    },
    required: ['question'],
    additionalProperties: false,
  },
  title: (input) => `Question: ${(input.question ?? '').slice(0, 100)}`,
  async run(input, ctx) {
    const question = (input.question ?? '').trim();
    if (!question) return { content: 'question is required', isError: true };
    const options = Array.isArray(input.options) ? input.options.filter((o) => typeof o === 'string' && o.trim()).slice(0, 6) : undefined;
    const answer = await ctx.askUser(question, options);
    return { content: `User answered: ${answer}`, display: answer, view: { question: { text: question, options, answer } } };
  },
};
