/**
 * Canonical UI string keys with their English defaults.
 *
 * The host sends localised values in `InitState.strings` keyed by these same ids; anything the
 * host does not provide falls back to the English text here. Keys are dotted lowercase and stable:
 * the Persian bundle on the host side is written against this list.
 */
export const en = {
  // Header
  'header.title.untitled': 'New chat',
  'header.history': 'Chat history',
  'header.newChat': 'New chat',
  'header.model': 'Model',
  'header.balance': 'Credit balance',
  'header.signIn': 'Sign in',

  // Sessions overlay
  'sessions.title': 'Chats',
  'sessions.empty': 'No saved chats yet.',
  'sessions.new': 'New chat',
  'sessions.open': 'Open chat',
  'sessions.delete': 'Delete chat',
  'sessions.deleteConfirm': 'Delete?',
  'sessions.turns': '{n} messages',
  'sessions.justNow': 'just now',
  'sessions.minutesAgo': '{n} min ago',
  'sessions.hoursAgo': '{n} h ago',
  'sessions.daysAgo': '{n} d ago',

  // Model picker
  'models.title': 'Choose a model',
  'models.search': 'Search models',
  'models.recommended': 'Recommended',
  'models.all': 'All models',
  'models.empty': 'No model matches.',
  'models.refresh': 'Refresh the list',
  'models.context': 'Context',
  'models.price': 'per 1M tokens in / out',
  'models.vision': 'Vision',
  'models.reasoning': 'Reasoning',
  'models.free': 'Free',
  'models.current': 'Current model',

  // Account panel
  'account.title': 'Account',
  'account.project': 'Project',
  'account.key': 'API key',
  'account.spent': 'Spent',
  'account.limit': 'Limit',
  'account.noLimit': 'No limit',
  'account.balance': 'Balance',
  'account.refresh': 'Refresh',
  'account.addCredit': 'Add credit',
  'account.manageKeys': 'Manage keys',
  'account.signOut': 'Sign out',
  'account.signOutNote': 'Signing out removes the key from this editor; it stays valid on gisoo.pro.',
  'account.version': 'Gisoo for VS Code {version}',
  'account.error': 'Could not reach Gisoo: {error}',
  'account.region.global': 'Global endpoint',
  'account.region.iran': 'Gisoo Iran endpoint',

  // Sign-in card
  'signin.title': 'Sign in to Gisoo',
  'signin.value': 'An agent that reads your code, edits with diffs you approve, and runs commands.',
  'signin.gisoo': 'Sign in with Gisoo',
  'signin.apiKey': 'Use an API key',
  'signin.code': 'Enter sign-in code',
  'signin.docs': 'Documentation',

  // Empty state
  'empty.title': 'What should we build?',
  'empty.hint': 'Type @ to attach a file, / for commands. Enter sends, Shift+Enter adds a line.',
  'empty.starter.explain': 'Explain this project',
  'empty.starter.bug': 'Find and fix a bug',
  'empty.starter.tests': 'Write tests for the open file',
  'empty.starter.review': 'Review my changes',
  'empty.starter.explain.prompt': 'Explain how this project is structured and what its main parts do.',
  'empty.starter.bug.prompt': 'Look for a likely bug in this project, explain it, and fix it.',
  'empty.starter.tests.prompt': 'Write tests for the file that is open in the editor.',
  'empty.starter.review.prompt': 'Review my uncommitted changes and point out problems.',

  // Messages
  'turn.user': 'You',
  'turn.assistant': 'Gisoo',
  'turn.injected': 'added while working',
  'turn.stopped': 'Stopped',
  'turn.summary': 'Conversation summary',
  'turn.thinking': 'Thinking',
  'turn.thinkingLive': 'Thinking…',
  'turn.restore': 'Restore files',
  'turn.restoreTitle': 'Restore files to before this turn',
  'turn.restoreConfirm': 'Restore the files this turn changed?',
  'turn.restoreYes': 'Restore',
  'turn.cancel': 'Cancel',
  'turn.tokens': '{in} in / {out} out',
  'turn.tokensTitle': 'Tokens: {in} prompt ({cached} cached), {out} completion',
  'turn.cost': '≈ {cost}',
  'turn.costTitle': 'Estimated cost of this turn',
  'turn.duration': '{s}',
  'turn.copy': 'Copy message',
  'turn.working': 'Working…',

  // Code blocks
  'code.copy': 'Copy',
  'code.copied': 'Copied',
  'code.insert': 'Insert at cursor',
  'code.newFile': 'New file',

  // Tool cards
  'tool.status.pending': 'Pending',
  'tool.status.awaiting': 'Needs your approval',
  'tool.status.running': 'Running',
  'tool.status.done': 'Done',
  'tool.status.error': 'Failed',
  'tool.status.rejected': 'Rejected',
  'tool.status.cancelled': 'Cancelled',
  'tool.input': 'Input',
  'tool.output': 'Output',
  'tool.expand': 'Show details',
  'tool.collapse': 'Hide details',
  'tool.accept': 'Accept',
  'tool.reject': 'Reject',
  'tool.rejectNote': 'Tell Gisoo why (optional)',
  'tool.rejectSend': 'Reject',
  'tool.openDiff': 'Open diff',
  'tool.openFile': 'Open file',
  'tool.newFile': 'new file',
  'tool.added': '{n} added',
  'tool.removed': '{n} removed',
  'tool.run': 'Run',
  'tool.alwaysAllow': 'Always allow "{word}"',
  'tool.exitCode': 'exit {code}',
  'tool.cwd': 'in {cwd}',
  'tool.diffMore': 'Show {n} more lines',
  'tool.diffLess': 'Show less',
  'tool.answerPlaceholder': 'Your answer',
  'tool.answerSend': 'Send',
  'tool.answered': 'Answered: {answer}',
  'tool.outputEmpty': 'No output',

  // Notices
  'notice.retry': 'Retry',
  'notice.addCredit': 'Add credit',
  'notice.signIn': 'Sign in',
  'notice.continue': 'Continue',
  'notice.continueText': 'Continue',

  // Todos
  'todo.title': 'Plan',
  'todo.progress': '{done} of {total} done',
  'todo.startBuilding': 'Start building',
  'todo.collapse': 'Collapse plan',
  'todo.expand': 'Expand plan',

  // Queue
  'queue.title': 'Queued',
  'queue.edit': 'Edit',
  'queue.remove': 'Remove',
  'queue.save': 'Save',
  'queue.hint': 'Sent after the current step',

  // Input bar
  'input.placeholder': 'Ask Gisoo, @ to add a file, / for commands',
  'input.placeholderRunning': 'Type to queue a message for Gisoo',
  'input.send': 'Send',
  'input.stop': 'Stop',
  'input.attachFile': 'Attach the active file',
  'input.attachSelection': 'Attach the selection',
  'input.removeAttachment': 'Remove',
  'input.files.empty': 'No file matches',
  'input.commands.empty': 'No command matches',
  'input.imageTooLarge': 'Image is larger than 5 MB and was not attached.',
  'input.imageUnsupported': 'Only PNG, JPEG, WebP and GIF images can be attached.',
  'input.mode': 'Permission mode',
  'input.mode.ask': 'Ask',
  'input.mode.ask.desc': 'Approve every edit and command',
  'input.mode.autoEdit': 'Auto-edit',
  'input.mode.autoEdit.desc': 'Edits apply directly, commands still ask',
  'input.mode.plan': 'Plan',
  'input.mode.plan.desc': 'Read-only: Gisoo writes a plan first',
  'input.context': 'Context used: {pct}',
  'input.sessionCost': 'Session cost ≈ {cost}',
  'input.selection': 'Selection',

  // Agents panel and strip
  'agents.panel.title': 'Agents',
  'agents.panel.empty': 'No agents have run in this chat yet.',
  'agents.open': 'Agents',
  'agents.running': '{n} running',
  'agents.status.running': 'Running',
  'agents.status.waiting': 'Waiting',
  'agents.status.done': 'Done',
  'agents.status.failed': 'Failed',
  'agents.status.stopped': 'Stopped',
  'agents.stop': 'Stop',
  'agents.openTranscript': 'Open transcript',
  'agents.retry': 'Run again',
  'agents.parent': 'from {id}',
  'agents.tokens': '{n} tokens',
  'agents.strip.label': 'Running agents',

  // Misc
  'scroll.bottom': 'Jump to the latest message',
  'toast.close': 'Dismiss',
  'common.close': 'Close',
} as const;

export type StringKey = keyof typeof en;

let overrides: Record<string, string> = {};

/** Install the host-provided translations (keys missing here fall back to English). */
export function setStrings(values: Record<string, string> | undefined): void {
  overrides = values ?? {};
}

/** Translate a key, substituting `{name}` placeholders from `vars`. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  let text: string = overrides[key] ?? en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
