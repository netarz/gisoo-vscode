# Changelog

All notable changes to Gisoo for VS Code are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses semantic versioning.

## [Unreleased]

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
