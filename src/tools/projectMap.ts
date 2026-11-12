/**
 * `project_map` (SPEC-phase2 §5): folder tree to depth 3, detected stack from manifests, scripts,
 * top-level symbols of the 30 most relevant files; cached for a minute, capped at ~3k tokens.
 * Uses the Graphify graph summary when one exists.
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { topLevelSymbolNames } from './codeIntel';
import type { Tool } from './types';
import { readText, workspaceRoots } from './workspace';

export const PROJECT_MAP_MAX_CHARS = 12_000;
export const PROJECT_MAP_TTL_MS = 60_000;
const TREE_DEPTH = 3;
const MAX_TREE_LINES = 120;
const MAX_SYMBOL_FILES = 30;
const EXCLUDE = '**/{node_modules,.git,dist,out,build,.next,.nuxt,.venv,venv,__pycache__,vendor,coverage,target,bin,obj,.idea,.vscode-test,graphify-out}/**';

/** Supplied by the graph module when a graph exists; keeps this file free of graph imports. */
export type GraphSummaryProvider = (root: string) => Promise<string | undefined>;
let graphSummary: GraphSummaryProvider | undefined;
export function setGraphSummaryProvider(provider: GraphSummaryProvider | undefined): void {
  graphSummary = provider;
}

interface CacheEntry {
  at: number;
  text: string;
}
const cache = new Map<string, CacheEntry>();
export function invalidateProjectMap(): void {
  cache.clear();
}

const MANIFESTS: Array<{ file: string; stack: string }> = [
  { file: 'package.json', stack: 'Node.js' },
  { file: 'composer.json', stack: 'PHP (Composer)' },
  { file: 'pyproject.toml', stack: 'Python (pyproject)' },
  { file: 'requirements.txt', stack: 'Python (requirements)' },
  { file: 'go.mod', stack: 'Go' },
  { file: 'Cargo.toml', stack: 'Rust' },
  { file: 'pom.xml', stack: 'Java (Maven)' },
  { file: 'build.gradle', stack: 'JVM (Gradle)' },
  { file: 'build.gradle.kts', stack: 'JVM (Gradle)' },
  { file: 'Gemfile', stack: 'Ruby' },
  { file: 'pubspec.yaml', stack: 'Dart/Flutter' },
  { file: 'Makefile', stack: 'Make' },
  { file: 'CMakeLists.txt', stack: 'C/C++ (CMake)' },
  { file: 'Dockerfile', stack: 'Docker' },
  { file: 'docker-compose.yml', stack: 'Docker Compose' },
];

const NODE_FRAMEWORKS: Array<[string, string]> = [
  ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['@angular/core', 'Angular'],
  ['preact', 'Preact'], ['express', 'Express'], ['fastify', 'Fastify'], ['nestjs', 'NestJS'], ['@nestjs/core', 'NestJS'],
  ['vite', 'Vite'], ['esbuild', 'esbuild'], ['webpack', 'webpack'], ['typescript', 'TypeScript'], ['three', 'three.js'],
  ['electron', 'Electron'], ['vscode', 'VS Code extension'], ['@types/vscode', 'VS Code extension'], ['tailwindcss', 'Tailwind'],
  ['prisma', 'Prisma'], ['mocha', 'mocha'], ['jest', 'jest'], ['vitest', 'vitest'],
];

function parseJson(text: string | null): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

async function readIfExists(root: string, file: string): Promise<string | null> {
  try {
    return await readText(path.join(root, file));
  } catch {
    return null;
  }
}

async function stackAndScripts(root: string): Promise<{ stack: string[]; scripts: string[] }> {
  const stack: string[] = [];
  const scripts: string[] = [];
  for (const m of MANIFESTS) {
    const text = await readIfExists(root, m.file);
    if (text === null) continue;
    stack.push(m.stack);
    if (m.file === 'package.json' || m.file === 'composer.json') {
      const json = parseJson(text);
      if (!json) continue;
      const deps = { ...(json.dependencies as Record<string, unknown> | undefined), ...(json.devDependencies as Record<string, unknown> | undefined), ...(json.require as Record<string, unknown> | undefined), ...(json['require-dev'] as Record<string, unknown> | undefined) };
      if (m.file === 'package.json') {
        for (const [dep, name] of NODE_FRAMEWORKS) if (dep in deps && !stack.includes(name)) stack.push(name);
      } else {
        for (const dep of Object.keys(deps)) {
          if (dep === 'laravel/framework') stack.push('Laravel');
          else if (dep === 'symfony/framework-bundle') stack.push('Symfony');
        }
      }
      const s = json.scripts;
      if (s && typeof s === 'object') {
        for (const [k, v] of Object.entries(s as Record<string, unknown>).slice(0, 25)) scripts.push(`${k}: ${String(v).replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    } else if (m.file === 'Makefile') {
      for (const line of text.split('\n')) {
        const t = /^([A-Za-z0-9_.-]+)\s*:(?!=)/.exec(line);
        if (t && !t[1].startsWith('.') && scripts.length < 40) scripts.push(`make ${t[1]}`);
      }
    } else if (m.file === 'pyproject.toml') {
      const block = /\[project\.scripts\]([\s\S]*?)(?:\n\[|$)/.exec(text);
      if (block) {
        for (const line of block[1].split('\n')) {
          const kv = /^\s*([A-Za-z0-9_.-]+)\s*=\s*"([^"]+)"/.exec(line);
          if (kv && scripts.length < 40) scripts.push(`${kv[1]}: ${kv[2]}`);
        }
      }
      if (/\[tool\.poetry\]/.test(text)) stack.push('Poetry');
      if (/django/i.test(text)) stack.push('Django');
      if (/fastapi/i.test(text)) stack.push('FastAPI');
    } else if (m.file === 'requirements.txt') {
      if (/^django/im.test(text)) stack.push('Django');
      if (/^fastapi/im.test(text)) stack.push('FastAPI');
      if (/^flask/im.test(text)) stack.push('Flask');
    }
  }
  return { stack: [...new Set(stack)], scripts };
}

interface TreeNode {
  dirs: Map<string, TreeNode>;
  files: string[];
}

function buildTree(relPaths: string[]): TreeNode {
  const rootNode: TreeNode = { dirs: new Map(), files: [] };
  for (const rel of relPaths) {
    const parts = rel.split('/');
    let node = rootNode;
    for (let i = 0; i < parts.length - 1 && i < TREE_DEPTH; i++) {
      let next = node.dirs.get(parts[i]);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        node.dirs.set(parts[i], next);
      }
      node = next;
    }
    if (parts.length <= TREE_DEPTH) node.files.push(parts[parts.length - 1]);
    else node.files.push('…');
  }
  return rootNode;
}

function renderTree(node: TreeNode, indent: string, lines: string[]): void {
  const dirs = [...node.dirs.keys()].sort();
  for (const d of dirs) {
    if (lines.length >= MAX_TREE_LINES) return;
    const child = node.dirs.get(d)!;
    const fileCount = child.files.filter((f) => f !== '…').length;
    lines.push(`${indent}${d}/${fileCount > 6 ? `  (${fileCount} files)` : ''}`);
    renderTree(child, `${indent}  `, lines);
    if (fileCount <= 6) {
      for (const f of [...new Set(child.files)].sort()) {
        if (lines.length >= MAX_TREE_LINES) return;
        lines.push(`${indent}  ${f}`);
      }
    }
  }
}

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.cs', '.php', '.rb', '.swift', '.dart', '.vue', '.svelte', '.c', '.cc', '.cpp', '.h', '.hpp']);
const ENTRY_HINT = /^(index|main|app|server|extension|cli|routes?|api|core|runner|controller|model|service|store|config)\b/i;

/** Relevance: entry-like names first, then shallow source files. */
function relevance(rel: string): number {
  const base = path.posix.basename(rel);
  const ext = path.posix.extname(base).toLowerCase();
  if (!SOURCE_EXT.has(ext)) return -1;
  if (/\.(test|spec|d)\.[a-z]+$/i.test(base) || /(^|\/)(test|tests|__tests__|spec)\//.test(rel)) return 0;
  let score = 10 - Math.min(8, rel.split('/').length);
  if (ENTRY_HINT.test(base)) score += 5;
  if (/^(src|lib|app|internal|pkg|cmd)\//.test(rel)) score += 2;
  return score;
}

export async function buildProjectMap(root: string): Promise<string> {
  const folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === root);
  const uris = await vscode.workspace.findFiles(folder ? new vscode.RelativePattern(folder, '**/*') : '**/*', EXCLUDE, 5000);
  const rels = uris.map((u) => path.relative(root, u.fsPath).split(path.sep).join('/')).filter((r) => r && !r.startsWith('..')).sort();
  const { stack, scripts } = await stackAndScripts(root);
  const lines: string[] = [`# ${path.basename(root)} (${rels.length}${uris.length >= 5000 ? '+' : ''} files)`];
  lines.push(`Stack: ${stack.length ? stack.join(', ') : 'unknown (no manifest found)'}`);
  if (scripts.length) lines.push('Scripts:', ...scripts.map((s) => `  ${s}`));
  const graph = graphSummary ? await graphSummary(root).catch(() => undefined) : undefined;
  if (graph) lines.push('Code graph (Graphify):', ...graph.split('\n').map((l) => `  ${l}`));
  lines.push('Tree (depth 3):');
  const treeLines: string[] = [];
  renderTree(buildTree(rels), '  ', treeLines);
  const topFiles = rels.filter((r) => !r.includes('/')).sort();
  lines.push(...topFiles.slice(0, 20).map((f) => `  ${f}`), ...treeLines);
  if (treeLines.length >= MAX_TREE_LINES) lines.push('  [tree truncated]');
  const ranked = rels.map((r) => ({ r, s: relevance(r) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.r.localeCompare(b.r)).slice(0, MAX_SYMBOL_FILES);
  if (ranked.length) {
    lines.push('Top-level symbols:');
    for (const { r } of ranked) {
      const names = await topLevelSymbolNames(path.join(root, r), 10);
      if (names.length) lines.push(`  ${r}: ${names.join(', ')}`);
    }
  }
  let text = lines.join('\n');
  if (text.length > PROJECT_MAP_MAX_CHARS) text = `${text.slice(0, PROJECT_MAP_MAX_CHARS)}\n[project map truncated]`;
  return text;
}

export const projectMapTool: Tool<Record<string, never>> = {
  name: 'project_map',
  description:
    'A compact map of the workspace: detected stack, scripts, folder tree (depth 3), the code graph summary when Graphify built one, and the top-level symbols of the most relevant files. Call it first on an unfamiliar project.',
  permission: 'read',
  readOnly: true,
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  title: () => 'Project map',
  async run() {
    const roots = workspaceRoots();
    if (!roots.length) return { content: 'No workspace folder is open.', isError: true };
    const parts: string[] = [];
    for (const root of roots.slice(0, 3)) {
      const hit = cache.get(root);
      if (hit && Date.now() - hit.at < PROJECT_MAP_TTL_MS) {
        parts.push(hit.text);
        continue;
      }
      const text = await buildProjectMap(root);
      cache.set(root, { at: Date.now(), text });
      parts.push(text);
    }
    const content = parts.join('\n\n');
    return { content, display: `${content.length} chars` };
  },
};
