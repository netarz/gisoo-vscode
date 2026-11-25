# Changelog

All notable changes to Gisoo for VS Code are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses semantic versioning.

## [Unreleased]

## [1.1.0] - 2026-11-26

Gisoo where you work: on an error, on a selection, in the terminal and in Source Control.

### Added
- Lightbulb: "Fix with Gisoo" and "Explain with Gisoo" on every error and warning. The problem and
  its lines go to the chat; the fix comes back as a diff you approve.
- Selection menu: right-click selected code → Gisoo → Explain, Refactor, Write Tests, Add Documentation.
- Terminal: select output, right-click → "Ask Gisoo About This Output". Colour codes are removed and
  long output keeps its end, where the error is.
- Source Control: "Write Commit Message with Gisoo" reads the staged changes (all changes when
  nothing is staged), follows the style of your recent commits and writes straight into the message
  box. Large diffs are clipped per file so one generated file cannot push the others out.
- Source Control: "Review My Changes with Gisoo" lists bugs, security problems, missed edge cases and
  missing tests before you commit, and changes nothing until you ask.
- A getting-started walkthrough in English and Persian.

### Changed
- The browser sign-in names the desktop app when it runs inside Gisoo Desktop, and a host can hide
  tools per workspace.

## [1.0.6] - 2026-11-17

### Added
- Search in the chat history: type to filter by title, and Gisoo also looks inside the messages of
  every saved chat, showing the matching line under the title with the words highlighted. Search
  treats Arabic and Persian letters, Persian digits, case and the half-space alike.
- Each chat in the history shows the mark of the system it was started in: Gisoo, or Claude Code,
  Codex, GitHub Copilot, Gemini CLI, Cline, Roo Code or Kilo Code for chats continued from them.
  Chips above the list filter by system.
- Model search also matches the brand name and ignores separators (`gpt4o` finds `gpt-4o`);
  models whose name starts with what you typed come first.

### Fixed
- Chats from GitHub Copilot, Gemini CLI, Cline, Roo Code and Kilo Code did not open when picked
  in the history (only Claude Code and Codex chats were accepted).

### Changed
- The chat history opens faster with many chats: a chat file is read again only when it changed.

## [1.0.5] - 2026-11-16

### Added
- Chats from more AI coding tools can be continued in Gisoo: GitHub Copilot Chat (VS Code, Insiders
  and VSCodium), Gemini CLI, Cline, Roo Code and Kilo Code, next to Claude Code and Codex. Chats of
  the open folder are listed in the chat history, one group per tool, and a copy opens as a new
  Gisoo chat; the original chat is never changed. Only your messages and the replies are read: tool
  calls, reasoning, injected context and attached file contents are left out.

## [1.0.4] - 2026-11-16

### Added
- Voice input: the microphone button in the chat records on the extension host (PowerShell on Windows, arecord, sox or ffmpeg elsewhere) and turns speech into text through the Gisoo gateway; the text joins the message box. Escape cancels a recording.

## [1.0.3] - 2026-11-16

### Added
- Continue Claude Code and Codex chats of the same project in Gisoo: they are listed in the chat
  history (setting `gisoo.importExternalChats`) and a copy opens as a new Gisoo chat; the original
  chat is never changed.

## [1.0.2] - 2026-11-16

### Added
- The chat can sit on the right (default), on the left or at the bottom: setting `gisoo.chatLocation`
  and the "Move chat" command.
- Chats in editor tabs: "New chat in a tab" opens a full chat with its own conversation, so several
  tasks can run side by side; tabs survive a window reload.
- The model picker groups models by company, with each company's mark, and a row of company chips
  to show only one company's models. The current model's mark is shown in the header.

### Changed
- Money is shown only in Gisoo coins, everywhere: the header, the account panel, costs of turns and
  agents, the status bar and the sign-in message. `gisoo.maxCostPerTask` is now in coins.
- The status bar shows only the Gisoo coin and the balance.
- The Gisoo coin is the Gisoo mark inside a ring.

### Fixed
- "n.toFixed is not a function" after sign-in when the server sent amounts as text.

## [1.0.1] - 2026-11-16

### Fixed
- Sign-in with Gisoo: the code from the web page was refused with "Start Sign in with Gisoo first" after
  the window reloaded, after five minutes, or when the browser answered another window. A sign-in in
  progress is now kept in the editor's secret storage for 15 minutes and any window can finish it.
- The Persian panel showed about a hundred texts in English; every panel text now has a Persian version.
- Choosing "Copy" instead of "Open" in VS Code's link dialog ended the sign-in, so the code from a phone
  or another browser was refused with "No sign-in is waiting for a code". The sign-in now stays open.

### Added
- Bypass permissions mode: edits and commands run without asking; irreversible commands (rm -rf,
  force push, sudo, publish) still ask. Turning it on asks for confirmation once per window.
- A live working line under every running turn: the animated Gisoo mark, a changing verb (or the tool
  that is running), seconds elapsed, tokens streamed so far and "esc to stop". If nothing arrives for
  25 seconds it says the model is slow, so a long wait no longer looks like a freeze.

### Changed
- The sign-in card is minimal, with the Gisoo mark and a field for the code right in the panel:
  paste the code and it signs in. Errors (wrong, used or expired code) are shown on the card.
- While a sign-in waits, the card offers "Copy link" (to open the page on a phone or another browser)
  and "Open the page", which reopens the same page instead of starting a new sign-in.
- "Enter sign-in code" accepts the whole callback URL as well as the code.

## [1.0.3] - 2026-11-16

- Instruction files: `GISOO.md` (user, project, local) with `@path` imports; `CLAUDE.md`,
  `AGENTS.md`, `.cursorrules` and `.windsurfrules` are read too.
- Memory: `~/.gisoo/projects/<slug>/memory` with a `memory` tool, `#text` quick notes, `/memory`,
  project memory in `.gisoo/memory`, and import of Claude Code memory.
- Custom slash commands from `.gisoo/commands` and `.claude/commands` (project and user).
- Skills: catalogue from `~/.gisoo/skills`, `.claude/skills` and friends, a `skill` tool, `/skills`,
  and "Gisoo: Install skill" from a folder, archive or GitHub with a safety scan and confirmation.

## [1.0.0] - 2026-11-12

First release.

- Agentic chat in the sidebar or an editor tab: plans with a visible to-do list, reads, searches,
  edits files and runs commands step by step.
- Queue or steer: messages sent during a run join the conversation at the next step; queued
  messages can be edited or removed.
- Permission modes Ask, Auto-edit and Plan; diff review with Accept / Reject; per-command approval
  with "always allow" prefixes.
- Checkpoints: restore the files a turn changed.
- Sign in with a Gisoo account (PKCE + one-time code) or with an API key; the key is kept in
  SecretStorage.
- Account balance in the chat header and status bar; estimated cost per turn.
- Model picker over every Gisoo chat model that supports tools, with "Gisoo Auto".
- `@` file mentions, selection and image attachments, slash commands, code actions.
- Conversation history and automatic compaction of long chats.
- English and Persian UI.
