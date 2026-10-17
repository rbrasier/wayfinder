import type { CitedSource } from "@wayfinder/domain";

export interface CitedSourceRow {
  marker: string;
  title: string;
  href: string | null;
  detail: string;
}

// The Sources list under a reply that cited tool records (ADR-062 §6). `href` is
// only ever the citation's URL, which extraction already limited to http(s).
export const citedSourceRows = (sources: readonly CitedSource[] | undefined): CitedSourceRow[] =>
  (sources ?? []).map((source) => {
    const titled = source.title !== null && source.title.trim().length > 0;
    const detail = [source.serverLabel, titled ? source.locator : null, source.recordedAt]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
    return {
      marker: source.marker,
      title: titled ? source.title! : source.locator,
      href: source.url,
      detail,
    };
  });
