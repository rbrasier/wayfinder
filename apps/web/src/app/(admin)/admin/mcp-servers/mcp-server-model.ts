// What the MCP servers screen shows about, and sends for, a server's bearer
// token. The token itself never reaches the browser: a server only says whether
// one is stored, or which legacy environment variable it still reads.

export interface CredentialState {
  hasCredential: boolean;
  credentialRef: string | null;
}

export type CredentialSummary =
  | { kind: "stored"; text: string }
  | { kind: "legacy"; text: string }
  | { kind: "none"; text: string };

export const credentialSummary = (server: CredentialState): CredentialSummary => {
  if (server.hasCredential) return { kind: "stored", text: "Stored securely" };
  if (server.credentialRef) return { kind: "legacy", text: `Env var ${server.credentialRef} (legacy)` };
  return { kind: "none", text: "—" };
};

export interface TokenField {
  token: string;
  remove: boolean;
}

// Absent keeps the stored token, null removes it, a string replaces it.
export const credentialChange = (field: TokenField): string | null | undefined => {
  if (field.remove) return null;
  const token = field.token.trim();
  return token.length > 0 ? token : undefined;
};

export type ServerFormField = "label" | "url";

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
