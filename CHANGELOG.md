# Changelog

All notable changes to Gisoo for VS Code are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses semantic versioning.

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
