import { describe, expect, it } from "vitest";
import {
  ABOUT_LINK_ICONS,
  ABOUT_LINK_VERSION_PLACEHOLDER,
  createDefaultAboutLinksConfig,
  expandAboutLinkUrl,
  helpMenuAboutLinks,
  normaliseAboutLinkIcon,
  normaliseAboutLinkUrl,
  parseAboutLinksConfig,
} from "./about-links";

describe("createDefaultAboutLinksConfig", () => {
  // A fresh install must still offer a route to report a bug, without an admin
  // having to configure one first.
  it("ships a Report an issue entry pointing at the project tracker", () => {
    const config = createDefaultAboutLinksConfig();

    expect(config.links).toEqual([
      {
        label: "Report an issue",
        url: "https://github.com/rbrasier/wayfinder/issues/new?body=%0A%0A---%0AWayfinder%20version:%20{version}",
        icon: "github",
        showInHelpMenu: false,
      },
    ]);
  });

  // The whole point of the default: a filed issue names the build it came from.
  it("expands to a new-issue URL carrying the running version in the body", () => {
    const reportAnIssue = createDefaultAboutLinksConfig().links[0]!;

    expect(expandAboutLinkUrl(reportAnIssue.url, "0.21.3")).toBe(
      "https://github.com/rbrasier/wayfinder/issues/new?body=%0A%0A---%0AWayfinder%20version:%200.21.3",
    );
  });
});

describe("expandAboutLinkUrl", () => {
  it("replaces every occurrence of the version placeholder", () => {
    expect(
      expandAboutLinkUrl(
        `https://example.com/{version}?body=v{version}`,
        "1.2.3",
      ),
    ).toBe("https://example.com/1.2.3?body=v1.2.3");
  });

  it("leaves a URL without the placeholder untouched", () => {
    expect(expandAboutLinkUrl("https://example.com/issues", "1.2.3")).toBe(
      "https://example.com/issues",
    );
  });

  // The placeholder usually sits inside a query string, so the substituted value
  // has to be percent-encoded or an odd version string would break the URL.
  it("percent-encodes the version it substitutes", () => {
    expect(expandAboutLinkUrl(`https://example.com/?b=${ABOUT_LINK_VERSION_PLACEHOLDER}`, "1.0 beta&x")).toBe(
      "https://example.com/?b=1.0%20beta%26x",
    );
  });
});

describe("normaliseAboutLinkUrl", () => {
  it("keeps http and https URLs", () => {
    expect(normaliseAboutLinkUrl("https://example.com/x")).toBe("https://example.com/x");
    expect(normaliseAboutLinkUrl("http://example.com")).toBe("http://example.com");
  });

  it("keeps mailto links", () => {
    expect(normaliseAboutLinkUrl("mailto:help@example.com")).toBe("mailto:help@example.com");
  });

  it("keeps site-relative paths", () => {
    expect(normaliseAboutLinkUrl("/docs/help")).toBe("/docs/help");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseAboutLinkUrl("  https://example.com  ")).toBe("https://example.com");
  });

  // These values become an href, so anything that is not provably safe is dropped.
  it("rejects script-bearing and protocol-relative URLs", () => {
    expect(normaliseAboutLinkUrl("javascript:alert(1)")).toBe("");
    expect(normaliseAboutLinkUrl("data:text/html,<script>")).toBe("");
    expect(normaliseAboutLinkUrl("vbscript:x")).toBe("");
    expect(normaliseAboutLinkUrl("//evil.example.com")).toBe("");
  });

  it("rejects non-strings and blanks", () => {
    expect(normaliseAboutLinkUrl(null)).toBe("");
    expect(normaliseAboutLinkUrl(42)).toBe("");
    expect(normaliseAboutLinkUrl("   ")).toBe("");
  });
});

describe("normaliseAboutLinkIcon", () => {
  it("keeps a known icon", () => {
    expect(normaliseAboutLinkIcon("github")).toBe("github");
    expect(normaliseAboutLinkIcon("book")).toBe("book");
  });

  it("falls back to the link icon for anything unknown", () => {
    expect(normaliseAboutLinkIcon("not-an-icon")).toBe("link");
    expect(normaliseAboutLinkIcon(null)).toBe("link");
  });

  it("offers every icon it accepts", () => {
    for (const icon of ABOUT_LINK_ICONS) {
      expect(normaliseAboutLinkIcon(icon)).toBe(icon);
    }
  });
});

describe("parseAboutLinksConfig", () => {
  it("reads a well-formed row", () => {
    const raw = JSON.stringify({
      links: [{ label: "Docs", url: "https://docs.example.com", icon: "book", showInHelpMenu: true }],
    });

    expect(parseAboutLinksConfig(raw).links).toEqual([
      { label: "Docs", url: "https://docs.example.com", icon: "book", showInHelpMenu: true },
    ]);
  });

  it("accepts an empty list — an admin may remove every entry", () => {
    expect(parseAboutLinksConfig(JSON.stringify({ links: [] })).links).toEqual([]);
  });

  it("drops entries with no usable URL rather than rendering a dead button", () => {
    const raw = JSON.stringify({
      links: [
        { label: "Bad", url: "javascript:alert(1)", icon: "link", showInHelpMenu: true },
        { label: "Good", url: "https://example.com", icon: "link", showInHelpMenu: false },
      ],
    });

    expect(parseAboutLinksConfig(raw).links).toEqual([
      { label: "Good", url: "https://example.com", icon: "link", showInHelpMenu: false },
    ]);
  });

  it("drops entries with no label", () => {
    const raw = JSON.stringify({
      links: [{ label: "   ", url: "https://example.com", icon: "link", showInHelpMenu: false }],
    });

    expect(parseAboutLinksConfig(raw).links).toEqual([]);
  });

  it("defaults a missing icon and flag", () => {
    const raw = JSON.stringify({ links: [{ label: "Docs", url: "https://d.example.com" }] });

    expect(parseAboutLinksConfig(raw).links).toEqual([
      { label: "Docs", url: "https://d.example.com", icon: "link", showInHelpMenu: false },
    ]);
  });

  it("falls back to the defaults on malformed input", () => {
    const fallback = createDefaultAboutLinksConfig();

    expect(parseAboutLinksConfig("not json")).toEqual(fallback);
    expect(parseAboutLinksConfig(JSON.stringify({ links: "nope" }))).toEqual(fallback);
    expect(parseAboutLinksConfig(JSON.stringify([]))).toEqual(fallback);
  });
});

describe("helpMenuAboutLinks", () => {
  it("returns only the entries flagged for the help menu, in order", () => {
    const config = {
      links: [
        { label: "A", url: "https://a.example.com", icon: "link" as const, showInHelpMenu: false },
        { label: "B", url: "https://b.example.com", icon: "book" as const, showInHelpMenu: true },
        { label: "C", url: "https://c.example.com", icon: "link" as const, showInHelpMenu: true },
      ],
    };

    expect(helpMenuAboutLinks(config).map((link) => link.label)).toEqual(["B", "C"]);
  });
});
