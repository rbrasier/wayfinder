"use client";

import type { WatchAuthType, WatchHttpMethod } from "@rbrasier/domain";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WatchForm } from "./watch-model";

export const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs";

const AUTH_LABELS: Record<WatchAuthType, string> = {
  none: "None",
  bearer: "Bearer token",
  api_key: "API key",
};

interface WatchConnectionFieldsProps {
  form: WatchForm;
  onChange: (patch: Partial<WatchForm>) => void;
  secret: string;
  onSecretChange: (secret: string) => void;
  // A secret is already stored for this watch.
  hasStoredSecret: boolean;
  clearSecret: boolean;
  onClearSecretChange: (clear: boolean) => void;
}

// The connection a watch carries (ADR-063 §1). The stored secret is never sent
// back: the field stays empty, and leaving it empty keeps what is stored.
export function WatchConnectionFields({
  form,
  onChange,
  secret,
  onSecretChange,
  hasStoredSecret,
  clearSecret,
  onClearSecretChange,
}: WatchConnectionFieldsProps) {
  const changeAuth = (authType: WatchAuthType) =>
    onChange({
      authType,
      apiKeyPlacement: authType === "api_key" ? (form.apiKeyPlacement ?? { in: "header", name: "X-API-Key" }) : null,
    });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="watch-method">Method</Label>
          <select
            id="watch-method"
            className={SELECT_CLASS}
            value={form.method}
            onChange={(event) => onChange({ method: event.target.value as WatchHttpMethod })}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="watch-url">API address</Label>
          <Input
            id="watch-url"
            value={form.url}
            onChange={(event) => onChange({ url: event.target.value })}
            placeholder="https://api.example.gov.au/hearings"
          />
        </div>
      </div>

      {form.method === "POST" && (
        <div className="space-y-1.5">
          <Label htmlFor="watch-body">Request body (JSON)</Label>
          <Textarea
            id="watch-body"
            value={form.requestBody}
            onChange={(event) => onChange({ requestBody: event.target.value })}
            className="font-mono"
            rows={4}
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="watch-auth">Authentication</Label>
          <select
            id="watch-auth"
            className={SELECT_CLASS}
            value={form.authType}
            onChange={(event) => changeAuth(event.target.value as WatchAuthType)}
          >
            {(Object.keys(AUTH_LABELS) as WatchAuthType[]).map((authType) => (
              <option key={authType} value={authType}>
                {AUTH_LABELS[authType]}
              </option>
            ))}
          </select>
        </div>
        {form.authType !== "none" && (
          <div className="space-y-1.5">
            <Label htmlFor="watch-secret">{form.authType === "bearer" ? "Token" : "Key"}</Label>
            <Input
              id="watch-secret"
              type="password"
              autoComplete="off"
              value={secret}
              disabled={clearSecret}
              onChange={(event) => onSecretChange(event.target.value)}
              placeholder={hasStoredSecret ? "Saved — leave blank to keep it" : ""}
            />
            {hasStoredSecret && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={clearSecret}
                  onChange={(event) => onClearSecretChange(event.target.checked)}
                />
                Remove the saved {form.authType === "bearer" ? "token" : "key"}
              </label>
            )}
          </div>
        )}
      </div>

      {form.authType === "api_key" && form.apiKeyPlacement && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="watch-key-in">Send the key as</Label>
            <select
              id="watch-key-in"
              className={SELECT_CLASS}
              value={form.apiKeyPlacement.in}
              onChange={(event) =>
                onChange({
                  apiKeyPlacement: { ...form.apiKeyPlacement!, in: event.target.value as "header" | "query" },
                })
              }
            >
              <option value="header">A request header</option>
              <option value="query">A query parameter</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="watch-key-name">
              {form.apiKeyPlacement.in === "header" ? "Header name" : "Parameter name"}
            </Label>
            <Input
              id="watch-key-name"
              value={form.apiKeyPlacement.name}
              onChange={(event) => onChange({ apiKeyPlacement: { ...form.apiKeyPlacement!, name: event.target.value } })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
