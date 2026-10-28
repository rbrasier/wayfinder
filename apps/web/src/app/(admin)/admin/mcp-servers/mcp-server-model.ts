// What the MCP servers screen shows about, and sends for, how a server signs in.
// Secrets never reach the browser: a server only says whether a bearer token is
// stored, which legacy environment variable it still reads, or its OAuth settings
// without the client secret.

export type ClientAuthMethod = "client_secret_basic" | "client_secret_post";

export interface OAuthSettingsView {
  tokenUrl: string;
  clientId: string;
  scope: string | null;
  audience: string | null;
  clientAuthMethod: ClientAuthMethod;
}

export interface CredentialState {
  hasCredential: boolean;
  credentialRef: string | null;
  oauth: OAuthSettingsView | null;
}

export type CredentialSummary =
  | { kind: "oauth"; text: string }
  | { kind: "stored"; text: string }
  | { kind: "legacy"; text: string }
  | { kind: "none"; text: string };

export const credentialSummary = (server: CredentialState): CredentialSummary => {
  if (server.oauth) return { kind: "oauth", text: `OAuth client credentials (${server.oauth.clientId})` };
  if (server.hasCredential) return { kind: "stored", text: "Stored securely" };
  if (server.credentialRef) return { kind: "legacy", text: `Env var ${server.credentialRef} (legacy)` };
  return { kind: "none", text: "—" };
};

export type SignInMethod = "none" | "bearer" | "oauth";

export const signInMethodOf = (server: CredentialState): SignInMethod => {
  if (server.oauth) return "oauth";
  if (server.hasCredential || server.credentialRef) return "bearer";
  return "none";
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

export interface OAuthChange {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scope: string | null;
  audience: string | null;
  clientAuthMethod: ClientAuthMethod;
}

export interface SignInChange {
  credential?: string | null;
  oauth?: OAuthChange | null;
}

const blankToNull = (value: string): string | null => (value.trim().length > 0 ? value.trim() : null);

// What a save sends for the chosen sign-in method. The server clears whichever
// method is not chosen when switching to OAuth; switching to a token, or to
// None, says so explicitly. Blank secrets are left out so stored ones are kept.
export const signInChange = (
  method: SignInMethod,
  values: SignInFieldValues,
  current: SignInMethod,
): SignInChange => {
  if (method === "none") return { credential: null, oauth: null };
  if (method === "bearer") {
    const token = values.token.trim();
    return {
      ...(token.length > 0 ? { credential: token } : {}),
      ...(current === "oauth" ? { oauth: null } : {}),
    };
  }
  const clientSecret = values.oauth.clientSecret.trim();
  return {
    oauth: {
      tokenUrl: values.oauth.tokenUrl.trim(),
      clientId: values.oauth.clientId.trim(),
      ...(clientSecret.length > 0 ? { clientSecret } : {}),
      scope: blankToNull(values.oauth.scope),
      audience: blankToNull(values.oauth.audience),
      clientAuthMethod: values.oauth.clientAuthMethod,
    },
  };
};

export type ServerFormField = "label" | "url" | "token" | "tokenUrl" | "clientId" | "clientSecret";

export interface ServerFormProblem {
  field: ServerFormField;
  message: string;
}

const isHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value.trim()).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

// The checks the server applies, made before saving so each shows above its field.
export const serverFormProblems = (form: { label: string; url: string }): ServerFormProblem[] => {
  const problems: ServerFormProblem[] = [];
  if (form.label.trim().length === 0) problems.push({ field: "label", message: "Add a label." });
  if (!isHttpUrl(form.url)) problems.push({ field: "url", message: "Use an http:// or https:// address." });
  return problems;
};

// A secret may be left blank only when the server already signs in that way.
export const signInProblems = (
  method: SignInMethod,
  values: SignInFieldValues,
  current: SignInMethod,
): ServerFormProblem[] => {
  if (method === "none") return [];
  if (method === "bearer") {
    return values.token.trim().length === 0 && current !== "bearer"
      ? [{ field: "token", message: "Enter the token." }]
      : [];
  }
  const problems: ServerFormProblem[] = [];
  if (!isHttpUrl(values.oauth.tokenUrl)) {
    problems.push({ field: "tokenUrl", message: "Use an http:// or https:// address." });
  }
  if (values.oauth.clientId.trim().length === 0) {
    problems.push({ field: "clientId", message: "Enter the client ID." });
  }
  if (values.oauth.clientSecret.trim().length === 0 && current !== "oauth") {
    problems.push({ field: "clientSecret", message: "Enter the client secret." });
  }
  return problems;
};
