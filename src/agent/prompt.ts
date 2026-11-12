/** System prompt builder (SPEC §5.3). Pure: the environment is passed in. */
import type { PermissionMode } from '../shared/protocol';

export interface PromptEnvironment {
  os: string;
  shell: string;
  workspaceFolders: string[];
  activeFile?: string;
  selection?: { startLine: number; endLine: number };
  gitBranch?: string;
  date: string;
  editorLanguage?: string;
}

export interface PromptOptions {
  env: PromptEnvironment;
  mode: PermissionMode;
  /** Contents of GISOO.md / AGENTS.md / CLAUDE.md / copilot-instructions (already capped). */
  projectInstructions?: { file: string; content: string };
  customInstructions?: string;
  /** Instruction files, memory and skills sections built by the ContextProvider (SPEC-phase2 §1, §2, §7). */
  contextSections?: string;
  webFetchEnabled: boolean;
}

export const PROJECT_INSTRUCTION_FILES = ['GISOO.md', 'AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md'] as const;
export const PROJECT_INSTRUCTIONS_MAX_CHARS = 20_000;

export function buildSystemPrompt(opts: PromptOptions): string {
  const { env } = opts;
  const sections: string[] = [];

  sections.push(
    [
      'You are Gisoo, an expert software engineer working inside VS Code with the user.',
      'Be concise: short answers, no filler, no restating the question. Use markdown; put code in fenced blocks with the language.',
      'Explore before editing: look at the relevant files and how the project is organised before changing anything.',
      'Always read a file before editing it. Never invent file contents, APIs or command output; if unsure, look.',
      'Prefer edit_file (exact string replacement) over rewriting whole files; use write_file only for new files or complete rewrites.',
      'Plan multi-step work with todo_write and keep it updated as you go (mark items in_progress and done).',
      'Run the project\'s tests, type checker or linter when they exist and the change warrants it. Report real results.',
      'Use ask_user when a decision is the user\'s to make; otherwise keep going.',
      'If a tool call is rejected by the user, do not repeat it; ask or adapt.',
      'Answer in the language the user writes in. Keep code, identifiers and commands in English.',
      'Paths are workspace-relative. Do not touch files outside the workspace.',
    ].join('\n'),
  );

  if (opts.mode === 'plan') {
    sections.push(
      [
        '## Plan mode',
        'Read-only tools only. Investigate the codebase, then write a step-by-step plan with todo_write (every item pending) and',
        'explain it briefly in your reply. Do not edit files or run commands; stop after presenting the plan.',
      ].join('\n'),
    );
  } else if (opts.mode === 'autoEdit') {
    sections.push('## Mode\nEdits are applied without asking; commands still need approval. Keep edits small and reviewable.');
  }

  const envLines = [
    '## Environment',
    `- OS: ${env.os}`,
    `- Shell: ${env.shell}`,
    `- Date: ${env.date}`,
    `- Workspace folders: ${env.workspaceFolders.length ? env.workspaceFolders.join(', ') : '(none open)'}`,
  ];
  if (env.gitBranch) envLines.push(`- Git branch: ${env.gitBranch}`);
  if (env.activeFile) {
    const sel = env.selection ? ` (selected lines ${env.selection.startLine}-${env.selection.endLine})` : '';
    envLines.push(`- Active file: ${env.activeFile}${sel}`);
  }
  if (!opts.webFetchEnabled) envLines.push('- web_fetch is disabled in settings; do not rely on it.');
  sections.push(envLines.join('\n'));

  if (opts.projectInstructions?.content.trim()) {
    const content = opts.projectInstructions.content.slice(0, PROJECT_INSTRUCTIONS_MAX_CHARS);
    sections.push(`## Project instructions (${opts.projectInstructions.file})\n${content}`);
  }
  if (opts.contextSections?.trim()) sections.push(opts.contextSections.trim());
  if (opts.customInstructions?.trim()) {
    sections.push(`## User instructions\n${opts.customInstructions.trim()}`);
  }
  return sections.join('\n\n');
}

/** Prompts behind the slash commands and editor commands. */
export const Prompts = {
  review: (diff: string): string =>
    `Review the following changes like a careful senior engineer. Point out bugs, risks, missing tests and style issues, ordered by severity, with file and line references. Be concrete and brief.\n\n\`\`\`diff\n${diff}\n\`\`\``,
  reviewNoDiff: 'Review the uncommitted changes in this workspace (run `git diff` and `git status` first). Report bugs, risks and missing tests, ordered by severity.',
  explain: 'Explain the selected code: what it does, how it fits the surrounding code, and anything surprising. Keep it short.',
  tests: (file: string): string =>
    `Write tests for ${file}. Look at how tests are organised in this project (framework, folder, naming) and follow it. Cover the main behaviour and the edge cases. Run the tests afterwards.`,
  fix: (file: string, line: number, message: string): string =>
    `Fix this problem in ${file} at line ${line}: ${message}\nRead the file, make the smallest correct change, and check the diagnostics again.`,
  init: [
    'Explore this workspace (structure, package manifests, build and test commands, conventions) and write a GISOO.md file at the workspace root.',
    'It should tell an AI coding agent how to work here: what the project is, how to build, test and lint, the code conventions, and anything surprising.',
    'Keep it under 150 lines, plain markdown, no emoji. If GISOO.md already exists, improve it instead of replacing it.',
  ].join(' '),
  planGo: 'Go ahead with the plan.',
} as const;
