import { domainError, err, findRecordCollections, ok } from "@rbrasier/domain";
import type { LookupSourceConfig, RecordCollection, Result } from "@rbrasier/domain";
import { guardOutboundUrl, type OutboundUrlGuardOptions } from "./outbound-url-guard";
import type { FetchRecordsInput, ValueSetKindAdapter } from "./value-set-kind-adapter";

// Read-only verbs only. POST is here for endpoints that take a search body, not
// to let a source write anything (ADR-050 §2a).
const ALLOWED_METHODS = ["GET", "POST"] as const;

export const API_RESPONSE_BYTE_CAP = 5 * 1024 * 1024;
export const API_TIMEOUT_MS = 10_000;
export const API_DEFAULT_PAGE_LIMIT = 500;

// Ceilings on a paginated walk. A misconfigured source, or one whose paging
// parameters it ignores, must not be able to loop this adapter indefinitely or
// pull an unbounded set into memory (ADR-051 §1).
export const API_MAX_PAGES = 20;
export const API_DEFAULT_MAX_RECORDS = 5_000;
export const API_DEFAULT_PAGE_SIZE = 200;

// How the source expects to be asked for the next page. `offset` counts records,
// `page` counts pages, `cursor` echoes a token the previous response carried.
export type ApiPagingStyle = "offset" | "page" | "cursor";

export interface ApiPagingConfig {
  style: ApiPagingStyle;
  // The offset, page-number or cursor parameter, depending on the style.
  param: string;
  sizeParam?: string;
  size?: number;
  // Dotted path to the next cursor in the response body. Cursor style only; a
  // response without a value there ends the walk.
  cursorPath?: string;
  // Some APIs number pages from 0 rather than 1.
  startPage?: number;
}

export interface ApiSourceConfig {
  url: string;
  method?: (typeof ALLOWED_METHODS)[number];
  headers?: Record<string, string>;
  // The query parameter carrying the type-ahead term. Without it the adapter
  // fetches the whole page and the caller filters in memory.
  searchParam?: string;
  // Dotted path to the array inside the response body; empty means the body is
  // the array itself.
  recordsPath?: string;
  pageLimit?: number;
  // Absent means the source serves its whole set in one response.
  paging?: ApiPagingConfig;
  maxRecords?: number;
}

export interface ApiValueSetAdapterOptions {
  fetchImpl?: typeof fetch;
  guardOptions?: OutboundUrlGuardOptions;
  timeoutMs?: number;
}

const readAtPath = (body: unknown, path?: string): unknown => {
  if (!path) return body;

  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, body);
};

// Where in the walk this request sits. `null` is the unpaginated case: one
// request for the whole set, with no position parameters at all.
interface PagePosition {
  paging: ApiPagingConfig;
  pageIndex: number;
  offset: number;
  size: number;
  cursor: string | null;
}

const applyPaging = (url: URL, position: PagePosition | null): void => {
  if (!position) return;
  const { paging } = position;

  if (paging.sizeParam) url.searchParams.set(paging.sizeParam, String(position.size));

  if (paging.style === "cursor") {
    // The first request carries no cursor: there is nothing to resume from yet.
    if (position.cursor) url.searchParams.set(paging.param, position.cursor);
    return;
  }
  if (paging.style === "offset") {
    url.searchParams.set(paging.param, String(position.offset));
    return;
  }
  url.searchParams.set(paging.param, String((paging.startPage ?? 1) + position.pageIndex));
};

const readCursor = (body: unknown, cursorPath?: string): string | null => {
  if (!cursorPath) return null;
  const value = readAtPath(body, cursorPath);
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return String(value);
  return null;
};

// Every value becomes a string so the admin can choose any field as the display
// or the key, whatever the source's JSON types.
const toRecord = (value: unknown): Record<string, string> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record: Record<string, string> = {};
  Object.entries(value as Record<string, unknown>).forEach(([field, raw]) => {
    if (raw === null || raw === undefined) return;
    if (typeof raw === "object") return;
    record[field] = String(raw);
  });
  return record;
};

const readCappedText = async (response: Response): Promise<Result<string>> => {
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > API_RESPONSE_BYTE_CAP) {
    return err(domainError("INFRA_FAILURE", "The lookup source's response is too large."));
  }

  const text = await response.text();
  if (text.length > API_RESPONSE_BYTE_CAP) {
    return err(domainError("INFRA_FAILURE", "The lookup source's response is too large."));
  }
  return ok(text);
};

// Calls an admin-registered HTTP endpoint and returns its records. Read-only,
// HTTPS-only, address-guarded, time- and size-capped — an admin-supplied URL is
// the product's only outbound egress under user control (ADR-050 §2a).
export class ApiValueSetAdapter implements ValueSetKindAdapter {
  constructor(private readonly options: ApiValueSetAdapterOptions) {}

  // Only true when the source was actually told what to search for. Claiming it
  // unconditionally made an unconfigured source return the head of its list as
  // if it were the matches, because the caller trusts this flag and skips its own
  // filtering (ADR-051 §1).
  filtersAtSource(config: LookupSourceConfig): boolean {
    return Boolean((config as unknown as ApiSourceConfig).searchParam);
  }

  async fetchRecords(input: FetchRecordsInput): Promise<Result<Array<Record<string, string>>>> {
    const config = input.config as unknown as ApiSourceConfig;
    const method = config.method ?? "GET";

    if (!ALLOWED_METHODS.includes(method)) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `A lookup source may only use ${ALLOWED_METHODS.join(" or ")}, not ${method}.`,
        ),
      );
    }

    const guarded = await guardOutboundUrl(config.url ?? "", this.options.guardOptions ?? {});
    if (guarded.error) return guarded;

    const limit = Math.min(
      config.pageLimit ?? API_DEFAULT_PAGE_LIMIT,
      input.limit ?? Number.MAX_SAFE_INTEGER,
    );
    const searching = Boolean(config.searchParam && input.query);

    // A search asks the source to do the narrowing, so one response is the whole
    // answer. Only a full listing walks the pages.
    if (!config.paging || searching) {
      const page = await this.requestPage(guarded.data, config, input, null);
      if (page.error) return page;
      return ok(page.data.records.slice(0, limit));
    }

    return this.walkPages(guarded.data, config, config.paging, input);
  }

  private async walkPages(
    base: URL,
    config: ApiSourceConfig,
    paging: ApiPagingConfig,
    input: FetchRecordsInput,
  ): Promise<Result<Array<Record<string, string>>>> {
    const size = paging.size ?? API_DEFAULT_PAGE_SIZE;
    const ceiling = Math.min(
      config.maxRecords ?? API_DEFAULT_MAX_RECORDS,
      input.limit ?? Number.MAX_SAFE_INTEGER,
    );

    const records: Array<Record<string, string>> = [];
    let cursor: string | null = null;

    for (let pageIndex = 0; pageIndex < API_MAX_PAGES; pageIndex += 1) {
      const page = await this.requestPage(base, config, input, {
        paging,
        pageIndex,
        offset: records.length,
        size,
        cursor,
      });
      // A page that fails mid-walk discards the walk: a partial set would look
      // like a shrunken source and churn the cached version.
      if (page.error) return page;

      records.push(...page.data.records);
      if (records.length >= ceiling) break;
      if (page.data.records.length === 0) break;

      if (paging.style === "cursor") {
        cursor = readCursor(page.data.body, paging.cursorPath);
        if (!cursor) break;
        continue;
      }
      // A short page is the last page for offset and page-number styles, which
      // carry no end-of-set marker of their own.
      if (page.data.records.length < size) break;
    }

    return ok(records.slice(0, ceiling));
  }

  private async requestPage(
    base: URL,
    config: ApiSourceConfig,
    input: FetchRecordsInput,
    position: PagePosition | null,
  ): Promise<Result<{ records: Array<Record<string, string>>; body: unknown }>> {
    const url = new URL(base.toString());
    if (config.searchParam && input.query) url.searchParams.set(config.searchParam, input.query);
    applyPaging(url, position);

    const body = await this.requestBody(
      url,
      config.method ?? "GET",
      this.headersFor(config, input.credential),
    );
    if (body.error) return body;

    const parsed = readAtPath(body.data, config.recordsPath);
    if (!Array.isArray(parsed)) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          "The lookup source did not return a list of records. Check the URL and the records path.",
        ),
      );
    }

    return ok({
      records: parsed
        .map(toRecord)
        .filter((record): record is Record<string, string> => record !== null),
      body: body.data,
    });
  }

  // Test walks the whole body rather than one configured path, so the admin
  // picks the list from what actually came back (ADR-050 §2b).
  async discoverCollections(input: FetchRecordsInput): Promise<Result<RecordCollection[]>> {
    const config = input.config as unknown as ApiSourceConfig;
    const guarded = await guardOutboundUrl(config.url ?? "", this.options.guardOptions ?? {});
    if (guarded.error) return guarded;

    const body = await this.requestBody(
      new URL(guarded.data.toString()),
      config.method ?? "GET",
      this.headersFor(config, input.credential),
    );
    if (body.error) return body;

    return ok(findRecordCollections(body.data));
  }

  private headersFor(config: ApiSourceConfig, credential?: string): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json", ...config.headers };
    if (credential) headers.Authorization = credential;
    return headers;
  }

  private async requestBody(
    url: URL,
    method: string,
    headers: Record<string, string>,
  ): Promise<Result<unknown>> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? API_TIMEOUT_MS);

    try {
      const response = await fetchImpl(url, { method, headers, signal: controller.signal });
      if (!response.ok) {
        return err(
          domainError(
            "INFRA_FAILURE",
            `The lookup source returned ${response.status} ${response.statusText}.`.trim(),
          ),
        );
      }

      const text = await readCappedText(response);
      if (text.error) return text;

      try {
        return ok(JSON.parse(text.data));
      } catch {
        return err(
          domainError("VALIDATION_FAILED", "The lookup source did not return JSON."),
        );
      }
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "The lookup source could not be reached.", cause));
    } finally {
      clearTimeout(timeout);
    }
  }
}
