import { describe, expect, it } from "vitest";
import {
  BUILT_IN_ENGINE,
  DEFAULT_SIGNATURE_CONFIG,
  DEFAULT_TSA_URL,
  parseSignatureConfig,
  requiredSignatureTargets,
  resolveTsaUrl,
  validateSignatureConfig,
  type SignatureConfig,
} from "./signature-config";

const certificateConfig = (overrides: Partial<SignatureConfig> = {}): SignatureConfig => ({
  method: "certificate",
  pdfConverter: { source: "external", url: "http://gotenberg:3000" },
  signatureEngine: { source: "external", url: "http://dss:8080" },
  tsaUrl: "http://tsa.example/tsr",
  csc: {
    baseUrl: "https://csc.example/csc/v2",
    clientId: "wayfinder",
    clientSecret: "secret",
  },
  ...overrides,
});

describe("parseSignatureConfig", () => {
  it("defaults to attestation with built-in engines when nothing is stored", () => {
    expect(parseSignatureConfig("")).toEqual(DEFAULT_SIGNATURE_CONFIG);
    expect(DEFAULT_SIGNATURE_CONFIG).toMatchObject({
      method: "attestation",
      pdfConverter: BUILT_IN_ENGINE,
      signatureEngine: BUILT_IN_ENGINE,
    });
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

  it("keeps an install that saved service URLs before engines were built in on those services", () => {
    const config = parseSignatureConfig(
      JSON.stringify({ method: "certificate", gotenbergUrl: " http://g:3000 ", dssUrl: "http://dss:8080" }),
    );

    expect(config.pdfConverter).toEqual({ source: "external", url: "http://g:3000" });
    expect(config.signatureEngine).toEqual({ source: "external", url: "http://dss:8080" });
  });

  it("moves an install that never set a converter onto the built-in one", () => {
    const config = parseSignatureConfig(JSON.stringify({ method: "drawn", gotenbergUrl: "  ", dssUrl: null }));

    expect(config.pdfConverter).toEqual(BUILT_IN_ENGINE);
    expect(config.signatureEngine).toEqual(BUILT_IN_ENGINE);
  });

  it("reads an external choice with no url as built-in rather than a broken service", () => {
    const config = parseSignatureConfig(JSON.stringify({ pdfConverter: { source: "external", url: " " } }));

    expect(config.pdfConverter).toEqual(BUILT_IN_ENGINE);
  });

  it("trims a blank timestamp authority to unset", () => {
    expect(parseSignatureConfig(JSON.stringify({ tsaUrl: "  " })).tsaUrl).toBeNull();
  });
});

describe("resolveTsaUrl", () => {
  it("uses the admin's timestamp authority when one is set", () => {
    expect(resolveTsaUrl(certificateConfig())).toBe("http://tsa.example/tsr");
  });

  it("falls back to DigiCert's public timestamp authority when none is set", () => {
    expect(resolveTsaUrl(certificateConfig({ tsaUrl: null }))).toBe(DEFAULT_TSA_URL);
    expect(DEFAULT_TSA_URL).toBe("http://timestamp.digicert.com");
  });
});

describe("validateSignatureConfig", () => {
  it("accepts attestation with nothing else configured", () => {
    expect(validateSignatureConfig(DEFAULT_SIGNATURE_CONFIG)).toEqual([]);
  });

  it("accepts a complete certificate config", () => {
    expect(validateSignatureConfig(certificateConfig())).toEqual([]);
  });

  it("accepts certificate signing on built-in engines with no timestamp authority set", () => {
    const config = certificateConfig({
      pdfConverter: BUILT_IN_ENGINE,
      signatureEngine: BUILT_IN_ENGINE,
      tsaUrl: null,
    });

    expect(validateSignatureConfig(config)).toEqual([]);
  });

  it("still needs a signing provider for certificate signatures", () => {
    expect(validateSignatureConfig(certificateConfig({ csc: null }))).toEqual([
      "A remote signing provider is required for digital certificate signatures.",
    ]);
  });

  it("needs a url for an engine set to external", () => {
    const problems = validateSignatureConfig({
      ...DEFAULT_SIGNATURE_CONFIG,
      signatureEngine: { source: "external", url: "" },
    });

    expect(problems).toEqual(["A signature engine URL is required when it is set to External."]);
  });

  it("rejects a url that is not http or https", () => {
    const problems = validateSignatureConfig({
      ...DEFAULT_SIGNATURE_CONFIG,
      pdfConverter: { source: "external", url: "ftp://x" },
    });

    expect(problems).toEqual(["PDF converter URL must be an http(s) URL."]);
  });
});

describe("requiredSignatureTargets", () => {
  it("needs nothing for attestation on the built-in converter, so no engine starts", () => {
    expect(requiredSignatureTargets(DEFAULT_SIGNATURE_CONFIG)).toEqual([]);
  });

  it("needs an external PDF converter whenever one is configured, so a toggle can rely on it", () => {
    expect(
      requiredSignatureTargets({
        ...DEFAULT_SIGNATURE_CONFIG,
        method: "drawn",
        pdfConverter: { source: "external", url: "http://g" },
      }),
    ).toEqual(["pdf-converter"]);
  });

  it("needs all four services for certificate signatures, built-in or not", () => {
    const expected = ["pdf-converter", "signature-engine", "timestamp-authority", "signing-provider"];

    expect(requiredSignatureTargets(certificateConfig())).toEqual(expected);
    expect(
      requiredSignatureTargets(certificateConfig({ pdfConverter: BUILT_IN_ENGINE, signatureEngine: BUILT_IN_ENGINE })),
    ).toEqual(expected);
  });
});
