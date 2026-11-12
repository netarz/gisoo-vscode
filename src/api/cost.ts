/** Cost estimate per turn from /models pricing. Pure. */
import type { ModelInfo, Usage } from '../shared/protocol';
import type { WireUsage } from './types';

export function usageFromWire(wire: WireUsage): Usage {
  return {
    promptTokens: Math.max(0, wire.prompt_tokens ?? 0),
    completionTokens: Math.max(0, wire.completion_tokens ?? 0),
    cachedTokens: Math.max(0, wire.prompt_tokens_details?.cached_tokens ?? 0),
  };
}

/**
 * (prompt - cached) * input + cached * cachedInput + completion * output, all per million tokens.
 * Returns undefined when the model has no input or output price.
 */
export function estimateCostUsd(
  usage: Pick<Usage, 'promptTokens' | 'completionTokens' | 'cachedTokens'>,
  pricing: Pick<ModelInfo, 'inputPerMillion' | 'outputPerMillion' | 'cachedInputPerMillion'> | undefined,
): number | undefined {
  if (!pricing || pricing.inputPerMillion === undefined || pricing.outputPerMillion === undefined) return undefined;
  const cached = Math.min(usage.cachedTokens, usage.promptTokens);
  const uncached = usage.promptTokens - cached;
  const cachedPrice = pricing.cachedInputPerMillion ?? pricing.inputPerMillion;
  const cost =
    (uncached * pricing.inputPerMillion + cached * cachedPrice + usage.completionTokens * pricing.outputPerMillion) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function addUsage(a: Usage | undefined, b: Usage): Usage {
  if (!a) return { ...b };
  const costUsd = a.costUsd === undefined && b.costUsd === undefined ? undefined : (a.costUsd ?? 0) + (b.costUsd ?? 0);
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    costUsd,
  };
}

/** "$0.0123" style, always USD, never a Toman amount. */
export function formatUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}
