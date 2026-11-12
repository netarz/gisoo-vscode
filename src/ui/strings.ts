/**
 * Strings the webview reads from InitState.strings. English and Persian side by side.
 * The webview uses the key with the English value as fallback; keep keys stable.
 * Rules: no emoji, Persian addresses the user as «شما», never «واسط», never a Toman amount.
 */
import type { UiLanguage } from '../shared/protocol';

type Entry = { en: string; fa: string };

export const STRINGS = {
  // Header
  'header.newChat': { en: 'New chat', fa: 'گفت‌وگوی جدید' },
  'header.history': { en: 'History', fa: 'گفت‌وگوهای قبلی' },
  'header.openInEditor': { en: 'Open in editor tab', fa: 'باز کردن در تب ویرایشگر' },
  'header.model': { en: 'Model', fa: 'مدل' },
  'header.balance': { en: 'Credit', fa: 'اعتبار' },
  'header.untitled': { en: 'New chat', fa: 'گفت‌وگوی جدید' },
  'header.account': { en: 'Account', fa: 'حساب' },

  // Model picker
  'models.search': { en: 'Search models', fa: 'جست‌وجوی مدل' },
  'models.recommended': { en: 'Recommended for coding', fa: 'پیشنهادی برای کدنویسی' },
  'models.all': { en: 'All models', fa: 'همهٔ مدل‌ها' },
  'models.context': { en: 'context', fa: 'ظرفیت' },
  'models.perMillion': { en: '/1M tokens', fa: '/ هر میلیون توکن' },
  'models.vision': { en: 'Vision', fa: 'تصویر' },
  'models.reasoning': { en: 'Reasoning', fa: 'استدلال' },
  'models.free': { en: 'Free', fa: 'رایگان' },
  'models.auto': { en: 'Gisoo Auto', fa: 'انتخاب خودکار گیسو' },
  'models.autoHint': { en: 'Picks a suitable model for each message', fa: 'برای هر پیام مدل مناسب را خودش انتخاب می‌کند' },
  'models.refresh': { en: 'Refresh list', fa: 'به‌روزرسانی فهرست' },
  'models.empty': { en: 'No model matches', fa: 'مدلی با این نام پیدا نشد' },

  // Modes
  'mode.ask': { en: 'Ask', fa: 'با تأیید شما' },
  'mode.autoEdit': { en: 'Auto-edit', fa: 'ویرایش خودکار' },
  'mode.plan': { en: 'Plan', fa: 'برنامه‌ریزی' },
  'mode.askHint': { en: 'Edits and commands wait for your approval', fa: 'ویرایش‌ها و دستورها منتظر تأیید شما می‌مانند' },
  'mode.autoEditHint': { en: 'Edits are applied directly; commands still ask', fa: 'ویرایش‌ها مستقیم اعمال می‌شوند؛ دستورها هنوز تأیید می‌خواهند' },
  'mode.planHint': { en: 'Read-only: Gisoo writes a plan and stops', fa: 'فقط خواندن: گیسو برنامه می‌نویسد و متوقف می‌شود' },
  'mode.label': { en: 'Permission mode', fa: 'حالت اجازه' },

  // Input
  'input.placeholder': { en: 'Ask Gisoo to build, fix or explain. @ for files, / for commands', fa: 'از گیسو بخواهید بسازد، درست کند یا توضیح دهد. @ برای فایل، / برای دستورها' },
  'input.send': { en: 'Send', fa: 'ارسال' },
  'input.stop': { en: 'Stop', fa: 'توقف' },
  'input.queue': { en: 'Queue', fa: 'در صف' },
  'input.queued': { en: 'Queued', fa: 'در صف' },
  'input.queuedHint': { en: 'Will be sent when Gisoo reaches a good point', fa: 'وقتی گیسو به نقطهٔ مناسبی برسد فرستاده می‌شود' },
  'input.edit': { en: 'Edit', fa: 'ویرایش' },
  'input.remove': { en: 'Remove', fa: 'حذف' },
  'input.attachFile': { en: 'Attach file', fa: 'پیوست فایل' },
  'input.attachSelection': { en: 'Attach selection', fa: 'پیوست بخش انتخاب‌شده' },
  'input.attachImage': { en: 'Attach image', fa: 'پیوست تصویر' },
  'input.imageTooLarge': { en: 'Images must be under 5 MB', fa: 'حجم تصویر باید کمتر از ۵ مگابایت باشد' },
  'input.noVision': { en: 'This model cannot see images', fa: 'این مدل تصویر را نمی‌بیند' },
  'input.files': { en: 'Files', fa: 'فایل‌ها' },
  'input.commands': { en: 'Commands', fa: 'دستورها' },
  'input.noFiles': { en: 'No file matches', fa: 'فایلی پیدا نشد' },
  'input.shiftEnter': { en: 'Enter to send, Shift+Enter for a new line', fa: 'Enter برای ارسال، Shift+Enter برای خط جدید' },

  // Messages & turns
  'turn.thinking': { en: 'Thinking', fa: 'در حال فکر کردن' },
  'turn.working': { en: 'Working', fa: 'در حال کار' },
  'turn.stopped': { en: 'Stopped', fa: 'متوقف شد' },
  'turn.restore': { en: 'Restore files to before this turn', fa: 'بازگرداندن فایل‌ها به قبل از این مرحله' },
  'turn.restored': { en: 'Files restored', fa: 'فایل‌ها بازگردانده شدند' },
  'turn.tokens': { en: 'tokens', fa: 'توکن' },
  'turn.in': { en: 'in', fa: 'ورودی' },
  'turn.out': { en: 'out', fa: 'خروجی' },
  'turn.cached': { en: 'cached', fa: 'کش‌شده' },
  'turn.cost': { en: 'estimated cost', fa: 'هزینهٔ تقریبی' },
  'turn.duration': { en: 'duration', fa: 'مدت' },
  'turn.summary': { en: 'Conversation summary', fa: 'خلاصهٔ گفت‌وگو' },
  'turn.injected': { en: 'Added while Gisoo was working', fa: 'در حین کار گیسو اضافه شد' },
  'turn.copy': { en: 'Copy', fa: 'کپی' },
  'turn.copied': { en: 'Copied', fa: 'کپی شد' },
  'turn.insert': { en: 'Insert at cursor', fa: 'درج در محل نشانگر' },
  'turn.newFile': { en: 'Open as new file', fa: 'باز کردن به‌عنوان فایل جدید' },
  'turn.apply': { en: 'Apply', fa: 'اعمال' },

  // Tool cards
  'tool.read_file': { en: 'Read', fa: 'خواندن' },
  'tool.list_directory': { en: 'List', fa: 'فهرست' },
  'tool.find_files': { en: 'Find files', fa: 'یافتن فایل' },
  'tool.search_text': { en: 'Search', fa: 'جست‌وجو' },
  'tool.get_diagnostics': { en: 'Diagnostics', fa: 'خطاها' },
  'tool.write_file': { en: 'Write', fa: 'نوشتن' },
  'tool.edit_file': { en: 'Edit', fa: 'ویرایش' },
  'tool.run_command': { en: 'Run', fa: 'اجرا' },
  'tool.todo_write': { en: 'Plan', fa: 'برنامه' },
  'tool.ask_user': { en: 'Question', fa: 'پرسش' },
  'tool.web_fetch': { en: 'Fetch', fa: 'دریافت صفحه' },
  'tool.task': { en: 'Sub-agent', fa: 'ایجنت فرعی' },
  'tool.input': { en: 'Input', fa: 'ورودی' },
  'tool.output': { en: 'Output', fa: 'خروجی' },
  'tool.pending': { en: 'Pending', fa: 'در انتظار' },
  'tool.awaiting': { en: 'Waiting for your decision', fa: 'منتظر تصمیم شما' },
  'tool.running': { en: 'Running', fa: 'در حال اجرا' },
  'tool.done': { en: 'Done', fa: 'انجام شد' },
  'tool.error': { en: 'Failed', fa: 'ناموفق' },
  'tool.rejected': { en: 'Rejected', fa: 'رد شد' },
  'tool.cancelled': { en: 'Cancelled', fa: 'لغو شد' },
  'tool.exitCode': { en: 'exit code', fa: 'کد خروج' },
  'tool.newFile': { en: 'new file', fa: 'فایل جدید' },
  'tool.openDiff': { en: 'Open diff', fa: 'نمایش تفاوت‌ها' },
  'tool.openFile': { en: 'Open file', fa: 'باز کردن فایل' },
  'tool.showMore': { en: 'Show more', fa: 'بیشتر' },
  'tool.showLess': { en: 'Show less', fa: 'کمتر' },

  // Approvals
  'approve.accept': { en: 'Accept', fa: 'تأیید' },
  'approve.reject': { en: 'Reject', fa: 'رد' },
  'approve.run': { en: 'Run', fa: 'اجرا' },
  'approve.always': { en: 'Always allow', fa: 'همیشه اجازه بده' },
  'approve.alwaysWord': { en: 'Always allow "{0}"', fa: 'همیشه به «{0}» اجازه بده' },
  'approve.note': { en: 'Tell Gisoo why (optional)', fa: 'به گیسو بگویید چرا (اختیاری)' },
  'approve.editTitle': { en: 'Gisoo wants to edit this file', fa: 'گیسو می‌خواهد این فایل را ویرایش کند' },
  'approve.writeTitle': { en: 'Gisoo wants to create this file', fa: 'گیسو می‌خواهد این فایل را بسازد' },
  'approve.commandTitle': { en: 'Gisoo wants to run this command', fa: 'گیسو می‌خواهد این دستور را اجرا کند' },
  'approve.dangerous': { en: 'This command can be destructive. Check it carefully.', fa: 'این دستور می‌تواند خرابی به بار بیاورد. با دقت بررسی کنید.' },
  'ask.answer': { en: 'Answer', fa: 'پاسخ' },
  'ask.placeholder': { en: 'Type your answer', fa: 'پاسخ خود را بنویسید' },

  // Todos / plan
  'todo.title': { en: 'Plan', fa: 'برنامه' },
  'todo.pending': { en: 'Pending', fa: 'در انتظار' },
  'todo.inProgress': { en: 'In progress', fa: 'در حال انجام' },
  'todo.done': { en: 'Done', fa: 'انجام شد' },
  'todo.startBuilding': { en: 'Start building', fa: 'شروع ساخت' },
  'todo.startBuildingHint': { en: 'Switch to Ask mode and go ahead with the plan', fa: 'به حالت تأیید می‌رود و برنامه را اجرا می‌کند' },

  // Errors & notices
  'error.title': { en: 'Something went wrong', fa: 'مشکلی پیش آمد' },
  'error.retry': { en: 'Retry', fa: 'تلاش دوباره' },
  'error.insufficientCredit': { en: 'Your Gisoo credit has run out.', fa: 'اعتبار گیسوی شما تمام شده است.' },
  'error.addCredit': { en: 'Add credit', fa: 'افزایش اعتبار' },
  'error.invalidKey': { en: 'Your key is no longer valid. Sign in again.', fa: 'کلید شما دیگر معتبر نیست. دوباره وارد شوید.' },
  'error.rateLimited': { en: 'Rate limited. Gisoo will retry in a moment.', fa: 'درخواست‌ها زیاد شده‌اند. گیسو کمی بعد دوباره تلاش می‌کند.' },
  'error.network': { en: 'Could not reach Gisoo. Check your connection.', fa: 'ارتباط با گیسو برقرار نشد. اتصال اینترنت را بررسی کنید.' },
  'error.server': { en: 'Gisoo had a server problem. Try again.', fa: 'سرور گیسو مشکلی داشت. دوباره تلاش کنید.' },
  'error.modelNotFound': { en: 'This model is not available. Choose another one.', fa: 'این مدل در دسترس نیست. مدل دیگری انتخاب کنید.' },
  'error.maxSteps': { en: 'Gisoo reached the step limit for this run.', fa: 'گیسو به سقف مراحل این اجرا رسید.' },
  'error.maxCost': { en: 'Gisoo stopped: the cost limit for this task ({0}) was reached.', fa: 'گیسو متوقف شد: سقف هزینهٔ این کار ({0}) پر شد.' },
  'error.timeout': { en: 'Gisoo took too long to answer. Try again.', fa: 'پاسخ گیسو بیش از حد طول کشید. دوباره تلاش کنید.' },
  'error.badRequest': { en: 'Gisoo rejected the request: {0}', fa: 'درخواست پذیرفته نشد: {0}' },
  'error.continue': { en: 'Continue', fa: 'ادامه' },
  'notice.signInFirst': { en: 'Sign in to Gisoo to start chatting.', fa: 'برای شروع گفت‌وگو ابتدا وارد حساب گیسوی خود شوید.' },
  'notice.untrusted': { en: 'This workspace is not trusted: commands are off and every edit asks first.', fa: 'این پوشه مورد اعتماد نیست: اجرای دستور خاموش است و هر ویرایش اول از شما می‌پرسد.' },
  'notice.noActiveFile': { en: 'Open a file in the editor first.', fa: 'ابتدا فایلی را در ویرایشگر باز کنید.' },
  'notice.nothingToRetry': { en: 'Nothing to retry.', fa: 'چیزی برای تلاش دوباره وجود ندارد.' },
  'notice.busy': { en: 'Gisoo is still working. Stop it first.', fa: 'گیسو هنوز مشغول است. اول آن را متوقف کنید.' },
  'notice.restoredFiles': { en: '{0} file(s) restored.', fa: '{0} فایل بازگردانده شد.' },
  'notice.noCheckpoint': { en: 'There is nothing to restore for this turn.', fa: 'برای این مرحله چیزی برای بازگرداندن وجود ندارد.' },
  'notice.modelSet': { en: 'Model: {0}', fa: 'مدل: {0}' },
  'notice.useModelPicker': { en: 'Choose a model from the picker in the header, or type /model <id>.', fa: 'مدل را از بالای صفحه انتخاب کنید یا بنویسید /model <id>.' },
  'cost.session': { en: 'This chat has cost about {0} so far; {1} of the context is in use.', fa: 'هزینهٔ این گفت‌وگو تا اینجا حدود {0} است؛ {1} از ظرفیت مصرف شده است.' },
  'cost.unknown': { en: 'Cost is unknown for this model.', fa: 'هزینهٔ این مدل مشخص نیست.' },
  'help.title': { en: 'Commands', fa: 'دستورها' },
  'agents.title': { en: 'Available agents', fa: 'ایجنت‌های در دسترس' },
  'agents.none': { en: 'No agent definitions found. Add a markdown file to .gisoo/agents/<name>.md', fa: 'تعریف ایجنتی پیدا نشد. یک فایل markdown در .gisoo/agents/<name>.md بسازید.' },
  'agent.stopped': { en: 'Agent stopped.', fa: 'ایجنت متوقف شد.' },
  'agent.notFound': { en: 'No running agent with that id.', fa: 'ایجنتی با این شناسه در حال اجرا نیست.' },
  'agents.panel.title': { en: 'Agents', fa: 'ایجنت‌ها' },
  'agents.panel.empty': { en: 'No agents have run in this chat yet.', fa: 'در این گفت‌وگو هنوز ایجنتی اجرا نشده است.' },
  'agents.open': { en: 'Agents', fa: 'ایجنت‌ها' },
  'agents.running': { en: '{n} running', fa: '{n} در حال اجرا' },
  'agents.status.running': { en: 'Running', fa: 'در حال اجرا' },
  'agents.status.waiting': { en: 'Waiting', fa: 'در انتظار' },
  'agents.status.done': { en: 'Done', fa: 'انجام شد' },
  'agents.status.failed': { en: 'Failed', fa: 'ناموفق' },
  'agents.status.stopped': { en: 'Stopped', fa: 'متوقف شد' },
  'agents.stop': { en: 'Stop', fa: 'توقف' },
  'agents.openTranscript': { en: 'Open transcript', fa: 'باز کردن گزارش' },
  'agents.retry': { en: 'Run again', fa: 'اجرای دوباره' },
  'agents.parent': { en: 'from {id}', fa: 'از {id}' },
  'agents.tokens': { en: '{n} tokens', fa: '{n} توکن' },
  'agents.strip.label': { en: 'Running agents', fa: 'ایجنت‌های در حال اجرا' },
  'notice.compacted': { en: 'Older messages were summarised to save context.', fa: 'پیام‌های قدیمی‌تر خلاصه شدند تا ظرفیت گفت‌وگو آزاد شود.' },
  'notice.signedOut': { en: 'Signed out', fa: 'از حساب خارج شدید' },

  // Memory, skills, context files, custom commands (phase 2)
  'memory.saved': { en: 'Saved to memory: {0}', fa: 'در حافظه ذخیره شد: {0}' },
  'memory.saveFailed': { en: 'Could not save the memory: {0}', fa: 'ذخیرهٔ حافظه انجام نشد: {0}' },
  'memory.empty': { en: 'Write the note after #, for example: #prefer pnpm over npm', fa: 'یادداشت را بعد از # بنویسید، مثلاً: #prefer pnpm over npm' },
  'memory.opened': { en: 'Memory file opened: {0}', fa: 'فایل حافظه باز شد: {0}' },
  'memory.openFailed': { en: 'Could not open the memory file: {0}', fa: 'فایل حافظه باز نشد: {0}' },
  'skills.title': { en: 'Available skills', fa: 'مهارت‌های در دسترس' },
  'skills.none': { en: 'No skills found. Add a folder with SKILL.md under .gisoo/skills/<name>/ or ~/.gisoo/skills/<name>/, or run "Gisoo: Install skill".', fa: 'مهارتی پیدا نشد. پوشه‌ای با SKILL.md در .gisoo/skills/<name>/ یا ~/.gisoo/skills/<name>/ بسازید، یا دستور «Gisoo: Install skill» را اجرا کنید.' },
  'skills.installHint': { en: 'Install more with /skills install <GitHub URL or folder>.', fa: 'برای نصب مهارت‌های بیشتر بنویسید /skills install <آدرس GitHub یا پوشه>.' },
  'context.reloaded': { en: 'Context files reloaded.', fa: 'فایل‌های زمینه دوباره بارگذاری شدند.' },
  'help.custom': { en: 'Custom commands', fa: 'دستورهای سفارشی' },

  // Empty state
  'empty.welcome': { en: 'Gisoo, your coding agent', fa: 'گیسو، دستیار کدنویسی شما' },
  'empty.tagline': { en: 'Plans, reads your code, edits with diffs you approve, runs commands.', fa: 'برنامه می‌ریزد، کد شما را می‌خواند، با تأیید شما ویرایش می‌کند و دستورها را اجرا می‌کند.' },
  'empty.signInTitle': { en: 'Connect your Gisoo account', fa: 'حساب گیسوی خود را وصل کنید' },
  'empty.signIn': { en: 'Sign in with Gisoo', fa: 'ورود با گیسو' },
  'empty.apiKey': { en: 'Use an API key', fa: 'استفاده از کلید دسترسی (API Key)' },
  'empty.enterCode': { en: 'Enter sign-in code', fa: 'وارد کردن کد ورود' },
  'empty.tip1': { en: 'Attach files with @ and choose a model from the header.', fa: 'با @ فایل پیوست کنید و مدل را از بالای صفحه انتخاب کنید.' },
  'empty.tip2': { en: 'Plan mode writes a plan first; Ask mode shows every edit before it is applied.', fa: 'حالت برنامه‌ریزی اول برنامه می‌نویسد؛ حالت تأیید هر ویرایش را پیش از اعمال نشان می‌دهد.' },
  'empty.tip3': { en: 'Send more messages while Gisoo works; they are queued.', fa: 'در حین کار گیسو هم می‌توانید پیام بفرستید؛ در صف می‌مانند.' },
  'empty.starter1': { en: 'Explain how this project is organised', fa: 'ساختار این پروژه را توضیح بده' },
  'empty.starter2': { en: 'Find and fix the errors in the current file', fa: 'خطاهای فایل فعلی را پیدا و درست کن' },
  'empty.starter3': { en: 'Write tests for the current file', fa: 'برای فایل فعلی تست بنویس' },
  'empty.starter4': { en: 'Review my uncommitted changes', fa: 'تغییرات کامیت‌نشدهٔ من را بررسی کن' },

  // Account panel
  'account.title': { en: 'Account', fa: 'حساب کاربری' },
  'account.balance': { en: 'Credit', fa: 'اعتبار' },
  'account.key': { en: 'Key', fa: 'کلید' },
  'account.project': { en: 'Project', fa: 'پروژه' },
  'account.spent': { en: 'Spent with this key', fa: 'مصرف این کلید' },
  'account.limit': { en: 'Spend limit', fa: 'سقف مصرف' },
  'account.noLimit': { en: 'No limit', fa: 'بدون سقف' },
  'account.endpoint': { en: 'Endpoint', fa: 'نقطهٔ اتصال' },
  'account.regionGlobal': { en: 'Global', fa: 'جهانی' },
  'account.regionIran': { en: 'Iran endpoint', fa: 'نقطهٔ اتصال ایران' },
  'account.addCredit': { en: 'Add credit', fa: 'افزایش اعتبار' },
  'account.manageKeys': { en: 'Manage keys', fa: 'مدیریت کلیدها' },
  'account.refresh': { en: 'Refresh', fa: 'به‌روزرسانی' },
  'account.signOut': { en: 'Sign out', fa: 'خروج از حساب' },
  'account.signedOut': { en: 'Not signed in', fa: 'وارد نشده‌اید' },
  'account.sessionCost': { en: 'This chat', fa: 'این گفت‌وگو' },
  'account.context': { en: 'Context used', fa: 'ظرفیت مصرف‌شده' },
  'account.status': { en: 'Status', fa: 'وضعیت' },
  'account.version': { en: 'Version', fa: 'نسخه' },
  'account.docs': { en: 'Documentation', fa: 'مستندات' },

  // History
  'history.title': { en: 'Chats', fa: 'گفت‌وگوها' },
  'history.empty': { en: 'No previous chats', fa: 'گفت‌وگوی قبلی وجود ندارد' },
  'history.delete': { en: 'Delete', fa: 'حذف' },
  'history.turns': { en: 'messages', fa: 'پیام' },

  // Generic
  'common.close': { en: 'Close', fa: 'بستن' },
  'common.cancel': { en: 'Cancel', fa: 'انصراف' },
  'common.ok': { en: 'OK', fa: 'باشه' },
  'common.loading': { en: 'Loading', fa: 'در حال بارگذاری' },
  'common.lines': { en: 'lines', fa: 'خط' },
} satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;

/** Every key the webview may ask for (builder B matches against this list). */
export const STRING_KEYS = Object.keys(STRINGS) as StringKey[];

export function stringsFor(language: UiLanguage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of STRING_KEYS) out[key] = STRINGS[key][language];
  return out;
}

export function str(language: UiLanguage, key: StringKey, ...args: Array<string | number>): string {
  let text = STRINGS[key][language];
  args.forEach((a, i) => {
    text = text.replace(`{${i}}`, String(a));
  });
  return text;
}

/**
 * Strings the extension host shows itself (notifications, input boxes, status bar, quick picks).
 * Kept apart from STRINGS so the webview payload and STRING_KEYS stay stable.
 */
export const HOST_STRINGS = {

  // Skill install (SPEC-phase2 section 7)
  'host.skill.badSource': { en: 'Not a skill source: {0}. Use a GitHub URL (https://github.com/owner/repo[/tree/ref/path]), a local folder or a .zip/.skill/.tar.gz file.', fa: '«{0}» منبع معتبری برای مهارت نیست. یک آدرس GitHub (https://github.com/owner/repo[/tree/ref/path])، یک پوشهٔ محلی یا یک فایل .zip/.skill/.tar.gz بدهید.' },
  'host.skill.fetching': { en: 'Gisoo: fetching and scanning the skill from {0}', fa: 'گیسو: دریافت و بررسی مهارت از {0}' },
  'host.skill.refused': { en: 'The skill "{0}" cannot be installed: {1}', fa: 'مهارت «{0}» قابل نصب نیست: {1}' },
  'host.skill.install': { en: 'Install', fa: 'نصب' },
  'host.skill.confirmTitle': { en: 'Install the skill "{0}"?', fa: 'مهارت «{0}» نصب شود؟' },
  'host.skill.installAnyway': { en: 'Install anyway', fa: 'با این حال نصب کن' },
  'host.skill.highTitle': { en: 'The scan found serious issues in "{0}". Install anyway?', fa: 'بررسی، موارد جدی در «{0}» پیدا کرد. با این حال نصب شود؟' },
  'host.skill.highDetail': { en: 'These findings can mean the skill tries to run downloaded code, read credentials, send data elsewhere or steer the agent. Install only if you trust the source.', fa: 'این موارد می‌تواند به این معنی باشد که مهارت می‌خواهد کد دانلودشده را اجرا کند، اطلاعات ورود را بخواند، داده‌ها را جای دیگری بفرستد یا ایجنت را منحرف کند. فقط اگر به منبع اعتماد دارید نصب کنید.' },
  'host.skill.replace': { en: 'Replace', fa: 'جایگزین کن' },
  'host.skill.exists': { en: 'A skill named "{0}" is already installed there. Replace it?', fa: 'مهارتی به نام «{0}» قبلاً آنجا نصب شده است. جایگزین شود؟' },
  'host.skill.installed': { en: 'Skill "{0}" installed in {1}.', fa: 'مهارت «{0}» در {1} نصب شد.' },
  'host.skill.failed': { en: 'Skill install failed: {0}', fa: 'نصب مهارت انجام نشد: {0}' },
  'host.skill.subpathTitle': { en: 'Path inside {0}', fa: 'مسیر داخل {0}' },
  'host.skill.subpathPrompt': { en: 'Folder of the skill inside the repository, e.g. skills/docx. Leave empty to choose from every skill in the repository.', fa: 'پوشهٔ مهارت داخل مخزن، مثلاً skills/docx. خالی بگذارید تا از میان همهٔ مهارت‌های مخزن انتخاب کنید.' },
  'host.skill.fromUrl': { en: 'GitHub URL', fa: 'آدرس GitHub' },
  'host.skill.urlTitle': { en: 'Install a skill from GitHub', fa: 'نصب مهارت از GitHub' },
  'host.skill.urlPrompt': { en: 'Only github.com is contacted, only now, for this download.', fa: 'فقط با github.com ارتباط برقرار می‌شود، فقط همین حالا و فقط برای این دانلود.' },
  'host.skill.fromFolder': { en: 'Local folder', fa: 'پوشهٔ محلی' },
  'host.skill.fromArchive': { en: 'Archive file (.zip, .skill, .tar.gz)', fa: 'فایل فشرده (.zip، .skill، .tar.gz)' },
  'host.skill.sourceTitle': { en: 'Gisoo: Install skill', fa: 'گیسو: نصب مهارت' },
  'host.skill.sourcePlaceholder': { en: 'Where does the skill come from?', fa: 'مهارت از کجا بیاید؟' },
  'host.skill.scopeTitle': { en: 'Install for', fa: 'نصب برای' },
  'host.skill.scopeUser': { en: 'Me (all projects)', fa: 'شما (همهٔ پروژه‌ها)' },
  'host.skill.scopeProject': { en: 'This project', fa: 'این پروژه' },
  'host.skill.scopeUntrusted': { en: 'Installing into a project requires a trusted workspace.', fa: 'نصب در پروژه به پوشهٔ مورد اعتماد نیاز دارد.' },
  'host.skill.noSkillMd': { en: 'No SKILL.md found in the source.', fa: 'در این منبع SKILL.md پیدا نشد.' },
  'host.skill.pickSkill': { en: 'Which skill?', fa: 'کدام مهارت؟' },
  'host.skill.pickSkillPlaceholder': { en: '{0} skills found in the source', fa: '{0} مهارت در این منبع پیدا شد' },
  'host.skill.name': { en: 'Name', fa: 'نام' },
  'host.skill.description': { en: 'Description', fa: 'توضیح' },
  'host.skill.source': { en: 'Source', fa: 'منبع' },
  'host.skill.size': { en: 'Size', fa: 'اندازه' },
  'host.skill.filesWord': { en: 'files', fa: 'فایل' },
  'host.skill.target': { en: 'Target', fa: 'مقصد' },
  'host.skill.files': { en: 'Files', fa: 'فایل‌ها' },
  'host.skill.findings': { en: 'Scan result', fa: 'نتیجهٔ بررسی' },
  'host.skill.noFindings': { en: 'nothing suspicious found', fa: 'مورد مشکوکی پیدا نشد' },
  'host.skill.neverRuns': { en: 'Gisoo never runs anything from a skill by itself; scripts run only through run_command with your approval.', fa: 'گیسو هیچ‌چیز را از یک مهارت خودبه‌خود اجرا نمی‌کند؛ اسکریپت‌ها فقط از طریق run_command و با تأیید شما اجرا می‌شوند.' },

  // Claude Code memory import (SPEC-phase2 section 3)
  'host.memory.noWorkspace': { en: 'Open a folder first.', fa: 'ابتدا یک پوشه باز کنید.' },
  'host.memory.compatOff': { en: 'Claude Code compatibility is off (setting gisoo.compat.claude).', fa: 'سازگاری با Claude Code خاموش است (تنظیم gisoo.compat.claude).' },
  'host.memory.importNone': { en: 'No Claude Code memory found for this folder ({0}).', fa: 'حافظه‌ای از Claude Code برای این پوشه پیدا نشد ({0}).' },
  'host.memory.importConfirm': { en: 'Copy the Claude Code memory of this folder into Gisoo memory? Existing names are kept; files that look like secrets are skipped. Nothing in ~/.claude is changed.', fa: 'حافظهٔ Claude Code این پوشه در حافظهٔ گیسو کپی شود؟ نام‌های موجود دست نمی‌خورند؛ فایل‌هایی که شبیه رمز هستند رد می‌شوند. چیزی در ~/.claude تغییر نمی‌کند.' },
  'host.memory.import': { en: 'Import', fa: 'وارد کن' },
  'host.memory.importDone': { en: 'Claude memory imported: {0} copied, {1} skipped (already present), {2} refused.', fa: 'حافظهٔ Claude وارد شد: {0} کپی شد، {1} رد شد (قبلاً وجود داشت)، {2} پذیرفته نشد.' },
  'host.memory.openIndex': { en: 'Open MEMORY.md', fa: 'باز کردن MEMORY.md' },

  'host.signIn.browserOpened': { en: 'Finish the sign-in in your browser. If the editor does not come back, use "Enter sign-in code".', fa: 'ورود را در مرورگر کامل کنید. اگر ویرایشگر باز نشد، از «وارد کردن کد ورود» استفاده کنید.' },
  'host.signIn.enterCode': { en: 'Enter sign-in code', fa: 'وارد کردن کد ورود' },
  'host.signedIn': { en: 'Signed in to Gisoo.', fa: 'به گیسو وارد شدید.' },
  'host.signedInWithBalance': { en: 'Signed in to Gisoo. Credit: {0}', fa: 'به گیسو وارد شدید. اعتبار: {0}' },
  'host.apiKey.title': { en: 'Sign in with a Gisoo API key', fa: 'ورود با کلید دسترسی گیسو' },
  'host.apiKey.prompt': { en: 'Paste your Gisoo API key. It is stored only in the secure storage of VS Code.', fa: 'کلید دسترسی گیسوی خود را وارد کنید. کلید فقط در حافظهٔ امن VS Code نگهداری می‌شود.' },
  'host.apiKey.invalid': { en: 'Gisoo keys start with sk-gisoo-v1-', fa: 'کلید گیسو با sk-gisoo-v1- شروع می‌شود' },
  'host.code.title': { en: 'Enter the Gisoo sign-in code', fa: 'کد ورود گیسو را وارد کنید' },
  'host.code.prompt': { en: 'Paste the code shown on the Gisoo web page after you approved the connection.', fa: 'کدی را که پس از تأیید اتصال در صفحهٔ وب گیسو نشان داده شد وارد کنید.' },
  'host.signOut.done': { en: 'Signed out of Gisoo. The key is still valid on the server; revoke it on the keys page if you no longer need it.', fa: 'از حساب گیسو خارج شدید. کلید هنوز در سرور معتبر است؛ اگر دیگر به آن نیاز ندارید، آن را در صفحهٔ کلیدها باطل کنید.' },
  'host.manageKeys': { en: 'Manage keys', fa: 'مدیریت کلیدها' },
  'host.notSignedIn': { en: 'Sign in to Gisoo first.', fa: 'اول به گیسو وارد شوید.' },

  'host.attach.noFile': { en: 'Open a file in the editor first.', fa: 'اول یک فایل را در ویرایشگر باز کنید.' },
  'host.attach.noSelection': { en: 'Select some code in the editor first.', fa: 'اول بخشی از کد را در ویرایشگر انتخاب کنید.' },
  'host.copied': { en: 'Copied', fa: 'کپی شد' },
  'host.noEditorCopied': { en: 'No editor is open; the code was copied instead.', fa: 'ویرایشگری باز نیست؛ به جای آن کد کپی شد.' },
  'host.cannotOpen': { en: 'Cannot open {0}', fa: '{0} باز نشد' },

  'host.status.signIn': { en: 'Gisoo: sign in', fa: 'گیسو: ورود' },
  'host.status.signInTooltip': { en: 'Sign in to Gisoo', fa: 'ورود به گیسو' },
  'host.status.balanceTooltip': { en: 'Gisoo credit: {0}. Click for account details.', fa: 'اعتبار گیسو: {0}. برای جزئیات حساب کلیک کنید.' },
  'host.status.errorTooltip': { en: 'Gisoo could not refresh your account: {0}', fa: 'گیسو نتوانست حساب شما را به‌روز کند: {0}' },

  'host.account.title': { en: 'Gisoo account', fa: 'حساب گیسو' },
  'host.account.placeholder': { en: 'Choose an action', fa: 'یک گزینه را انتخاب کنید' },
  'host.account.balance': { en: 'Credit', fa: 'اعتبار' },
  'host.account.project': { en: 'Project', fa: 'پروژه' },
  'host.account.key': { en: 'Key', fa: 'کلید' },
  'host.account.spent': { en: 'Spent with this key', fa: 'مصرف این کلید' },
  'host.account.noLimit': { en: 'no limit', fa: 'بدون سقف' },
  'host.account.endpoint': { en: 'Endpoint', fa: 'نقطهٔ اتصال' },
  'host.account.lastError': { en: 'Last check failed', fa: 'آخرین بررسی ناموفق بود' },
  'host.account.openChat': { en: 'Open chat', fa: 'باز کردن گفت‌وگو' },
  'host.account.addCredit': { en: 'Add credit', fa: 'افزایش اعتبار' },
  'host.account.refresh': { en: 'Refresh', fa: 'به‌روزرسانی' },
  'host.account.signOut': { en: 'Sign out', fa: 'خروج از حساب' },

  // Code graph (Graphify)
  'host.graph.status.off': { en: 'Graph: off', fa: 'گراف: خاموش' },
  'host.graph.status.installing': { en: 'Graph: installing', fa: 'گراف: در حال نصب' },
  'host.graph.status.building': { en: 'Graph: building', fa: 'گراف: در حال ساخت' },
  'host.graph.status.ready': { en: 'Graph: ready', fa: 'گراف: آماده' },
  'host.graph.status.stale': { en: 'Graph: stale', fa: 'گراف: قدیمی' },
  'host.graph.tooltip': { en: 'Gisoo code graph (Graphify). Click to rebuild.', fa: 'گراف کد گیسو (Graphify). برای بازسازی کلیک کنید.' },
  'host.graph.installPrompt': { en: 'Install Graphify so Gisoo understands this project better? It is a local Python tool and makes no model calls.', fa: 'نصب Graphify برای شناخت بهتر پروژه؟ ابزاری محلی بر پایهٔ پایتون است و با هیچ مدلی تماس نمی‌گیرد.' },
  'host.graph.install': { en: 'Install', fa: 'نصب' },
  'host.graph.notNow': { en: 'Not now', fa: 'حالا نه' },
  'host.graph.never': { en: 'Never ask', fa: 'دیگر نپرس' },
  'host.graph.taskName': { en: 'Install Graphify', fa: 'نصب Graphify' },
  'host.graph.installed': { en: 'Graphify {0} is installed.', fa: 'Graphify نسخهٔ {0} نصب شد.' },
  'host.graph.installFailed': { en: 'Graphify could not be installed. Run this yourself in a terminal: {0}', fa: 'نصب Graphify انجام نشد. این دستور را خودتان در ترمینال اجرا کنید: {0}' },
  'host.graph.noPython': { en: 'Graphify needs Python 3.10 or newer. Install Python, then run "Gisoo: Rebuild code graph".', fa: 'Graphify به پایتون ۳٫۱۰ یا جدیدتر نیاز دارد. پایتون را نصب کنید و سپس «Gisoo: Rebuild code graph» را اجرا کنید.' },
  'host.graph.notInstalled': { en: 'Graphify is not installed.', fa: 'Graphify نصب نیست.' },
  'host.graph.untrusted': { en: 'The code graph works only in a trusted workspace.', fa: 'گراف کد فقط در پوشهٔ مورد اعتماد کار می‌کند.' },
  'host.graph.building': { en: 'Gisoo: building the code graph', fa: 'گیسو: ساخت گراف کد' },
  'host.graph.buildFailed': { en: 'The code graph could not be built: {0}', fa: 'ساخت گراف کد انجام نشد: {0}' },
  'host.graph.gitignorePrompt': { en: 'Add graphify-out/ to .gitignore so the graph is not committed?', fa: 'پوشهٔ graphify-out/ به .gitignore اضافه شود تا گراف کامیت نشود؟' },
  'host.graph.add': { en: 'Add', fa: 'اضافه کن' },

  // Agents
  'host.agents.viewEmpty': { en: 'No agents yet. Gisoo starts them with the task tool.', fa: 'هنوز ایجنتی اجرا نشده است. گیسو آن‌ها را با ابزار task شروع می‌کند.' },
  'host.agents.transcriptTitle': { en: 'Agent transcript', fa: 'گفت‌وگوی ایجنت' },
  'host.agents.noTranscript': { en: 'No transcript is kept for this agent.', fa: 'برای این ایجنت گفت‌وگویی نگه داشته نشده است.' },
  'host.agents.retryBusy': { en: 'That agent is still running.', fa: 'این ایجنت هنوز در حال اجراست.' },
  'host.agents.retried': { en: 'Agent "{0}" was started again.', fa: 'ایجنت «{0}» دوباره شروع شد.' },
  'host.agents.scaffoldUntrusted': { en: 'Agent files can only be created in a trusted workspace.', fa: 'فایل ایجنت فقط در پوشهٔ مورد اعتماد ساخته می‌شود.' },
  'host.agents.scaffoldBadName': { en: 'Agent names use lowercase letters, digits and dashes (2 to 40 characters).', fa: 'نام ایجنت فقط از حروف کوچک انگلیسی، رقم و خط تیره ساخته می‌شود (۲ تا ۴۰ نویسه).' },
  'host.agents.scaffoldExists': { en: 'Agent "{0}" already exists: {1}', fa: 'ایجنت «{0}» از قبل وجود دارد: {1}' },
  'host.agents.scaffolded': { en: 'Agent "{0}" created at {1}. Edit the file, then use it with the task tool.', fa: 'ایجنت «{0}» در {1} ساخته شد. فایل را ویرایش کنید و سپس با ابزار task از آن استفاده کنید.' },
  'host.agents.scaffoldUsage': { en: 'Usage: /agents new <name>', fa: 'شکل درست دستور: /agents new <name>' },
  'host.agents.status.running': { en: 'running', fa: 'در حال اجرا' },
  'host.agents.status.waiting': { en: 'waiting', fa: 'در انتظار' },
  'host.agents.status.done': { en: 'done', fa: 'انجام شد' },
  'host.agents.status.failed': { en: 'failed', fa: 'ناموفق' },
  'host.agents.status.stopped': { en: 'stopped', fa: 'متوقف شد' },
  'host.agents.stop': { en: 'Stop', fa: 'توقف' },
  'host.agents.open': { en: 'Open transcript', fa: 'نمایش گفت‌وگو' },
  'host.agents.retry': { en: 'Retry', fa: 'اجرای دوباره' },

  // Preview
  'host.preview.opened': { en: 'Preview: {0}', fa: 'پیش‌نمایش: {0}' },

  // Security
  'host.auth.foreignAnswer': { en: 'Gisoo: a sign-in answer that does not belong to this sign-in was ignored.', fa: 'گیسو: پاسخ ورودی که به این ورود شما تعلق نداشت نادیده گرفته شد.' },
  'host.skills.unsafeTarget': { en: 'The project skills folder leads outside this workspace through a link, so nothing was installed there.', fa: 'پوشهٔ مهارت‌های پروژه از راه یک پیوند به بیرون از این پوشهٔ کاری می‌رود، بنابراین چیزی در آن نصب نشد.' },} satisfies Record<string, Entry>;

export type HostStringKey = keyof typeof HOST_STRINGS;

export function hostStr(language: UiLanguage, key: HostStringKey, ...args: Array<string | number>): string {
  let text = HOST_STRINGS[key][language];
  args.forEach((a, i) => {
    text = text.replace(`{${i}}`, String(a));
  });
  return text;
}

/** Keys for the slash command descriptions shown in the `/` picker. */
export const SLASH_DESCRIPTIONS: Record<string, Entry> = {
  new: { en: 'Start a new chat', fa: 'شروع گفت‌وگوی جدید' },
  compact: { en: 'Summarise older messages to free context', fa: 'خلاصه کردن پیام‌های قدیمی برای آزاد کردن ظرفیت' },
  model: { en: 'Choose a model', fa: 'انتخاب مدل' },
  plan: { en: 'Switch to plan mode', fa: 'رفتن به حالت برنامه‌ریزی' },
  review: { en: 'Review uncommitted changes', fa: 'بررسی تغییرات کامیت‌نشده' },
  explain: { en: 'Explain the selection or the active file', fa: 'توضیح بخش انتخاب‌شده یا فایل فعلی' },
  tests: { en: 'Write tests for the active file', fa: 'نوشتن تست برای فایل فعلی' },
  init: { en: 'Create GISOO.md with project instructions', fa: 'ساختن GISOO.md با راهنمای پروژه' },
  cost: { en: 'Show cost of this chat', fa: 'نمایش هزینهٔ این گفت‌وگو' },
  agents: { en: 'List the available sub-agents', fa: 'فهرست ایجنت‌های فرعی در دسترس' },
  memory: { en: 'Open the memory file (MEMORY.md)', fa: 'باز کردن فایل حافظه (MEMORY.md)' },
  skills: { en: 'List skills; /skills install <source> installs one', fa: 'فهرست مهارت‌ها؛ /skills install <source> یکی را نصب می‌کند' },
  help: { en: 'Show help', fa: 'راهنما' },
};
