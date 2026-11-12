# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Email **dev@netarz.ir** (subject: "Security: gisoo-vscode") with:

- what you found and where (file, version, endpoint),
- steps to reproduce,
- the impact you expect.

You will get a reply within five working days. Please give us reasonable time to fix the problem
before you publish it.

## Supported versions

Only the latest released version receives security fixes.

## What the extension protects

- **API keys** live only in VS Code SecretStorage. They are never written to settings, logs, session
  files or URLs.
- **Sign-in** uses PKCE with a one-time code: the code is valid for five minutes, can be used once,
  and is useless without the verifier that never leaves the editor.
- **File access** is limited to the open workspace folders. Paths that resolve outside them, through
  symlinks or into `.git/`, are refused.
- **Commands** ask for approval unless their prefix is allowed; destructive patterns and shell
  chaining, redirection or substitution always ask. Helper programs (git, Python, the browser) are
  looked up on absolute PATH entries only, never in the workspace folder.
- **Workspace settings** cannot change the API address, approvals, allowed commands, spending limits
  or what runs on the machine: those settings are read from user settings only.
- **Untrusted workspaces** get no command, git or browser tool and no project instructions, skills,
  agents or installs.
- **Rendering:** model output is rendered as Markdown through DOMPurify inside a webview with a strict
  Content Security Policy (no remote scripts, nonce-based script loading).
- **No telemetry** and no network calls other than the configured Gisoo API (and `web_fetch`, which is
  off by default, asks before every fetch and refuses local and private network addresses). The key
  is sent only over https, or plain http to this machine.
- **Skill install from GitHub** is the only other network host: `github.com` and
  `codeload.github.com`, https only, at most four redirects, 40 MB, and only when you run "Gisoo:
  Install skill". Archives are unpacked in memory by the extension's own reader (no zip library): path
  traversal, absolute paths and links are refused for the whole archive. Every skill is scanned before
  install (size and file-count limits, symlinks, downloads piped into shells, credential paths,
  `.env` reads, uploads, prompt-injection phrases, hidden characters) and the findings are shown in a
  modal you must confirm; high findings need a second confirmation. The installer never runs anything
  from a skill. Installing into a project requires a trusted workspace.
- **Context outside the workspace** is limited to instruction files, memory, commands and skills under
  `~/.gisoo`, `~/.claude`, `~/.agents` and `~/.codex`. `@path` imports in instruction files may point
  only into the workspace, `~/.gisoo` or `~/.claude`. Claude Code memory is read-only; nothing is
  written into `~/.claude`. Memory refuses text that looks like a key, token, password or card number.
- **Custom commands** (`.gisoo/commands`, `.claude/commands`) are plain prompt text: shell lines
  (`` !`cmd` ``) are shown, never executed. `.mcp.json` and hooks are not loaded.
