/**
 * Graph tools (SPEC-phase2 §9): graph_query, graph_explain, graph_path, graph_affected. Read-only,
 * no approval. Each runs the `graphify` CLI with a fixed argument list when it is installed and
 * falls back to reading graphify-out/graph.json. Answers are capped by the budget and marked when cut.
 */
import * as fs from 'node:fs/promises';
import { runArgv } from '../tools/argv';
import type { Tool } from '../tools/types';
import {
  affectedBy,
  capToBudget,
  clampBudget,
  cleanGraphArg,
  explainSymbol,
  GRAPH_BUDGET_CAP,
  indexGraph,
  parseGraph,
  pathBetween,
  queryGraph,
  type GraphIndex,
} from './query';
import { graphInfo, type GraphInfo } from './status';

export { clampBudget, cleanGraphArg, GRAPH_BUDGET_CAP, GRAPH_MAX_ARG } from './query';

export const GRAPH_CLI_TIMEOUT_MS = 90_000;
export const GRAPH_FILE_MAX_BYTES = 200 * 1024 * 1024;

/** What the tools need from the graph manager; kept as an interface so the tools stay testable. */
export interface GraphAccess {
  /** The workspace folder the graph belongs to (the primary root). */
  root(): string | undefined;
  /** Path of the graphify executable when detected. */
  cli(): string | undefined;
  /** Token budget from settings (already clamped). */
  budget(): number;
  /** A one-line note when the graph is older than the code, else undefined. */
  staleNote(root: string): Promise<string | undefined>;
}

/** Appended to the system prompt while a graph is ready (SPEC-phase2 §9). */
export const GRAPH_PROMPT = [
  '## Code graph',
  'A Graphify code graph of this workspace is ready. Ask it before grepping or reading many files:',
  '`graph_query` for "where/how is X done", `graph_explain` for one symbol, `graph_path` for how two',
  'symbols connect. Run `graph_affected` before changing a widely used symbol.',
].join('\n');

interface IndexCache {
  mtimeMs: number;
  index: GraphIndex;
}
const indexCache = new Map<string, IndexCache>();

/** Loads and indexes graph.json (cached by mtime). Undefined when there is no graph. */
export async function loadGraphIndex(root: string, info?: GraphInfo): Promise<GraphIndex | undefined> {
  const g = info ?? (await graphInfo(root));
  if (!g.exists) return undefined;
  const hit = indexCache.get(root);
  if (hit && hit.mtimeMs === g.mtimeMs) return hit.index;
  const st = await fs.stat(g.file);
  if (st.size > GRAPH_FILE_MAX_BYTES) return undefined;
  const raw: unknown = JSON.parse(await fs.readFile(g.file, 'utf8'));
  const index = indexGraph(parseGraph(raw));
  indexCache.set(root, { mtimeMs: g.mtimeMs, index });
  return index;
}

export function invalidateGraphIndex(root?: string): void {
  if (root) indexCache.delete(root);
  else indexCache.clear();
}

/** One-line summary for project_map: size, commit, most connected nodes. */
export async function graphSummary(root: string): Promise<string | undefined> {
  const index = await loadGraphIndex(root);
  if (!index) return undefined;
  const degree = new Map<string, number>();
  for (const e of index.graph.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const top = [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([id, d]) => `${index.byId.get(id)?.label ?? id} (${d})`);
  const commit = index.graph.builtAtCommit ? `, built at ${index.graph.builtAtCommit.slice(0, 7)}` : '';
  return `${index.graph.nodes.length} nodes, ${index.graph.edges.length} edges${commit}\nmost connected: ${top.join(', ')}\nuse graph_query / graph_explain / graph_affected for details`;
}

type Runner = (root: string, index: GraphIndex | undefined, budget: number) => Promise<string | undefined> | string | undefined;

/** Shared flow: run the CLI with fixed argv, fall back to the JSON index, cap, mark stale. */
async function answer(access: GraphAccess, cliArgs: string[] | undefined, budget: number, fallback: Runner, signal: AbortSignal): Promise<{ content: string; isError?: boolean }> {
  const root = access.root();
  if (!root) return { content: 'No workspace folder is open.', isError: true };
  const info = await graphInfo(root);
  const cli = access.cli();
  if (!info.exists && !cli) return { content: 'No code graph: Graphify is not installed and graphify-out/graph.json does not exist. Run "Gisoo: Rebuild code graph" or use search_text.', isError: true };
  if (!info.exists) return { content: 'The code graph has not been built yet. Run "Gisoo: Rebuild code graph" (it may take a minute), or use search_text meanwhile.', isError: true };
  let text: string | undefined;
  if (cli && cliArgs) {
    const result = await runArgv(cli, cliArgs, { cwd: root, signal, timeoutMs: GRAPH_CLI_TIMEOUT_MS });
    if (result.exitCode === 0 && result.output.trim()) text = result.output.trim();
  }
  if (!text) {
    let index: GraphIndex | undefined;
    try {
      index = await loadGraphIndex(root, info);
    } catch (error) {
      return { content: `graph.json could not be read: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }
    text = await fallback(root, index, budget);
  }
  if (!text) return { content: 'The graph has no answer for that; try another name or search_text.' };
  const stale = await access.staleNote(root);
  return { content: `${stale ? `${stale}\n` : ''}${capToBudget(text, budget)}` };
}

interface QueryInput {
  question: string;
  budget?: number;
}
interface SymbolInput {
  symbol: string;
}
interface PathInput {
  from: string;
  to: string;
}

/** Builds the four tools bound to a GraphAccess (the manager, or a stub in tests). */
export function createGraphTools(access: GraphAccess): Tool[] {
  const asTool = <T,>(tool: Tool<T>): Tool => tool as unknown as Tool;

  const graphQuery: Tool<QueryInput> = {
    name: 'graph_query',
    description: 'Ask the code graph a question in words ("where is auth handled", "what calls parseConfig"). Returns the relevant symbols, files and relations. Use it before grepping.',
    permission: 'read',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question or topic' },
        budget: { type: 'integer', minimum: 200, maximum: GRAPH_BUDGET_CAP, description: 'Answer size in tokens (default from settings)' },
      },
      required: ['question'],
      additionalProperties: false,
    },
    title: (input) => `Graph: ${cleanGraphArg(input.question)}`,
    async run(input, ctx) {
      const q = cleanGraphArg(input.question);
      if (!q) return { content: 'question is required', isError: true };
      const budget = clampBudget(input.budget, access.budget());
      return answer(access, ['query', q, '--budget', String(budget)], budget, (_root, index) => (index ? queryGraph(index, q, budget) : undefined), ctx.signal);
    },
  };

  const graphExplain: Tool<SymbolInput> = {
    name: 'graph_explain',
    description: 'Explain one symbol, file or concept from the code graph: what it is, what it uses, what uses it.',
    permission: 'read',
    readOnly: true,
    parameters: { type: 'object', properties: { symbol: { type: 'string', description: 'Symbol, file or concept name' } }, required: ['symbol'], additionalProperties: false },
    title: (input) => `Graph explain ${cleanGraphArg(input.symbol)}`,
    async run(input, ctx) {
      const s = cleanGraphArg(input.symbol);
      if (!s) return { content: 'symbol is required', isError: true };
      const budget = access.budget();
      return answer(access, ['explain', s], budget, (_root, index) => (index ? explainSymbol(index, s, budget) : undefined), ctx.signal);
    },
  };

  const graphPath: Tool<PathInput> = {
    name: 'graph_path',
    description: 'How two symbols or files connect: the shortest chain of relations in the code graph between them.',
    permission: 'read',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: { from: { type: 'string', description: 'Start symbol or file' }, to: { type: 'string', description: 'End symbol or file' } },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    title: (input) => `Graph path ${cleanGraphArg(input.from)} -> ${cleanGraphArg(input.to)}`,
    async run(input, ctx) {
      const a = cleanGraphArg(input.from);
      const b = cleanGraphArg(input.to);
      if (!a || !b) return { content: 'from and to are required', isError: true };
      const budget = access.budget();
      return answer(access, ['path', a, b], budget, (_root, index) => (index ? pathBetween(index, a, b, budget) : undefined), ctx.signal);
    },
  };

  const graphAffected: Tool<SymbolInput> = {
    name: 'graph_affected',
    description: 'Everything that depends on a symbol, directly and transitively. Run it before changing a widely used function, class or file.',
    permission: 'read',
    readOnly: true,
    parameters: { type: 'object', properties: { symbol: { type: 'string', description: 'The symbol or file you intend to change' } }, required: ['symbol'], additionalProperties: false },
    title: (input) => `Graph affected by ${cleanGraphArg(input.symbol)}`,
    async run(input, ctx) {
      const s = cleanGraphArg(input.symbol);
      if (!s) return { content: 'symbol is required', isError: true };
      const budget = access.budget();
      return answer(access, ['affected', s, '--depth', '4'], budget, (_root, index) => (index ? affectedBy(index, s, budget) : undefined), ctx.signal);
    },
  };

  return [asTool(graphQuery), asTool(graphExplain), asTool(graphPath), asTool(graphAffected)];
}
