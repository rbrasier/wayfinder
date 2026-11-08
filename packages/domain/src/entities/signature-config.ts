import type { ConnectivityTarget } from "./connectivity";

// How a claimed signature slot is signed, install-wide (ADR-067 §1). Which
// approvals sign is decided by the template's slots, never by this setting.
export type SignatureMethod = "attestation" | "drawn" | "certificate";

export const SIGNATURE_METHODS: readonly SignatureMethod[] = ["attestation", "drawn", "certificate"];

// A CSC v2 remote-signing provider (ETSI TS 119 432). The client secret is why
// the whole config is a sensitive setting, encrypted at rest.
export interface CscProviderConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface SignatureConfig {
  method: SignatureMethod;
  gotenbergUrl: string | null;
  dssUrl: string | null;
  tsaUrl: string | null;
  csc: CscProviderConfig | null;
}

export const SIGNATURE_CONFIG_SETTING_KEY = "signature_config";

export const DEFAULT_SIGNATURE_CONFIG: SignatureConfig = {
  method: "attestation",
  gotenbergUrl: null,
  dssUrl: null,
  tsaUrl: null,
  csc: null,
};

const optionalText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseCsc = (value: unknown): CscProviderConfig | null => {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  const baseUrl = optionalText(source.baseUrl);
  const clientId = optionalText(source.clientId);
  const clientSecret = optionalText(source.clientSecret);
  if (!baseUrl || !clientId || !clientSecret) return null;
  return { baseUrl, clientId, clientSecret };
};

// Tolerant parse: anything unreadable becomes attestation, which signs nothing
// new and needs no service — the safe direction for a broken row.
export const parseSignatureConfig = (raw: string): SignatureConfig => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SIGNATURE_CONFIG;
    const source = parsed as Record<string, unknown>;
    const method = SIGNATURE_METHODS.find((candidate) => candidate === source.method) ?? "attestation";
    return {
      method,
      gotenbergUrl: optionalText(source.gotenbergUrl),
      dssUrl: optionalText(source.dssUrl),
      tsaUrl: optionalText(source.tsaUrl),
      csc: parseCsc(source.csc),
    };
  } catch {
    return DEFAULT_SIGNATURE_CONFIG;
  }
};

const isHttpUrl = (value: string): boolean => /^https?:\/\/[^\s/]+/i.test(value);

const URL_FIELDS: ReadonlyArray<{ value: (config: SignatureConfig) => string | null; label: string }> = [
  { value: (config) => config.gotenbergUrl, label: "PDF converter URL" },
  { value: (config) => config.dssUrl, label: "Signature engine URL" },
  { value: (config) => config.tsaUrl, label: "Timestamp authority URL" },
  { value: (config) => config.csc?.baseUrl ?? null, label: "Signing provider URL" },
];

export const validateSignatureConfig = (config: SignatureConfig): string[] => {
  const problems: string[] = [];
  for (const urlField of URL_FIELDS) {
    const value = urlField.value(config);
    if (value && !isHttpUrl(value)) problems.push(`${urlField.label} must be an http(s) URL.`);
  }
  if (config.method !== "certificate") return problems;

  const suffix = "is required for digital certificate signatures.";
  if (!config.gotenbergUrl) problems.push(`A PDF converter URL ${suffix}`);
  if (!config.dssUrl) problems.push(`A signature engine (DSS) URL ${suffix}`);
  if (!config.tsaUrl) problems.push(`A timestamp authority URL ${suffix}`);
  if (!config.csc) problems.push(`A remote signing provider ${suffix}`);
  return problems;
};

// The live probes that must pass before this config may be saved (ADR-067 §6).
// A configured PDF converter is always probed, so a flow author turning on
// "Convert to PDF on signing" later can rely on it having worked.
export const requiredSignatureTargets = (config: SignatureConfig): ConnectivityTarget[] => {
  if (config.method === "certificate") {
    return ["pdf-converter", "signature-engine", "timestamp-authority", "signing-provider"];
  }
  return config.gotenbergUrl ? ["pdf-converter"] : [];
};

// Certificate signing has nothing to sign without a PDF, so the per-step toggle
// is forced on under that method (ADR-067 §1).
export const convertsToPdfOnSigning = (
  method: SignatureMethod,
  nodeConfig: { convertToPdfOnSigning?: boolean },
): boolean => method === "certificate" || nodeConfig.convertToPdfOnSigning === true;
