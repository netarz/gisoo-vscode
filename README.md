# Gisoo — AI Coding Agent for VS Code

An agentic coding assistant for VS Code, connected to [Gisoo](https://gisoo.pro). It reads your
project, plans the work step by step, edits files with diffs you approve, runs commands you allow,
and keeps going until the task is done. Pick the model per chat: Claude, GPT, Gemini, DeepSeek,
Qwen, Kimi, GLM and more, all through one Gisoo account.

[فارسی](#فارسی)

## Features

- **Agent, not autocomplete.** The agent explores the codebase, writes a visible plan (a to-do list
  that updates as it works), edits files, runs tests and fixes what fails.
- **Queue or steer while it works.** Send another message while a run is going: it is added to the
  conversation at the next step, so you can correct course without stopping. Queued messages can be
  edited or removed until they are picked up.
- **You stay in control.** Three permission modes:
  - *Ask* (default): every edit shows a diff with Accept / Reject, every command asks first.
  - *Auto-edit*: edits apply directly, commands still ask.
  - *Plan*: read-only; the agent writes a plan, and you press "Start building".
- **Checkpoints.** Every turn that changed files can be rolled back with "Restore files".
- **Your balance in view.** The balance of your Gisoo account sits in the chat header and the status
  bar. Each turn shows its tokens and an estimated cost.
- **Any coding model.** A searchable model picker with context size, price per million tokens and
  vision/reasoning badges. "Gisoo Auto" picks a suitable model for each message.
- **Context.** Attach files with `@`, the current selection, or images (paste or drop).
- **Instruction files.** The agent reads `~/.gisoo/GISOO.md` and `~/.claude/CLAUDE.md` (user), then
  `GISOO.md`, `.gisoo/GISOO.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `AGENTS.md`,
  `.github/copilot-instructions.md`, `.cursorrules` and `.windsurfrules` (project), then
  `GISOO.local.md` / `CLAUDE.local.md` (local, keep them out of git). `@path` imports work as in
  Claude Code (five levels deep, only inside the workspace, `~/.gisoo` and `~/.claude`). `/init`
  writes a `GISOO.md`, starting from an existing `CLAUDE.md` or `AGENTS.md` when there is one.
- **Memory.** Durable notes per workspace in `~/.gisoo/projects/<slug>/memory/` (an index
  `MEMORY.md` plus one file per fact). The agent reads them at the start of every run and updates them
  with the `memory` tool. Start a message with `#` to save a quick note without starting a run; `/memory`
  opens the index. A project can keep shared notes in `.gisoo/memory/`. Secrets are refused.
- **Claude Code compatibility.** Claude Code's memory for the same folder is read (read-only); "Gisoo:
  Import Claude Code memory" copies it. Custom commands in `.gisoo/commands`, `.claude/commands`,
  `~/.gisoo/commands` and `~/.claude/commands` become slash commands with `$ARGUMENTS` and `$1`..`$9`.
  Shell lines (`` !`cmd` ``) in a command file are shown as text, never run. `.mcp.json` and hooks are
  not supported in this phase. Turn all of this off with `gisoo.compat.claude`.
- **Skills.** Folders with a `SKILL.md` in `~/.gisoo/skills`, `~/.claude/skills`, `~/.agents/skills`,
  `~/.codex/skills`, Claude plugins, and `.gisoo/skills`, `.claude/skills`, `.agents/skills`,
  `.codex/skills` in the project appear in a catalogue; the agent loads one with the `skill` tool.
  `/skills` lists them. "Gisoo: Install skill" (or `/skills install <source>`) installs from a folder,
  a zip / `.skill` / tar.gz file, or a GitHub repository (`owner/repo[@ref][:path]` or a URL). Every
  install is scanned (size, symlinks, downloads piped into shells, credential paths, prompt
  injection) and shown to you for confirmation; nothing from a skill is ever executed by the installer.
- **Slash commands.** `/new` `/compact` `/model` `/plan` `/review` `/explain` `/tests` `/init` `/memory`
  `/skills` `/cost` `/help`, plus your custom commands.
- **Code actions.** "Fix with Gisoo" on errors, "Explain with Gisoo" on a selection.
- **English and Persian UI**, with right-to-left text where it belongs.
- **No telemetry.** The extension talks only to the Gisoo API you configured. The one exception is
  skill install from GitHub (`github.com` and `codeload.github.com` only), which happens only when you
  run it.

## Getting started

1. Install **Gisoo — AI Coding Agent** from the VS Code Marketplace or Open VSX.
2. Open the Gisoo view in the activity bar (or press `Ctrl+Alt+G` / `Cmd+Alt+G`).
3. Press **Sign in with Gisoo**. Your browser opens gisoo.pro; sign in, press "Connect", and VS Code
   finishes the sign-in by itself. If the editor does not open, run **Gisoo: Enter sign-in code**
   and paste the code shown on the page.

   Prefer a key? Create one at [gisoo.pro/app/api/keys](https://gisoo.pro/app/api/keys) and use
   **Gisoo: Sign in with API key**.
4. Ask for something: "Add input validation to the signup form and write tests for it."

Usage is charged to your Gisoo credit at the model's listed price. Add credit at
[gisoo.pro/app/credit](https://gisoo.pro/app/credit).

## How sign-in works

"Sign in with Gisoo" uses PKCE with a one-time code. The extension keeps a random verifier in memory
and sends only its hash to gisoo.pro. After you approve, the site returns a one-time code (valid for
five minutes, usable once). The extension trades the code and the verifier for a key that belongs to
its own project in your account. The key never appears in a URL or on a web page, and it is stored
only in VS Code's SecretStorage. "Sign out" removes it from the editor; revoke it any time from
[your keys](https://gisoo.pro/app/api/keys).

## Commands

| Command | Default key |
|---|---|
| Gisoo: Open chat | `Ctrl+Alt+G` / `Cmd+Alt+G` |
| Gisoo: New chat | |
| Gisoo: Open in editor tab | |
| Gisoo: Sign in / Sign in with API key / Enter sign-in code / Sign out | |
| Gisoo: Choose model | |
| Gisoo: Show balance | |
| Gisoo: Add selection to chat | `Ctrl+Alt+A` / `Cmd+Alt+A` |
| Gisoo: Explain selection | |
| Gisoo: Generate tests for file | |
| Gisoo: Review changes | |
| Gisoo: Restore last checkpoint | |
| Gisoo: Show history | |
| Gisoo: Install skill | |
| Gisoo: Import Claude Code memory | |

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `gisoo.region` | `global` | `global` uses `gisoo.pro`; `iran` uses the Gisoo Iran endpoint (`ir.gisoo.pro`). |
| `gisoo.baseUrl` | empty | Override the API base URL (any OpenAI-compatible endpoint). |
| `gisoo.model` | `claude-sonnet-5-5` | Default model for new chats. |
| `gisoo.permissionMode` | `ask` | `ask`, `autoEdit` or `plan`. |
| `gisoo.allowedCommands` | `[]` | Command prefixes that run without asking (dangerous patterns always ask). |
| `gisoo.maxSteps` | `60` | Tool steps per run before the agent asks to continue. |
| `gisoo.customInstructions` | empty | Extra instructions added to every chat. |
| `gisoo.webFetch.enabled` | `false` | Let the agent read public web pages (each fetch asks; local and private addresses are refused). |
| `gisoo.showCost` | `true` | Show the estimated cost of each turn. |
| `gisoo.language` | `auto` | UI language: `auto`, `en` or `fa`. |
| `gisoo.compat.claude` | `true` | Read `CLAUDE.md`, Claude Code memory, `.claude/commands` and `.claude/skills`. |

## Privacy and safety

- Your code is sent to the Gisoo API only as part of the messages you start.
- File access is limited to the open workspace folders; paths that leave them, or go into `.git/`,
  are refused. The only files read outside the workspace are instruction files, memory, commands and
  skills under `~/.gisoo`, `~/.claude`, `~/.agents` and `~/.codex`, plus `.agents/skills` in the
  folders between the repository root and the workspace folder; nothing is ever written into
  `~/.claude`.
- Settings that move your key, approvals, spending or what runs on your machine (`baseUrl`, `region`,
  `permissionMode`, `allowedCommands`, `customInstructions`, `maxSteps`, `maxCostPerTask`, agent
  limits, `webFetch.enabled`, `graphify.autoInstall`, `browserPath`) are read from your user settings
  only; a repository's `.vscode/settings.json` cannot change them.
- In an untrusted workspace, project instruction files, project memory, project commands and project
  skills are not read, no command, git or browser tool is offered, and skills cannot be installed into
  the project.
- Commands run in your workspace and ask first unless you allowed their prefix. Destructive patterns
  (`rm -rf /`, `git push --force`, piping a download into a shell, and similar) and any line break,
  `&`, redirection, backtick, `$(...)` or parentheses always ask.
- No analytics, no telemetry, no third-party calls. Skill install from GitHub is the only other
  network host (`github.com`, `codeload.github.com`, https only) and runs only when you start it.

Report a security problem privately: see [SECURITY.md](SECURITY.md).

## Development

```bash
npm install
npm run build      # dist/extension.js + media/webview.js
npm run typecheck
npm run test:unit  # mocha, no VS Code needed
npm test           # integration tests in VS Code against a local mock server
npm run package    # gisoo-vscode-<version>.vsix
```

Press `F5` in VS Code to start an Extension Development Host. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 NetArz

---

<div dir="rtl">

## فارسی

**گیسو برای VS Code** یک دستیار برنامه‌نویسی است که خودش کار را پیش می‌برد: پروژهٔ شما را می‌خواند، کار را
قدم‌به‌قدم برنامه‌ریزی می‌کند، فایل‌ها را با نمایش تغییرات و تأیید شما ویرایش می‌کند، فرمان‌هایی را که اجازه
داده‌اید اجرا می‌کند و تا پایان کار ادامه می‌دهد. مدل هر گفت‌وگو را خودتان انتخاب می‌کنید، از Claude و GPT و
Gemini تا DeepSeek و Qwen، همه با یک حساب گیسو.

- **پیام در صف:** وقتی گیسو مشغول کار است، پیام تازه بفرستید؛ در قدم بعدی به گفت‌وگو اضافه می‌شود و لازم
  نیست کار را متوقف کنید.
- **کنترل با شما:** در حالت «بپرس» هر ویرایش و هر فرمان پیش از اجرا تأیید شما را می‌خواهد. در حالت «برنامه»
  گیسو فقط می‌خواند و برنامه می‌نویسد.
- **بازگرداندن:** تغییرات هر نوبت را با یک دکمه برمی‌گردانید.
- **موجودی حساب:** موجودی حساب گیسوی شما در بالای گفت‌وگو و نوار وضعیت دیده می‌شود و هزینهٔ تقریبی هر
  نوبت هم کنارش می‌آید.

**شروع:** افزونه را نصب کنید، پنل گیسو را باز کنید و «ورود با حساب گیسو» را بزنید. اگر کلید وب‌سرویس
دارید، می‌توانید با فرمان «Gisoo: Sign in with API key» وارد شوید. هزینهٔ هر درخواست از اعتبار حساب گیسوی شما
کم می‌شود.

صفحهٔ افزونه: [gisoo.pro/vscode](https://gisoo.pro/vscode)

</div>
