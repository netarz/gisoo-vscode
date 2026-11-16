# Changelog

All notable changes to Gisoo for VS Code are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses semantic versioning.

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

## [Unreleased]

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
