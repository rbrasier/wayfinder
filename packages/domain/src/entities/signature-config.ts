import type { ConnectivityTarget } from "./connectivity";

// How a claimed signature slot is signed, install-wide (ADR-067 §1). Which
// approvals sign is decided by the template's slots, never by this setting.
export type SignatureMethod = "attestation" | "drawn" | "certificate";

export const SIGNATURE_METHODS: readonly SignatureMethod[] = [
  "attestation",
  "drawn",
  "certificate",
];

// A CSC v2 remote-signing provider (ETSI TS 119 432). The client secret is why
// the whole config is a sensitive setting, encrypted at rest.
export interface CscProviderConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

// Where an engine runs (ADR-069 §2): inside the Wayfinder container, or a
// separately deployed service at a URL.
export type EngineSource = "built-in" | "external";

export type EngineChoice = { source: "built-in" } | { source: "external"; url: string };

export const BUILT_IN_ENGINE: EngineChoice = { source: "built-in" };

// What the settings card shows for a built-in engine. "unavailable" covers both
// an image without the engine and an engine that keeps failing to start.
export type BuiltInEngineStatus = "running" | "idle" | "unavailable";

export interface SignatureConfig {
  method: SignatureMethod;
  pdfConverter: EngineChoice;
  signatureEngine: EngineChoice;
  // Blank means DEFAULT_TSA_URL: a timestamp authority is a third party by
  // design, so it is never built in (ADR-069 §4).
  tsaUrl: string | null;
  csc: CscProviderConfig | null;
}

export const SIGNATURE_CONFIG_SETTING_KEY = "signature_config";

// Free, and chained to a root Acrobat trusts.
export const DEFAULT_TSA_URL = "http://timestamp.digicert.com";

export const DEFAULT_SIGNATURE_CONFIG: SignatureConfig = {
  method: "attestation",
  pdfConverter: BUILT_IN_ENGINE,
  signatureEngine: BUILT_IN_ENGINE,
  tsaUrl: null,
  csc: null,
};

export const resolveTsaUrl = (config: SignatureConfig): string => config.tsaUrl ?? DEFAULT_TSA_URL;

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

// Rows saved before engines were built in hold a bare URL (`gotenbergUrl`,
// `dssUrl`). A URL means the install chose that service, so it stays external;
// no URL means it had none, and the built-in engine takes over.
const parseEngine = (value: unknown, legacyUrl: unknown): EngineChoice => {
  if (typeof value === "object" && value !== null) {
    const source = value as Record<string, unknown>;
    const url = optionalText(source.url);
    return source.source === "external" && url ? { source: "external", url } : BUILT_IN_ENGINE;
  }
  const url = optionalText(legacyUrl);
  return url ? { source: "external", url } : BUILT_IN_ENGINE;
};

// Tolerant parse: anything unreadable becomes attestation, which signs nothing
// new and needs no service — the safe direction for a broken row.
export const parseSignatureConfig = (raw: string): SignatureConfig => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SIGNATURE_CONFIG;
    const source = parsed as Record<string, unknown>;
    const method =
      SIGNATURE_METHODS.find((candidate) => candidate === source.method) ?? "attestation";
    return {
      method,
      pdfConverter: parseEngine(source.pdfConverter, source.gotenbergUrl),
      signatureEngine: parseEngine(source.signatureEngine, source.dssUrl),
      tsaUrl: optionalText(source.tsaUrl),
      csc: parseCsc(source.csc),
    };
  } catch {
    return DEFAULT_SIGNATURE_CONFIG;
  }
};

const isHttpUrl = (value: string): boolean => /^https?:\/\/[^\s/]+/i.test(value);

const externalUrl = (choice: EngineChoice): string | null =>
  choice.source === "external" ? choice.url : null;

const ENGINE_FIELDS: ReadonlyArray<{
  choice: (config: SignatureConfig) => EngineChoice;
  label: string;
}> = [
  { choice: (config) => config.pdfConverter, label: "PDF converter" },
  { choice: (config) => config.signatureEngine, label: "Signature engine" },
];

const checkUrl = (value: string | null, label: string): string | null =>
  value && !isHttpUrl(value) ? `${label} must be an http(s) URL.` : null;

export const validateSignatureConfig = (config: SignatureConfig): string[] => {
  const problems: string[] = [];
  for (const engine of ENGINE_FIELDS) {
    const choice = engine.choice(config);
    if (choice.source !== "external") continue;
    if (!choice.url.trim()) {
      problems.push(`A ${engine.label.toLowerCase()} URL is required when it is set to External.`);
      continue;
    }
    const problem = checkUrl(choice.url, `${engine.label} URL`);
    if (problem) problems.push(problem);
  }
  const otherUrls = [
    checkUrl(config.tsaUrl, "Timestamp authority URL"),
    checkUrl(config.csc?.baseUrl ?? null, "Signing provider URL"),
  ];
  problems.push(...otherUrls.filter((problem): problem is string => problem !== null));

  if (config.method === "certificate" && !config.csc) {
    problems.push("A remote signing provider is required for digital certificate signatures.");
  }
  return problems;
};

// The live probes that must pass before this config may be saved (ADR-067 §6).
// An external PDF converter is always probed, so a flow author turning on
// "Convert to PDF on signing" later can rely on it having worked. A built-in one
// is only probed when the method needs it, so saving attestation or drawn never
// starts LibreOffice — and never fails on a -slim image.
export const requiredSignatureTargets = (config: SignatureConfig): ConnectivityTarget[] => {
  if (config.method === "certificate") {
    return ["pdf-converter", "signature-engine", "timestamp-authority", "signing-provider"];
  }
  return externalUrl(config.pdfConverter) ? ["pdf-converter"] : [];
};

// Certificate signing has nothing to sign without a PDF, so the per-step toggle
// is forced on under that method (ADR-067 §1).
export const convertsToPdfOnSigning = (
  method: SignatureMethod,
  nodeConfig: { convertToPdfOnSigning?: boolean },
): boolean => method === "certificate" || nodeConfig.convertToPdfOnSigning === true;
