import type { BuiltInEngineStatus, EngineChoice, EngineSource, SignatureMethod } from "@wayfinder/domain";

export interface SignatureConfigView {
  method: SignatureMethod;
  pdfConverter: EngineChoice;
  signatureEngine: EngineChoice;
  tsaUrl: string | null;
  csc: { baseUrl: string; clientId: string; hasClientSecret: boolean } | null;
}

export interface FormState {
  method: SignatureMethod;
  pdfConverterSource: EngineSource;
  pdfConverterUrl: string;
  signatureEngineSource: EngineSource;
  signatureEngineUrl: string;
  tsaUrl: string;
  cscBaseUrl: string;
  cscClientId: string;
  cscClientSecret: string;
  hasClientSecret: boolean;
}

export const EMPTY_FORM: FormState = {
  method: "attestation",
  pdfConverterSource: "built-in",
  pdfConverterUrl: "",
  signatureEngineSource: "built-in",
  signatureEngineUrl: "",
  tsaUrl: "",
  cscBaseUrl: "",
  cscClientId: "",
  cscClientSecret: "",
  hasClientSecret: false,
};

const urlOf = (choice: EngineChoice): string => (choice.source === "external" ? choice.url : "");

export const formFromConfig = (config: SignatureConfigView): FormState => ({
  method: config.method,
  pdfConverterSource: config.pdfConverter.source,
  pdfConverterUrl: urlOf(config.pdfConverter),
  signatureEngineSource: config.signatureEngine.source,
  signatureEngineUrl: urlOf(config.signatureEngine),
  tsaUrl: config.tsaUrl ?? "",
  cscBaseUrl: config.csc?.baseUrl ?? "",
  cscClientId: config.csc?.clientId ?? "",
  cscClientSecret: "",
  hasClientSecret: config.csc?.hasClientSecret ?? false,
});

// A URL left in the field after switching back to Built-in is dropped, so the
// saved config never carries an address nothing uses.
const choiceOf = (source: EngineSource, url: string): EngineChoice =>
  source === "external" ? { source: "external", url } : { source: "built-in" };

export const inputFromForm = (form: FormState) => ({
  method: form.method,
  pdfConverter: choiceOf(form.pdfConverterSource, form.pdfConverterUrl),
  signatureEngine: choiceOf(form.signatureEngineSource, form.signatureEngineUrl),
  tsaUrl: form.tsaUrl,
  csc:
    form.cscBaseUrl.trim() && form.cscClientId.trim()
      ? { baseUrl: form.cscBaseUrl, clientId: form.cscClientId, clientSecret: form.cscClientSecret }
      : null,
});

export const engineStatusLabel = (choice: EngineChoice, status: BuiltInEngineStatus): string => {
  if (choice.source === "external") return `External · ${choice.url}`;
  if (status === "unavailable") return "Not included in this image";
  return `Built-in · ${status}`;
};

const TARGET_LABELS: Record<string, string> = {
  "pdf-converter": "PDF converter",
  "signature-engine": "Signature engine",
  "timestamp-authority": "Timestamp authority",
  "signing-provider": "Signing provider",
};

const BUILT_IN_TARGET_LABELS: Record<string, string> = {
  "pdf-converter": "Built-in PDF converter",
  "signature-engine": "Built-in signature engine",
};

const sourceForTarget = (target: string, form: FormState): EngineSource | null => {
  if (target === "pdf-converter") return form.pdfConverterSource;
  if (target === "signature-engine") return form.signatureEngineSource;
  return null;
};

export const testTargetLabel = (target: string, form: FormState): string => {
  if (sourceForTarget(target, form) === "built-in") return BUILT_IN_TARGET_LABELS[target] ?? target;
  return TARGET_LABELS[target] ?? target;
};
