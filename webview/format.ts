import { formatCoinNumber, formatCoins, formatCoinsCompact, formatUsdAsCoins, localDigits, usdToCoins, type CoinLanguage } from '../src/shared/coins';

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

/*
 * Money is shown only as Gisoo coins. Costs are tracked in USD inside the extension; the store keeps
 * the coin rate (from /me) and the UI language here so every formatter can convert without props.
 */
let coinRate: number | undefined;
let coinLang: CoinLanguage = 'en';

export function setCoinContext(rate: number | undefined, lang: CoinLanguage): void {
  coinRate = rate;
  coinLang = lang;
}

/** A USD cost as Gisoo coins: «۱۲ سکه» / "12 coins"; a dash while the rate is unknown. */
export function formatCost(usd: number | undefined): string {
  return formatUsdAsCoins(usd, coinRate, coinLang);
}

/** Coins as a bare number for places that draw the coin icon beside it. */
export function formatCoinAmount(coins: number | undefined): string {
  return coins === undefined || !Number.isFinite(coins) ? '–' : formatCoinNumber(coins, coinLang);
}

/** Coins with the word: «۱۲ سکه» / "12 coins". */
export function formatCoinText(coins: number | undefined): string {
  return formatCoins(coins, coinLang);
}

/** Price per million tokens in coins, compact: "330K" / «۳۳۰ هزار». */
export function formatPerMillion(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd)) return '–';
  if (usd === 0) return localDigits('0', coinLang);
  return formatCoinsCompact(usdToCoins(usd, coinRate), coinLang);
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
