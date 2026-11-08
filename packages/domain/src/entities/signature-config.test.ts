import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNATURE_CONFIG,
  parseSignatureConfig,
  requiredSignatureTargets,
  validateSignatureConfig,
  type SignatureConfig,
} from "./signature-config";

const certificateConfig = (overrides: Partial<SignatureConfig> = {}): SignatureConfig => ({
  method: "certificate",
  gotenbergUrl: "http://gotenberg:3000",
  dssUrl: "http://dss:8080",
  tsaUrl: "http://tsa.example/tsr",
  csc: {
    baseUrl: "https://csc.example/csc/v2",
    clientId: "wayfinder",
    clientSecret: "secret",
  },
  ...overrides,
});

describe("parseSignatureConfig", () => {
  it("defaults to attestation when nothing is stored", () => {
    expect(parseSignatureConfig("")).toEqual(DEFAULT_SIGNATURE_CONFIG);
    expect(DEFAULT_SIGNATURE_CONFIG.method).toBe("attestation");
  });

  it("falls back to the default for malformed json rather than throwing", () => {
    expect(parseSignatureConfig("{nope")).toEqual(DEFAULT_SIGNATURE_CONFIG);
  });

  it("reads every field of a stored certificate config", () => {
    const stored = certificateConfig();

    expect(parseSignatureConfig(JSON.stringify(stored))).toEqual(stored);
  });

  it("reads an unknown method as attestation, the safe direction", () => {
    const config = parseSignatureConfig(JSON.stringify({ method: "qualified" }));

    expect(config.method).toBe("attestation");
  });

  it("trims urls and treats blanks as unset", () => {
    const config = parseSignatureConfig(JSON.stringify({ method: "drawn", gotenbergUrl: "  " }));

    expect(config.gotenbergUrl).toBeNull();
  });
});

describe("validateSignatureConfig", () => {
  it("accepts attestation with nothing else configured", () => {
    expect(validateSignatureConfig(DEFAULT_SIGNATURE_CONFIG)).toEqual([]);
  });

  it("accepts a complete certificate config", () => {
    expect(validateSignatureConfig(certificateConfig())).toEqual([]);
  });

  it("names every missing certificate dependency", () => {
    const problems = validateSignatureConfig(
      certificateConfig({ gotenbergUrl: null, dssUrl: null, tsaUrl: null, csc: null }),
    );

    expect(problems).toEqual([
      "A PDF converter URL is required for digital certificate signatures.",
      "A signature engine (DSS) URL is required for digital certificate signatures.",
      "A timestamp authority URL is required for digital certificate signatures.",
      "A remote signing provider is required for digital certificate signatures.",
    ]);
  });

  it("rejects a url that is not http or https", () => {
    const problems = validateSignatureConfig({ ...DEFAULT_SIGNATURE_CONFIG, gotenbergUrl: "ftp://x" });

    expect(problems).toEqual(["PDF converter URL must be an http(s) URL."]);
  });
});

describe("requiredSignatureTargets", () => {
  it("needs nothing for attestation without a PDF converter", () => {
    expect(requiredSignatureTargets(DEFAULT_SIGNATURE_CONFIG)).toEqual([]);
  });

  it("needs the PDF converter whenever one is configured, so a toggle can rely on it", () => {
    expect(
      requiredSignatureTargets({ ...DEFAULT_SIGNATURE_CONFIG, method: "drawn", gotenbergUrl: "http://g" }),
    ).toEqual(["pdf-converter"]);
  });

  it("needs all four services for certificate signatures", () => {
    expect(requiredSignatureTargets(certificateConfig())).toEqual([
      "pdf-converter",
      "signature-engine",
      "timestamp-authority",
      "signing-provider",
    ]);
  });
});
