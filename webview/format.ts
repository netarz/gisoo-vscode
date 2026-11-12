/** Small, locale-neutral formatters. Digits stay Latin so numbers read the same in both UIs. */

export function formatTokens(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) {
    return '–';
  }
  if (n < 1000) {
    return String(n);
  }
  if (n < 10_000) {
    return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  if (n < 1_000_000) {
    return `${Math.round(n / 1000)}K`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** Context window size: 200000 -> "200K", 1048576 -> "1M". */
export function formatContext(n: number | undefined): string {
  if (!n) {
    return '';
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (n >= 1000) {
    return `${Math.round(n / 1000)}K`;
  }
  return String(n);
}

/** USD with a sensible number of decimals: $0.0123, $0.42, $12.50. */
export function formatUsd(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd)) {
    return '–';
  }
  const abs = Math.abs(usd);
  let digits = 2;
  if (abs > 0 && abs < 0.01) {
    digits = 4;
  } else if (abs < 1) {
    digits = 3;
  }
  return `$${usd.toFixed(digits)}`;
}

/** Price per million tokens: 3 -> "$3", 0.15 -> "$0.15", 0.0375 -> "$0.04". */
export function formatPerMillion(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd)) {
    return '–';
  }
  if (usd === 0) {
    return '$0';
  }
  if (usd >= 1) {
    return `$${Number.isInteger(usd) ? usd : usd.toFixed(2).replace(/0$/, '')}`;
  }
  return `$${usd.toFixed(usd < 0.1 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) {
    return '';
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1).replace(/\.0$/, '')} s`;
  }
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m} min ${s} s`;
}

export function formatPercent(fraction: number): string {
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  return `${pct}%`;
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** The first "word" of a shell command, for the "Always allow" button. */
export function commandWord(command: string): string {
  const trimmed = command.trim();
  const match = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(\S+)/.exec(trimmed);
  return match ? match[1] : trimmed;
}

export function clampText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
