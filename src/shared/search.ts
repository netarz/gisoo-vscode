/**
 * Search helpers shared by the extension host (chat contents) and the webview (titles, models).
 * Pure functions, no Node or DOM.
 *
 * Text is folded so that what people type finds what was written: case, Arabic ي/ك against Persian
 * ی/ک, Persian and Arabic digits, diacritics, tatweel, and the zero-width non-joiner of «می‌خواهم»
 * (typed with or without it). `compact` also drops separators, so «gpt4o» finds `gpt-4o`.
 */

const DROP = /[\u064b-\u0652\u0670\u0640\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;
const SEPARATORS = /[\s\-_./:]+/g;

function foldChar(ch: string): string {
  if (ch === '\u200c') return '';
  if (DROP.test(ch)) return '';
  switch (ch) {
    case 'ي': case 'ى': case 'ئ': return 'ی';
    case 'ك': return 'ک';
    case 'ة': return 'ه';
    case 'أ': case 'إ': case 'آ': case 'ٱ': return 'ا';
    case 'ؤ': return 'و';
  }
  const code = ch.charCodeAt(0);
  if (code >= 0x06f0 && code <= 0x06f9) return String.fromCharCode(code - 0x06f0 + 48);
  if (code >= 0x0660 && code <= 0x0669) return String.fromCharCode(code - 0x0660 + 48);
  return ch.toLowerCase();
}

/** The folded form of `text`, used on both sides of every comparison. */
export function fold(text: string): string {
  let out = '';
  for (const ch of text) out += foldChar(ch);
  return out;
}

/** `fold` without separators. */
export function compact(text: string): string {
  return fold(text).replace(SEPARATORS, '');
}

/** The words of a query, folded; empty when the query is blank. */
export function queryWords(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/**
 * Whether every word occurs in `hay` (already folded). With `hayCompact` a word also matches with
 * its separators removed.
 */
export function matchesWords(hay: string, words: string[], hayCompact?: string): boolean {
  return words.every((word) => hay.includes(word) || (hayCompact !== undefined && hayCompact.includes(word.replace(SEPARATORS, ''))));
}

/** Folds `text` keeping, for every folded character, the index it came from. */
function foldWithMap(text: string): { folded: string; from: number[] } {
  let folded = '';
  const from: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) from.push(i);
    folded += f;
    i += ch.length;
  }
  from.push(text.length);
  return { folded, from };
}

/** Ranges of `text` (original indices, end exclusive) where the words occur, merged and sorted. */
export function matchRanges(text: string, words: string[]): Array<[number, number]> {
  if (!words.length || !text) return [];
  const { folded, from } = foldWithMap(text);
  const ranges: Array<[number, number]> = [];
  for (const word of words) {
    let at = folded.indexOf(word);
    let guard = 0;
    while (at !== -1 && guard++ < 50) {
      ranges.push([from[at], from[at + word.length - 1] + 1]);
      at = folded.indexOf(word, at + word.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/** A short piece of `text` around the first match of `words`, on one line. Empty when none matches. */
export function snippet(text: string, words: string[], radius = 60): string {
  const ranges = matchRanges(text, words);
  if (!ranges.length) return '';
  const [start, end] = ranges[0];
  let from = Math.max(0, start - radius);
  let to = Math.min(text.length, end + radius * 2);
  // Do not cut a word in half when there is a space nearby.
  if (from > 0) {
    const space = text.indexOf(' ', from);
    if (space !== -1 && space < start) from = space + 1;
  }
  if (to < text.length) {
    const space = text.lastIndexOf(' ', to);
    if (space > end) to = space;
  }
  const piece = text.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '… ' : ''}${piece}${to < text.length ? ' …' : ''}`;
}
