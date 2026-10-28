// The MCP server screen's copy and parsing, as decisions separate from the
// markup that renders them (ADR-062). Secrets are write-only: nothing here ever
// formats a token or a header value, only whether one is saved.

type Classification = "internal" | "public-read" | "external-write";
type StatusKind = "ok" | "no-data" | "source-unavailable" | "upstream-gap";

export const CLASSIFICATION_OPTIONS: readonly { value: Classification; label: string; description: string }[] = [
  {
    value: "internal",
    label: "Internal utility",
    description: "Self-contained (spellcheck, calculation). Usable in flows and governed by document review.",
  },
  {
    value: "public-read",
    label: "Public-data reader",
    description:
      "Reads published records (legislation, statistics, tenders) and sends nothing but the query. Usable in flows; every call is audited.",
  },
  {
    value: "external-write",
    label: "Sends records out",
    description: "Sends Wayfinder's records to another system. Registered here but never offered to or run by a flow.",
  },
];

const BADGES: Record<Classification, { label: string; usableInFlows: boolean }> = {
  internal: { label: "Internal", usableInFlows: true },
  "public-read": { label: "Public data", usableInFlows: true },
  "external-write": { label: "Sends records out", usableInFlows: false },
};

export const classificationBadge = (classification: Classification) => BADGES[classification];

export const secondsToTimeoutMs = (seconds: string): number | undefined => {
  const trimmed = seconds.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number(trimmed) * 1000;
};

export const timeoutMsToSeconds = (timeoutMs: number): string => String(Math.round(timeoutMs / 1000));

export const parseCustomHeaders = (text: string): { headers: Record<string, string>; error: string | null } => {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) return { headers: {}, error: `Write each header as "Name: value" — "${line.trim()}" has no name.` };
    headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { headers, error: null };
};

export const formatHeaderNames = (names: readonly string[]): string => names.join(", ");

export type ClientAuthMethod = "client_secret_basic" | "client_secret_post";

export interface OAuthSettingsView {
  tokenUrl: string;
  clientId: string;
  scope: string | null;
  audience: string | null;
  clientAuthMethod: ClientAuthMethod;
}

export const credentialSummary = (server: {
  hasCredential: boolean;
  customHeaderNames: string[];
  oauth: OAuthSettingsView | null;
}): string => {
  const parts: string[] = [];
  if (server.oauth) parts.push(`OAuth client credentials (${server.oauth.clientId})`);
  if (server.hasCredential) parts.push("Token saved");
  if (server.customHeaderNames.length > 0) parts.push(`headers: ${formatHeaderNames(server.customHeaderNames)}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
};

// How a server signs in (issue #361): not at all, with a fixed bearer token, or
// as a service account with OAuth 2.0 client credentials. Exactly one applies.
export type SignInMethod = "none" | "bearer" | "oauth";

export const signInMethodOf = (server: { hasCredential: boolean; oauth: OAuthSettingsView | null }): SignInMethod => {
  if (server.oauth) return "oauth";
  return server.hasCredential ? "bearer" : "none";
};

export interface OAuthFields {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  audience: string;
  clientAuthMethod: ClientAuthMethod;
}

export const EMPTY_OAUTH_FIELDS: OAuthFields = {
  tokenUrl: "",
  clientId: "",
  clientSecret: "",
  scope: "",
  audience: "",
  clientAuthMethod: "client_secret_basic",
};

export const oauthFieldsOf = (oauth: OAuthSettingsView | null): OAuthFields =>
  oauth
    ? {
        tokenUrl: oauth.tokenUrl,
        clientId: oauth.clientId,
        clientSecret: "",
        scope: oauth.scope ?? "",
        audience: oauth.audience ?? "",
        clientAuthMethod: oauth.clientAuthMethod,
      }
    : EMPTY_OAUTH_FIELDS;

export interface SignInFieldValues {
  token: string;
  oauth: OAuthFields;
}

export interface SignInChange {
  bearerToken?: string | null;
  oauth?: {
    tokenUrl: string;
    clientId: string;
    clientSecret?: string;
    scope: string | null;
    audience: string | null;
    clientAuthMethod: ClientAuthMethod;
  } | null;
}

// What a save sends for the chosen method. Switching to OAuth clears the token
// server-side; switching to a token, or to None, says so explicitly. Blank
// secrets are left out so the saved ones are kept.
export const signInChange = (method: SignInMethod, values: SignInFieldValues, current: SignInMethod): SignInChange => {
  if (method === "none") return { bearerToken: null, oauth: null };
  if (method === "bearer") {
    const token = values.token.trim();
    return {
      ...(token ? { bearerToken: token } : {}),
      ...(current === "oauth" ? { oauth: null } : {}),
    };
  }
  const clientSecret = values.oauth.clientSecret.trim();
  return {
    oauth: {
      tokenUrl: values.oauth.tokenUrl.trim(),
      clientId: values.oauth.clientId.trim(),
      ...(clientSecret ? { clientSecret } : {}),
      scope: optional(values.oauth.scope),
      audience: optional(values.oauth.audience),
      clientAuthMethod: values.oauth.clientAuthMethod,
    },
  };
};

const isHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value.trim()).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

// A secret may be left blank only when the server already signs in that way.
export const signInProblems = (method: SignInMethod, values: SignInFieldValues, current: SignInMethod): string[] => {
  if (method === "none") return [];
  if (method === "bearer") return !values.token.trim() && current !== "bearer" ? ["Enter the token."] : [];
  const problems: string[] = [];
  if (!isHttpUrl(values.oauth.tokenUrl)) problems.push("Use an http:// or https:// address for the token URL.");
  if (!values.oauth.clientId.trim()) problems.push("Enter the client ID.");
  if (!values.oauth.clientSecret.trim() && current !== "oauth") problems.push("Enter the client secret.");
  return problems;
};

const STATUS_KINDS: readonly StatusKind[] = ["ok", "no-data", "source-unavailable", "upstream-gap"];

export const parseStatusMeanings = (
  text: string,
): { meanings: Record<string, StatusKind>; error: string | null } => {
  const meanings: Record<string, StatusKind> = {};
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [value, kind] = line.split("=").map((part) => part.trim());
    if (!value || !kind || !STATUS_KINDS.includes(kind as StatusKind)) {
      return { meanings: {}, error: `"${line.trim()}" — use value = ${STATUS_KINDS.join(" | ")}.` };
    }
    meanings[value] = kind as StatusKind;
  }
  return { meanings, error: null };
};

export interface McpToolSettingsValue {
  pagination: { cursorArgument: string; nextCursorPath: string; itemsPath: string; maxPages: number } | null;
  status: { statusPath: string; meanings: Record<string, StatusKind>; caveatsPath: string | null } | null;
  citation: {
    recordsPath: string;
    locatorField: string;
    titleField: string | null;
    urlField: string | null;
    timestampField: string | null;
  } | null;
}

// Flat strings, one per input, so the editor is a plain controlled form.
export interface McpToolSettingsForm {
  cursorArgument: string;
  nextCursorPath: string;
  itemsPath: string;
  maxPages: string;
  statusPath: string;
  statusMeanings: string;
  caveatsPath: string;
  recordsPath: string;
  locatorField: string;
  titleField: string;
  urlField: string;
  timestampField: string;
}

export const toolSettingsToForm = (settings: McpToolSettingsValue): McpToolSettingsForm => ({
  cursorArgument: settings.pagination?.cursorArgument ?? "",
  nextCursorPath: settings.pagination?.nextCursorPath ?? "",
  itemsPath: settings.pagination?.itemsPath ?? "",
  maxPages: String(settings.pagination?.maxPages ?? 5),
  statusPath: settings.status?.statusPath ?? "",
  statusMeanings: Object.entries(settings.status?.meanings ?? {})
    .map(([value, kind]) => `${value} = ${kind}`)
    .join("\n"),
  caveatsPath: settings.status?.caveatsPath ?? "",
  recordsPath: settings.citation?.recordsPath ?? "",
  locatorField: settings.citation?.locatorField ?? "",
  titleField: settings.citation?.titleField ?? "",
  urlField: settings.citation?.urlField ?? "",
  timestampField: settings.citation?.timestampField ?? "",
});

const optional = (value: string): string | null => (value.trim() ? value.trim() : null);

// A section whose required field is blank is off — that is how an admin turns
// pagination, status mapping or citations off for a tool.
export const toolSettingsFromForm = (
  form: McpToolSettingsForm,
): { settings: McpToolSettingsValue; error: string | null } => {
  const empty: McpToolSettingsValue = { pagination: null, status: null, citation: null };
  let pagination: McpToolSettingsValue["pagination"] = null;
  if (form.cursorArgument.trim()) {
    if (!/^\d+$/.test(form.maxPages.trim())) return { settings: empty, error: "The page limit must be a whole number." };
    pagination = {
      cursorArgument: form.cursorArgument.trim(),
      nextCursorPath: form.nextCursorPath.trim(),
      itemsPath: form.itemsPath.trim(),
      maxPages: Number(form.maxPages.trim()),
    };
  }
  let status: McpToolSettingsValue["status"] = null;
  if (form.statusPath.trim()) {
    const parsed = parseStatusMeanings(form.statusMeanings);
    if (parsed.error) return { settings: empty, error: parsed.error };
    status = { statusPath: form.statusPath.trim(), meanings: parsed.meanings, caveatsPath: optional(form.caveatsPath) };
  }
  const citation: McpToolSettingsValue["citation"] = form.recordsPath.trim()
    ? {
        recordsPath: form.recordsPath.trim(),
        locatorField: form.locatorField.trim(),
        titleField: optional(form.titleField),
        urlField: optional(form.urlField),
        timestampField: optional(form.timestampField),
      }
    : null;
  return { settings: { pagination, status, citation }, error: null };
};
