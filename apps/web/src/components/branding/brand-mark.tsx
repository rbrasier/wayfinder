import type { BrandMarkView } from "./brand-mark-model";

// The install's mark: its uploaded logo, or the lettered tile on the brand
// colour (ADR-060). Shared by the sidebar and the signed-out pages so the two
// can't drift. Plain markup with no hooks, so it renders on either side.

const TILE_SIZES = {
  sidebar: "h-[26px] w-[26px] rounded-[7px] text-[13px]",
  auth: "h-[30px] w-[30px] rounded-[8px] text-[14px]",
} as const;

const NAME_SIZES = {
  sidebar: "text-[15px] tracking-[-0.01em]",
  auth: "text-[19px] tracking-[-0.015em]",
} as const;

export type BrandMarkSize = keyof typeof TILE_SIZES;

export function BrandTile({ view, size }: { view: BrandMarkView; size: BrandMarkSize }) {
  if (view.logoSrc) {
    return (
      <img
        src={view.logoSrc}
        alt={view.name}
        data-testid="brand-logo"
        className={`${TILE_SIZES[size]} shrink-0 object-contain`}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      data-testid="brand-tile"
      className={`${TILE_SIZES[size]} flex shrink-0 items-center justify-center bg-wf-primary font-bold text-wf-primary-contrast`}
    >
      {view.tileLetter}
    </div>
  );
}

export function BrandName({ view, size }: { view: BrandMarkView; size: BrandMarkSize }) {
  return (
    <span data-testid="brand-name" className={`${NAME_SIZES[size]} font-semibold text-[#1c1b19]`}>
      {view.name}
    </span>
  );
}
