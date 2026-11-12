/** Normalises /models into ModelInfo and keeps the recommended list in one place. Pure. */
import type { ModelInfo } from '../shared/protocol';
import type { WireModel } from './types';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const AUTO_MODEL = 'gisoo';

/** Pinned at the top of the picker when present in /models, in this order. */
export const RECOMMENDED_MODELS: readonly string[] = [
  'gisoo',
  'claude-sonnet-5-5',
  'claude-opus-5-5',
  'claude-fable-5-1',
  'gpt-5.6-sol',
  'gpt-5.3-codex',
  'gemini-3.1-pro-preview',
  'deepseek-v4-pro',
  'alibaba/kimi-k2.7-code',
  'alibaba/glm-5.3',
  'qwen3-coder-flash',
  'claude-haiku-5-5',
];

export function isAgentCapable(model: WireModel): boolean {
  const type = (model.type ?? 'chat').toLowerCase();
  return type === 'chat' && model.capabilities?.tools === true;
}

export function toModelInfo(model: WireModel): ModelInfo {
  const name = model.id === AUTO_MODEL ? 'Gisoo Auto' : model.name || model.id;
  return {
    id: model.id,
    name,
    description: model.description || undefined,
    contextLength: positive(model.context_length) ?? 128_000,
    maxOutputTokens: positive(model.max_output_tokens),
    vision: model.capabilities?.vision === true,
    reasoning: model.capabilities?.reasoning === true,
    isFree: model.is_free === true,
    inputPerMillion: price(model.pricing?.input_per_million),
    outputPerMillion: price(model.pricing?.output_per_million),
    cachedInputPerMillion: price(model.pricing?.cached_input_per_million),
    recommended: RECOMMENDED_MODELS.includes(model.id),
  };
}

/** Agent-capable models, recommended ones first (in the pinned order), then alphabetical. */
export function catalogue(models: WireModel[]): ModelInfo[] {
  const infos = models.filter(isAgentCapable).map(toModelInfo);
  const rank = (m: ModelInfo): number => {
    const i = RECOMMENDED_MODELS.indexOf(m.id);
    return i < 0 ? RECOMMENDED_MODELS.length : i;
  };
  return infos.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Fallback used when /models cannot be reached, so the picker is never empty. */
export function fallbackModel(id: string): ModelInfo {
  return {
    id,
    name: id === AUTO_MODEL ? 'Gisoo Auto' : id,
    contextLength: 128_000,
    vision: false,
    reasoning: false,
    isFree: false,
    recommended: RECOMMENDED_MODELS.includes(id),
  };
}

function positive(n: number | undefined): number | undefined {
  return typeof n === 'number' && n > 0 ? n : undefined;
}

function price(n: number | undefined): number | undefined {
  return typeof n === 'number' && n >= 0 ? n : undefined;
}
