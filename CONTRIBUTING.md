# Contributing

Thank you for helping. Issues and pull requests are welcome at
[github.com/netarz/gisoo-vscode](https://github.com/netarz/gisoo-vscode).

## Setup

```bash
git clone https://github.com/netarz/gisoo-vscode.git
cd gisoo-vscode
npm install
npm run build
```

Open the folder in VS Code and press `F5` to run the extension in a development host.

## Before you open a pull request

```bash
npm run typecheck
npm run lint
npm run test:unit
npm test
```

Tests never call the real Gisoo API: integration tests run against the mock server in `test/`.

## Layout

- `src/` — extension host: API client, agent loop, tools, sign-in, sessions, UI providers.
- `src/shared/protocol.ts` — the message contract between the host and the chat UI. Change it
  first, then both sides.
- `webview/` — the chat UI (Preact), bundled into `media/webview.js`.
- `l10n/`, `package.nls*.json` — English and Persian strings. User-facing text lives there, not in code.

## Rules

- Strict TypeScript; no new runtime dependencies without a reason in the pull request.
- No telemetry, analytics or calls to any host other than the configured API.
- No emoji in the UI or docs; icons come from codicons.
- Keep secrets out of logs, settings and session files.
