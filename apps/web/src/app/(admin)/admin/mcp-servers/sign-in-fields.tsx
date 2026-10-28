"use client";

import { FieldProblemText, INVALID_OUTLINE } from "@/components/ui/field-problem";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ClientAuthMethod,
  OAuthFields,
  ServerFormField,
  SignInFieldValues,
  SignInMethod,
} from "./mcp-server-model";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs";

interface SignInFieldsProps {
  idPrefix: string;
  method: SignInMethod;
  onMethodChange: (method: SignInMethod) => void;
  values: SignInFieldValues;
  onValuesChange: (values: SignInFieldValues) => void;
  // How the server signs in today, which decides whether a blank secret keeps one.
  current: SignInMethod;
  legacyCredentialRef: string | null;
  messagesFor: (field: ServerFormField) => string[];
}

// How a server signs in: not at all, with a fixed bearer token, or as a service
// account with OAuth 2.0 client credentials, for which Wayfinder fetches and
// renews its own access tokens.
export function SignInFields({
  idPrefix,
  method,
  onMethodChange,
  values,
  onValuesChange,
  current,
  legacyCredentialRef,
  messagesFor,
}: SignInFieldsProps) {
  const fieldId = (field: string) => `${idPrefix}-${field}`;
  const invalid = (field: ServerFormField) => (messagesFor(field).length > 0 ? true : undefined);
  const describedBy = (field: ServerFormField) => (invalid(field) ? `${fieldId(field)}-problem` : undefined);
  const setOAuth = (patch: Partial<OAuthFields>) =>
    onValuesChange({ ...values, oauth: { ...values.oauth, ...patch } });

  const textField = (field: "tokenUrl" | "clientId" | "scope" | "audience", label: string, placeholder?: string) => {
    const problemField = field === "tokenUrl" || field === "clientId" ? field : null;
    return (
      <div className="space-y-1">
        <Label htmlFor={fieldId(field)}>{label}</Label>
        {problemField ? (
          <FieldProblemText id={`${fieldId(problemField)}-problem`} messages={messagesFor(problemField)} />
        ) : null}
        <Input
          id={fieldId(field)}
          className={INVALID_OUTLINE}
          aria-invalid={problemField ? invalid(problemField) : undefined}
          aria-describedby={problemField ? describedBy(problemField) : undefined}
          autoComplete="off"
          value={values.oauth[field]}
          placeholder={placeholder}
          onChange={(event) => setOAuth({ [field]: event.target.value })}
        />
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={fieldId("method")}>Authentication</Label>
        <select
          id={fieldId("method")}
          className={SELECT_CLASS}
          value={method}
          onChange={(event) => onMethodChange(event.target.value as SignInMethod)}
        >
          <option value="none">None</option>
          <option value="bearer">Bearer token</option>
          <option value="oauth">OAuth client credentials</option>
        </select>
      </div>

      {method === "bearer" ? (
        <div className="space-y-1">
          <Label htmlFor={fieldId("token")}>Bearer token</Label>
          {legacyCredentialRef && current === "bearer" ? (
            <p className="text-xs text-muted-foreground">
              Uses the environment variable <code>{legacyCredentialRef}</code>. Saving moves its token into
              secure storage, or type a new one here.
            </p>
          ) : null}
          <FieldProblemText id={`${fieldId("token")}-problem`} messages={messagesFor("token")} />
          <Input
            id={fieldId("token")}
            type="password"
            autoComplete="off"
            className={INVALID_OUTLINE}
            aria-invalid={invalid("token")}
            aria-describedby={describedBy("token")}
            value={values.token}
            placeholder={current === "bearer" ? "Leave blank to keep the current token" : undefined}
            onChange={(event) => onValuesChange({ ...values, token: event.target.value })}
          />
        </div>
      ) : null}

      {method === "oauth" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Wayfinder signs in as a service account and fetches its own access tokens, renewing them
            before they expire. The client secret is stored encrypted and never shown again.
          </p>
          {textField("tokenUrl", "Token URL", "https://login.example.com/oauth2/token")}
          {textField("clientId", "Client ID")}
          <div className="space-y-1">
            <Label htmlFor={fieldId("clientSecret")}>Client secret</Label>
            <FieldProblemText id={`${fieldId("clientSecret")}-problem`} messages={messagesFor("clientSecret")} />
            <Input
              id={fieldId("clientSecret")}
              type="password"
              autoComplete="off"
              className={INVALID_OUTLINE}
              aria-invalid={invalid("clientSecret")}
              aria-describedby={describedBy("clientSecret")}
              value={values.oauth.clientSecret}
              placeholder={current === "oauth" ? "Leave blank to keep the current secret" : undefined}
              onChange={(event) => setOAuth({ clientSecret: event.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={fieldId("clientAuthMethod")}>Send client credentials</Label>
            <select
              id={fieldId("clientAuthMethod")}
              className={SELECT_CLASS}
              value={values.oauth.clientAuthMethod}
              onChange={(event) => setOAuth({ clientAuthMethod: event.target.value as ClientAuthMethod })}
            >
              <option value="client_secret_basic">HTTP Basic header</option>
              <option value="client_secret_post">In the request body</option>
            </select>
          </div>
          {textField("scope", "Scope (optional)", "Space-separated, e.g. api://records/.default")}
          {textField("audience", "Audience (optional)", "Sent as audience and resource")}
        </div>
      ) : null}
    </div>
  );
}
