/** Tools `preview` and `screenshot` (SPEC-phase2 §4) and the web-work prompt section. */
import type { Tool } from '../tools/types';
import { previewManager } from './manager';
import { isLocalUrl } from './server';

interface PreviewInput {
  path: string;
}

interface ScreenshotInput {
  path?: string;
  url?: string;
  width?: number;
  height?: number;
  wait_ms?: number;
}

export const previewTool: Tool<PreviewInput> = {
  name: 'preview',
  description:
    'Serve a workspace HTML file (or folder with index.html) on a local 127.0.0.1 server with live reload and open it in the editor\'s browser. Returns the URL.',
  permission: 'read',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Workspace-relative path of the HTML file or folder' } },
    required: ['path'],
    additionalProperties: false,
  },
  title: (input) => `Preview ${input.path}`,
  async run(input) {
    const target = (input.path ?? '').trim();
    if (!target) return { content: 'path is required', isError: true };
    const { url, relative } = await previewManager().urlFor(target);
    await previewManager().open(url);
    return { content: `Preview of ${relative} is open at ${url} (reloads on save).`, display: url };
  },
};

function clampSide(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(4000, Math.max(200, n));
}

export const screenshotTool: Tool<ScreenshotInput> = {
  name: 'screenshot',
  description:
    'Render a workspace HTML file or a local http(s)://127.0.0.1|localhost URL in a headless browser and save a PNG. ' +
    'Returns the PNG path; use it to check your own page or animation. Starts a browser process.',
  permission: 'command',
  readOnly: false,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative HTML file (served by the preview server)' },
      url: { type: 'string', description: 'Local URL (127.0.0.1 or localhost only)' },
      width: { type: 'integer', minimum: 200, maximum: 4000, description: 'Viewport width (default 1280)' },
      height: { type: 'integer', minimum: 200, maximum: 4000, description: 'Viewport height (default 800)' },
      wait_ms: { type: 'integer', minimum: 0, maximum: 30000, description: 'Virtual time to let scripts and animations run (default 1500)' },
    },
    additionalProperties: false,
  },
  title: (input) => `Screenshot ${input.url ?? input.path ?? ''}`.trim(),
  async run(input, ctx) {
    const file = (input.path ?? '').trim();
    let url = (input.url ?? '').trim();
    if (!file && !url) return { content: 'Give either path (a workspace file) or url (a local URL).', isError: true };
    if (url && !isLocalUrl(url)) return { content: 'Only http(s) URLs on 127.0.0.1 or localhost can be captured.', isError: true };
    if (!url) url = (await previewManager().urlFor(file)).url;
    const width = clampSide(input.width, 1280);
    const height = clampSide(input.height, 800);
    const waitMs = typeof input.wait_ms === 'number' && Number.isFinite(input.wait_ms) ? Math.min(30_000, Math.max(0, Math.floor(input.wait_ms))) : 1500;
    const shot = await previewManager().screenshot(url, width, height, waitMs, ctx.signal);
    return {
      content: `Screenshot of ${url} (${width}x${height}) saved to ${shot.file}. Read it with read_file only if the model can see images; otherwise describe what the page should show and check the DOM instead.`,
      display: shot.file,
      view: { command: { command: `screenshot ${url}`, cwd: '.', exitCode: 0 } },
    };
  },
};

/** Appended to the system prompt (SPEC-phase2 §4). */
export const WEB_WORK_PROMPT = [
  '## Web pages and animation',
  '- Without a framework in the project, produce self-contained HTML/CSS/JS files. With one, follow it.',
  '- Prefer CSS, the Web Animations API, SVG and Canvas; three.js only from a local npm install or a pinned CDN URL the user accepts.',
  '- Respect prefers-reduced-motion. Persian pages: dir="rtl", lang="fa", logical CSS properties.',
  '- Check your result: `preview` opens the page with live reload; `screenshot` renders it headless so you can verify it.',
].join('\n');
