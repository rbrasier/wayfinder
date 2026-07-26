"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  isExternalSiteBannerLink,
  isSiteBannerVisible,
  resolveSiteBannerLinkLabel,
  type SiteBannerConfig,
} from "@rbrasier/domain";
import { trpc } from "@/trpc/client";

export const buildSiteBannerStyle = (config: SiteBannerConfig): CSSProperties => ({
  backgroundColor: config.backgroundColour,
  color: config.textColour,
  fontSize: `${config.textSizePt}pt`,
});

// The banner query runs at the root of every page, so its result can land in
// the react-query cache while React is still hydrating the tree below. Any
// consumer that rendered "no data" on the server would then render "data" on
// its first client pass and throw a hydration mismatch. Deferring the read to
// after mount keeps the first client render identical to the server's.
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

function SiteBannerLink({ url, label }: { url: string; label: string }) {
  const className = "shrink-0 underline underline-offset-2 hover:no-underline";

  if (isExternalSiteBannerLink(url)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        data-testid="site-banner-link"
      >
        {label}
      </a>
    );
  }

  return (
    <Link href={url} className={className} data-testid="site-banner-link">
      {label}
    </Link>
  );
}

export function SiteBanner() {
  // Public query: this renders above the login and register pages too. The
  // banner changes only when an admin edits it, so a long stale time keeps it
  // off the per-navigation request path.
  const bannerQuery = trpc.settings.getSiteBanner.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const hydrated = useHydrated();

  const config = hydrated ? bannerQuery.data : undefined;
  if (!config || !isSiteBannerVisible(config)) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="site-banner"
      style={buildSiteBannerStyle(config)}
      className="flex shrink-0 items-center justify-center gap-3 px-4 py-1.5 text-center leading-tight"
    >
      {/* Truncated rather than wrapped: the layouts below size themselves
          against the remaining viewport, so a two-line banner would shift
          every page the moment an admin typed a long message. */}
      <span className="min-w-0 truncate">{config.text}</span>
      {config.linkUrl.length > 0 && (
        <SiteBannerLink url={config.linkUrl} label={resolveSiteBannerLinkLabel(config.linkLabel)} />
      )}
    </div>
  );
}
