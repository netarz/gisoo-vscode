/**
 * Gisoo shows money only as Gisoo coins («سکه»), never as dollars or any other currency. The API
 * still prices in USD; `/me` sends `coin_rate` (coins per USD) and every amount is converted here,
 * rounded up the way the site rounds (App\Support\Gisoo\Coins::fromMicroUsd). Shared by the host and
 * the webview, so it must stay free of vscode and DOM imports.
 */
export type CoinLanguage = 'en' | 'fa';

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** A number from the API, which sometimes arrives as a string ("12.408114"). */
export function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** USD amount -> whole coins (rounded up, like the site). Undefined when either side is unknown. */
export function usdToCoins(usd: unknown, rate: unknown): number | undefined {
  const amount = toNumber(usd);
  const perUsd = toNumber(rate);
  if (amount === undefined || perUsd === undefined || perUsd <= 0) return undefined;
  if (amount <= 0) return 0;
  return Math.ceil(amount * perUsd - 1e-9);
}

/** Coins -> USD, for comparing a coin limit with costs that are tracked in USD. */
export function coinsToUsd(coins: number, rate: unknown): number | undefined {
  const perUsd = toNumber(rate);
  if (!Number.isFinite(coins) || perUsd === undefined || perUsd <= 0) return undefined;
  return coins / perUsd;
}

export function localDigits(text: string, lang: CoinLanguage): string {
  return lang === 'fa' ? text.replace(/\d/g, (d) => FA_DIGITS[Number(d)]).replace(/,/g, '٬').replace(/\./g, '٫') : text;
}

/** "12,345" / «۱۲٬۳۴۵». */
export function formatCoinNumber(coins: number, lang: CoinLanguage): string {
  const whole = Math.max(0, Math.round(coins));
  return localDigits(whole.toLocaleString('en-US'), lang);
}

/** "12,345 coins" / «۱۲٬۳۴۵ سکه»; a dash when the amount is unknown. */
export function formatCoins(coins: number | undefined, lang: CoinLanguage): string {
  if (coins === undefined || !Number.isFinite(coins)) return '–';
  const n = formatCoinNumber(coins, lang);
  if (lang === 'fa') return `${n} سکه`;
  return `${n} ${Math.round(coins) === 1 ? 'coin' : 'coins'}`;
}

/** USD straight to the coin text. */
export function formatUsdAsCoins(usd: unknown, rate: unknown, lang: CoinLanguage): string {
  return formatCoins(usdToCoins(usd, rate), lang);
}

/** Short form for tight places such as model prices: "330K", "1.7M" / «۳۳۰ هزار»، «۱٫۷ میلیون». */
export function formatCoinsCompact(coins: number | undefined, lang: CoinLanguage): string {
  if (coins === undefined || !Number.isFinite(coins)) return '–';
  const trim = (n: number): string => n.toFixed(n >= 100 ? 0 : 1).replace(/\.0$/, '');
  let text: string;
  if (coins >= 1_000_000) text = lang === 'fa' ? `${trim(coins / 1_000_000)} میلیون` : `${trim(coins / 1_000_000)}M`;
  else if (coins >= 10_000) text = lang === 'fa' ? `${trim(coins / 1000)} هزار` : `${trim(coins / 1000)}K`;
  else text = Math.round(coins).toLocaleString('en-US');
  return localDigits(text, lang);
}
