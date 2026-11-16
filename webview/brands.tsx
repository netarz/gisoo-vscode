/**
 * Which company a model belongs to, worked out from its id, so the model picker can group models by
 * brand and show each brand's mark. Ids look like `openrouter/<vendor>/<model>`, `<vendor>/<model>`
 * or a bare house id (`gpt-5`, `claude-opus-4-5`).
 */
import type { JSX } from 'preact';
import { BRANDS, type BrandDef } from './brands.generated';
import { TOOL_ICONS } from './tools.generated';
import type { ExternalSource } from '../src/shared/protocol';

export type { BrandDef };
export { BRANDS };

const byVendor = new Map<string, BrandDef>();
for (const brand of BRANDS) for (const vendor of brand.vendors) byVendor.set(vendor, brand);

/** The brand of a model id, or undefined when it is not one we know. */
export function brandOf(modelId: string): BrandDef | undefined {
  let id = modelId.toLowerCase().trim();
  if (id.startsWith('openrouter/')) id = id.slice('openrouter/'.length);
  if (id.startsWith('~')) id = id.slice(1);
  const slash = id.indexOf('/');
  if (slash > 0) {
    const vendor = byVendor.get(id.slice(0, slash));
    if (vendor) return vendor;
    id = id.slice(id.lastIndexOf('/') + 1);
  }
  for (const brand of BRANDS) if (brand.prefixes.some((prefix) => id.startsWith(prefix))) return brand;
  return undefined;
}

/** Rank of a brand in the picker (the order of BRANDS); unknown models go last. */
export function brandRank(brand: BrandDef | undefined): number {
  return brand ? BRANDS.indexOf(brand) : BRANDS.length;
}

/** A brand's mark. Mono marks take the text colour, colour marks keep their own. */
export function BrandIcon({ brand, size = 16 }: { brand: BrandDef | undefined; size?: number }): JSX.Element {
  if (!brand) {
    return <span class="brand-icon brand-icon-none" style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true" />;
  }
  return (
    <svg
      class={`brand-icon${brand.mono ? ' is-mono' : ''}`}
      width={size}
      height={size}
      viewBox={brand.viewBox}
      fill={brand.mono ? 'currentColor' : undefined}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: brand.svg }}
    />
  );
}

/** The mark of another coding tool whose chats the history panel lists. */
export function ToolIcon({ source, size = 16 }: { source: ExternalSource; size?: number }): JSX.Element {
  const icon = TOOL_ICONS[source];
  return (
    <svg
      class={`brand-icon tool-icon${icon.mono ? ' is-mono' : ''}`}
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill={icon.mono ? 'currentColor' : undefined}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  );
}
