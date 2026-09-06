// Admin-configurable links shown on the About modal, and optionally in the help
// menu behind the "?" button. Stored as one JSON row in admin_system_settings so
// an operator can point users at their own support channels without a redeploy.

// A closed set, because the icon name crosses the wire and is resolved to a
// component client-side — an arbitrary string would render nothing.
export const ABOUT_LINK_ICONS = [
  "link",
  "github",
  "book",
  "mail",
  "message",
  "help",
  "bug",
  "shield",
] as const;

export type AboutLinkIcon = (typeof ABOUT_LINK_ICONS)[number];

export interface AboutLink {
  label: string;
  // http(s), mailto: or a site-relative path — see normaliseAboutLinkUrl.
  url: string;
  icon: AboutLinkIcon;
  // When true the entry also appears in the help menu. It always appears on the
  // About modal.
  showInHelpMenu: boolean;
}

export interface AboutLinksConfig {
  links: AboutLink[];
}

export const ABOUT_LINKS_SETTING_KEY = "about_links_config";

// An admin may put this anywhere in a link URL; it is expanded to the running
// app version at render time. Left literal in stored URLs so it stays editable.
export const ABOUT_LINK_VERSION_PLACEHOLDER = "{version}";

// Opens GitHub's new-issue form with the reporter's build already in the body,
// so a report names the version it came from without the reporter having to know
// it. The body is percent-encoded: %0A is a newline.
export const DEFAULT_ISSUE_TRACKER_URL =
  "https://github.com/rbrasier/wayfinder/issues/new?body=%0A%0A---%0AWayfinder%20version:%20{version}";

// A fresh install still needs a route to report a bug, so one entry ships by
// default. It stays off the help menu — the About modal is where it lives.
export const createDefaultAboutLinksConfig = (): AboutLinksConfig => ({
  links: [
    {
      label: "Report an issue",
      url: DEFAULT_ISSUE_TRACKER_URL,
      icon: "github",
      showInHelpMenu: false,
    },
  ],
});

// The URL becomes an href, so only http(s), mailto: and site-relative paths are
// accepted — this is what keeps javascript:, data: and vbscript: out of the DOM.
// Protocol-relative "//host" is rejected too: it inherits the page's scheme and
// reads like a path at a glance.
export const normaliseAboutLinkUrl = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.startsWith("//")) return "";
  if (trimmed.startsWith("/")) return trimmed;
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("https://") || lowered.startsWith("http://")) return trimmed;
  if (lowered.startsWith("mailto:")) return trimmed;
  return "";
};

// The placeholder normally sits inside a query string, so the substituted value
// is percent-encoded — a version with a space or an ampersand would otherwise
// truncate or split the parameter it lands in.
export const expandAboutLinkUrl = (url: string, version: string): string =>
  url.split(ABOUT_LINK_VERSION_PLACEHOLDER).join(encodeURIComponent(version));

export const normaliseAboutLinkIcon = (value: unknown): AboutLinkIcon => {
  if (typeof value !== "string") return "link";
  return (ABOUT_LINK_ICONS as readonly string[]).includes(value)
    ? (value as AboutLinkIcon)
    : "link";
};

export const isExternalAboutLink = (url: string): boolean => {
  const lowered = url.toLowerCase();
  return (
    lowered.startsWith("https://") || lowered.startsWith("http://") || lowered.startsWith("mailto:")
  );
};

const parseLink = (value: unknown): AboutLink | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const label = typeof source.label === "string" ? source.label.trim() : "";
  const url = normaliseAboutLinkUrl(source.url);
  // A button with no destination or no words on it is not worth rendering.
  if (label.length === 0 || url.length === 0) return null;
  return {
    label,
    url,
    icon: normaliseAboutLinkIcon(source.icon),
    showInHelpMenu: source.showInHelpMenu === true,
  };
};

// Tolerant parse: a malformed row degrades to the defaults rather than throwing
// on a path that runs for every page render. An explicitly empty list is
// honoured — an admin is allowed to remove every entry.
export const parseAboutLinksConfig = (
  raw: string,
  fallback: AboutLinksConfig = createDefaultAboutLinksConfig(),
): AboutLinksConfig => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fallback;
    const source = parsed as Record<string, unknown>;
    if (!Array.isArray(source.links)) return fallback;
    return {
      links: source.links
        .map(parseLink)
        .filter((link): link is AboutLink => link !== null),
    };
  } catch {
    return fallback;
  }
};

export const helpMenuAboutLinks = (config: AboutLinksConfig): AboutLink[] =>
  config.links.filter((link) => link.showInHelpMenu);
