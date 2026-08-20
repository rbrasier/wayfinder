import { domainError, err, findRecordCollections, ok } from "@rbrasier/domain";
import type { RecordCollection, Result } from "@rbrasier/domain";
import { guardOutboundUrl, type OutboundUrlGuardOptions } from "./outbound-url-guard";
import type { FetchRecordsInput, ValueSetKindAdapter } from "./value-set-kind-adapter";

// Read-only verbs only. POST is here for endpoints that take a search body, not
// to let a source write anything (ADR-050 §2a).
const ALLOWED_METHODS = ["GET", "POST"] as const;

export const API_RESPONSE_BYTE_CAP = 5 * 1024 * 1024;
export const API_TIMEOUT_MS = 10_000;
export const API_DEFAULT_PAGE_LIMIT = 500;

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
}

export interface ApiValueSetAdapterOptions {
  fetchImpl?: typeof fetch;
  guardOptions?: OutboundUrlGuardOptions;
  timeoutMs?: number;
}

const readArrayAtPath = (body: unknown, recordsPath?: string): unknown => {
  if (!recordsPath) return body;

  return recordsPath.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, body);
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
  readonly filtersAtSource = true;

  constructor(private readonly options: ApiValueSetAdapterOptions) {}

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

    const url = new URL(guarded.data.toString());
    if (config.searchParam && input.query) url.searchParams.set(config.searchParam, input.query);

    const body = await this.requestBody(url, method, this.headersFor(config, input.credential));
    if (body.error) return body;

    const parsed = readArrayAtPath(body.data, config.recordsPath);
    if (!Array.isArray(parsed)) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          "The lookup source did not return a list of records. Check the URL and the records path.",
        ),
      );
    }

    const limit = Math.min(config.pageLimit ?? API_DEFAULT_PAGE_LIMIT, input.limit ?? Number.MAX_SAFE_INTEGER);

    return ok(
      parsed
        .map(toRecord)
        .filter((record): record is Record<string, string> => record !== null)
        .slice(0, limit),
    );
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
