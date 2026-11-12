/**
 * Fallback queries over `graphify-out/graph.json` when the `graphify` CLI is not available
 * (SPEC-phase2 §9). Pure: no VS Code, no fs. Accepts the two shapes graphify has used:
 * `{ nodes: [...], links: [...] }` and `{ nodes: [...], edges: [...] }`; node ids are strings,
 * labels live in `label` / `name` / `id`; edges have `source`/`target` (or `from`/`to`).
 */

export interface GraphNode {
  id: string;
  label: string;
  type?: string;
  file?: string;
  community?: string | number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  builtAtCommit?: string;
  builtAt?: string;
}

/** Rough token estimate used for budgets: 4 characters per token. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const TRUNCATION_MARK = '[truncated to the graph budget; ask a narrower question or raise gisoo.graphify.budget]';

/** Cuts the text to `budgetTokens` and appends the truncation mark when something was dropped. */
export function capToBudget(text: string, budgetTokens: number): string {
  const maxChars = Math.max(200, Math.floor(budgetTokens * 4));
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastLine = cut.lastIndexOf('\n');
  return `${lastLine > maxChars / 2 ? cut.slice(0, lastLine) : cut}\n${TRUNCATION_MARK}`;
}

export const GRAPH_MAX_ARG = 300;
export const GRAPH_BUDGET_CAP = 4000;
export const GRAPH_BUDGET_MIN = 200;

/** Trims, collapses whitespace, caps the length and removes a leading dash so it can never be a flag. */
export function cleanGraphArg(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().replace(/^-+/, '').slice(0, GRAPH_MAX_ARG);
}

/** The budget the tool will use: the given number when sane, else the fallback, always within the cap. */
export function clampBudget(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(GRAPH_BUDGET_CAP, Math.max(GRAPH_BUDGET_MIN, n));
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
}

/** Parses a graph.json object (already JSON.parse'd). Unknown shapes give an empty graph. */
export function parseGraph(raw: unknown): Graph {
  const g: Graph = { nodes: [], edges: [] };
  if (!raw || typeof raw !== 'object') return g;
  const o = raw as Record<string, unknown>;
  const rawNodes = Array.isArray(o.nodes) ? o.nodes : [];
  const seen = new Set<string>();
  for (const n of rawNodes) {
    if (!n || typeof n !== 'object') continue;
    const r = n as Record<string, unknown>;
    const id = str(r.id) ?? str(r.name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const attrs = r.attributes && typeof r.attributes === 'object' ? (r.attributes as Record<string, unknown>) : {};
    g.nodes.push({
      id,
      label: str(r.label) ?? str(r.name) ?? str(attrs.label) ?? id,
      type: str(r.type) ?? str(r.kind) ?? str(attrs.type),
      file: str(r.file) ?? str(r.path) ?? str(r.source_file) ?? str(attrs.file) ?? str(attrs.source_file),
      community: str(r.community) ?? str(attrs.community),
    });
  }
  const rawEdges = Array.isArray(o.links) ? o.links : Array.isArray(o.edges) ? o.edges : [];
  for (const e of rawEdges) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const source = str(r.source) ?? str(r.from);
    const target = str(r.target) ?? str(r.to);
    if (!source || !target) continue;
    g.edges.push({ source, target, relation: str(r.relation) ?? str(r.type) ?? str(r.label) });
  }
  const meta = o.metadata && typeof o.metadata === 'object' ? (o.metadata as Record<string, unknown>) : o;
  g.builtAtCommit = str(meta.built_at_commit) ?? str(meta.builtAtCommit) ?? str(meta.commit);
  g.builtAt = str(meta.built_at) ?? str(meta.builtAt) ?? str(meta.generated_at);
  return g;
}

export interface GraphIndex {
  graph: Graph;
  byId: Map<string, GraphNode>;
  out: Map<string, GraphEdge[]>;
  in: Map<string, GraphEdge[]>;
}

export function indexGraph(graph: Graph): GraphIndex {
  const byId = new Map<string, GraphNode>();
  for (const n of graph.nodes) byId.set(n.id, n);
  const out = new Map<string, GraphEdge[]>();
  const inc = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source)!.push(e);
    if (!inc.has(e.target)) inc.set(e.target, []);
    inc.get(e.target)!.push(e);
  }
  return { graph, byId, out, in: inc };
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_؀-ۿ]+/)
    .filter((t) => t.length > 1);
}

/** Scores a node against a free-text question: exact label, label contains, token overlap. */
export function scoreNode(node: GraphNode, query: string, queryTokens: string[]): number {
  const label = node.label.toLowerCase();
  const id = node.id.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  if (label === q || id === q) return 100;
  let score = 0;
  if (label.includes(q) || id.includes(q)) score += 40;
  const hay = new Set(tokens(`${node.label} ${node.id} ${node.file ?? ''}`));
  for (const t of queryTokens) if (hay.has(t)) score += 10;
  if (node.type === 'file' || node.type === 'module') score -= 2;
  return score;
}

/** Nodes whose label or id match `term` best, highest score first. */
export function findNodes(index: GraphIndex, term: string, limit = 5): GraphNode[] {
  const qt = tokens(term);
  return index.graph.nodes
    .map((n) => ({ n, s: scoreNode(n, term, qt) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.n.label.localeCompare(b.n.label))
    .slice(0, limit)
    .map((x) => x.n);
}

function describe(node: GraphNode): string {
  const parts = [node.label];
  if (node.type) parts.push(`(${node.type})`);
  if (node.file) parts.push(`- ${node.file}`);
  return parts.join(' ');
}

/** Neighbours with the edge relation, one line each. */
function neighbourLines(index: GraphIndex, id: string, max: number): string[] {
  const lines: string[] = [];
  for (const e of index.out.get(id) ?? []) {
    const t = index.byId.get(e.target);
    if (t) lines.push(`  -> ${e.relation ? `${e.relation} ` : ''}${describe(t)}`);
    if (lines.length >= max) return lines;
  }
  for (const e of index.in.get(id) ?? []) {
    const s = index.byId.get(e.source);
    if (s) lines.push(`  <- ${e.relation ? `${e.relation} ` : ''}${describe(s)}`);
    if (lines.length >= max) return lines;
  }
  return lines;
}

/** `graph_query`: the best-matching nodes and their immediate neighbours. */
export function queryGraph(index: GraphIndex, question: string, budgetTokens: number): string {
  const hits = findNodes(index, question, 8);
  if (!hits.length) return `No node in the graph matches "${question.trim()}".`;
  const lines: string[] = [`Graph: ${index.graph.nodes.length} nodes, ${index.graph.edges.length} edges. Best matches for "${question.trim()}":`];
  for (const n of hits) {
    lines.push(`- ${describe(n)}`);
    lines.push(...neighbourLines(index, n.id, 12));
  }
  return capToBudget(lines.join('\n'), budgetTokens);
}

/** `graph_explain`: one symbol, every direct relation in both directions. */
export function explainSymbol(index: GraphIndex, symbol: string, budgetTokens: number): string {
  const node = findNodes(index, symbol, 1)[0];
  if (!node) return `No node in the graph matches "${symbol.trim()}".`;
  const lines = [describe(node)];
  const outs = index.out.get(node.id) ?? [];
  const ins = index.in.get(node.id) ?? [];
  lines.push(`Outgoing (${outs.length}):`);
  for (const e of outs) {
    const t = index.byId.get(e.target);
    if (t) lines.push(`  ${e.relation ?? 'uses'} ${describe(t)}`);
  }
  lines.push(`Incoming (${ins.length}):`);
  for (const e of ins) {
    const s = index.byId.get(e.source);
    if (s) lines.push(`  ${describe(s)} ${e.relation ?? 'uses'} this`);
  }
  return capToBudget(lines.join('\n'), budgetTokens);
}

/** BFS over undirected edges; returns the node ids on the shortest path, or undefined. */
export function shortestPath(index: GraphIndex, fromId: string, toId: string, maxDepth = 12): string[] | undefined {
  if (fromId === toId) return [fromId];
  const prev = new Map<string, string | null>([[fromId, null]]);
  let frontier = [fromId];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const around = [...(index.out.get(id) ?? []).map((e) => e.target), ...(index.in.get(id) ?? []).map((e) => e.source)];
      for (const n of around) {
        if (prev.has(n)) continue;
        prev.set(n, id);
        if (n === toId) {
          const out: string[] = [];
          for (let cur: string | null = n; cur !== null; cur = prev.get(cur) ?? null) out.push(cur);
          return out.reverse();
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return undefined;
}

/** `graph_path`: the shortest chain of relations between two symbols. */
export function pathBetween(index: GraphIndex, from: string, to: string, budgetTokens: number): string {
  const a = findNodes(index, from, 1)[0];
  const b = findNodes(index, to, 1)[0];
  if (!a) return `No node in the graph matches "${from.trim()}".`;
  if (!b) return `No node in the graph matches "${to.trim()}".`;
  const ids = shortestPath(index, a.id, b.id);
  if (!ids) return `No path between ${a.label} and ${b.label} within 12 hops.`;
  const lines = [`Path (${ids.length - 1} hops):`];
  for (let i = 0; i < ids.length; i++) {
    const n = index.byId.get(ids[i]);
    if (!n) continue;
    let rel = '';
    if (i > 0) {
      const e = (index.out.get(ids[i - 1]) ?? []).find((x) => x.target === ids[i]) ?? (index.in.get(ids[i - 1]) ?? []).find((x) => x.source === ids[i]);
      rel = e ? ` [${e.relation ?? 'related'}]` : '';
    }
    lines.push(`${i > 0 ? '  -> ' : ''}${describe(n)}${rel}`);
  }
  return capToBudget(lines.join('\n'), budgetTokens);
}

/** `graph_affected`: everything that (transitively) depends on a symbol, grouped by distance. */
export function affectedBy(index: GraphIndex, symbol: string, budgetTokens: number, maxDepth = 4): string {
  const node = findNodes(index, symbol, 1)[0];
  if (!node) return `No node in the graph matches "${symbol.trim()}".`;
  const seen = new Set<string>([node.id]);
  let frontier = [node.id];
  const lines = [`Dependents of ${describe(node)}:`];
  let total = 0;
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of index.in.get(id) ?? []) {
        if (seen.has(e.source)) continue;
        seen.add(e.source);
        next.push(e.source);
      }
    }
    if (!next.length) break;
    total += next.length;
    lines.push(`Distance ${depth} (${next.length}):`);
    for (const id of next) {
      const n = index.byId.get(id);
      if (n) lines.push(`  ${describe(n)}`);
    }
    frontier = next;
  }
  if (!total) lines.push('  (nothing depends on it in the graph)');
  else lines.push(`${total} dependents within ${maxDepth} hops.`);
  return capToBudget(lines.join('\n'), budgetTokens);
}
