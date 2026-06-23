export interface NavigationClickIntent {
  href: string | null;
  target: string | null;
  hasDownload: boolean;
  currentHref: string;
  isModified: boolean;
}

// Decide whether a link click should trigger the in-app navigation indicator.
// We only light up for same-origin soft navigations to a different page — exactly
// the case where the App Router holds the previous page on screen while the
// destination's server work resolves. Everything else (new tabs, downloads,
// modified clicks, external links, same-page/hash changes) is left to the browser.
export function shouldStartNavigation(intent: NavigationClickIntent): boolean {
  if (intent.isModified) return false;
  if (intent.hasDownload) return false;
  if (!intent.href) return false;
  if (intent.target && intent.target !== "_self") return false;

  const current = new URL(intent.currentHref);
  const next = new URL(intent.href, intent.currentHref);

  if (next.origin !== current.origin) return false;
  if (next.pathname === current.pathname && next.search === current.search) return false;
  return true;
}
