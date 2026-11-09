import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNATURE_CONFIG,
  parseSignatureConfig,
  SIGNATURE_CONFIG_SETTING_KEY,
  type ConnectivityResult,
  type ISignatureServicesProbe,
  type SignatureConfig,
  type SignatureServiceTarget,
} from "@wayfinder/domain";
import { InMemoryAuditLog, InMemorySystemSettings } from "../__fixtures__/presentation-doubles";
import { GetSignatureConfig } from "./get-signature-config";
import { SaveSignatureConfig, type SignatureConfigInput } from "./save-signature-config";
import { TestSignatureConfig } from "./test-signature-config";

const ADMIN_ID = "admin-1";

class ScriptedProbe implements ISignatureServicesProbe {
  readonly probed: Array<{ target: SignatureServiceTarget; config: SignatureConfig }> = [];
  failing = new Set<SignatureServiceTarget>();

  async probe(target: SignatureServiceTarget, config: SignatureConfig): Promise<ConnectivityResult> {
    this.probed.push({ target, config });
    if (this.failing.has(target)) return { target, ok: false, message: `${target} unreachable` };
    return { target, ok: true, latencyMs: 5 };
  }
}

const certificateInput = (overrides: Partial<SignatureConfigInput> = {}): SignatureConfigInput => ({
  method: "certificate",
  pdfConverter: { source: "external", url: "http://gotenberg:3000" },
  signatureEngine: { source: "external", url: "http://dss:8080" },
  tsaUrl: "http://localhost:4001/tsa",
  csc: { baseUrl: "http://localhost:4001/csc/v2", clientId: "wayfinder", clientSecret: "s3cret" },
  ...overrides,
});

const stored = (settings: InMemorySystemSettings): SignatureConfig =>
  parseSignatureConfig(settings.values.get(SIGNATURE_CONFIG_SETTING_KEY) ?? "");

const build = () => {
  const settings = new InMemorySystemSettings();
  const audit = new InMemoryAuditLog();
  const probe = new ScriptedProbe();
  const tester = new TestSignatureConfig(probe);
  return {
    settings,
    audit,
    probe,
    tester,
    save: new SaveSignatureConfig(settings, tester, audit),
    get: new GetSignatureConfig(settings),
  };
};

describe("TestSignatureConfig", () => {
  it("probes only what the method needs", async () => {
    const { tester, probe } = build();

    const result = await tester.execute({
      ...DEFAULT_SIGNATURE_CONFIG,
      method: "drawn",
      pdfConverter: { source: "external", url: "http://g" },
    });

    expect(result.map((entry) => entry.target)).toEqual(["pdf-converter"]);
    expect(probe.probed).toHaveLength(1);
  });

  it("probes all four services for certificate signatures, against the candidate values", async () => {
    const { tester, probe } = build();
    const candidate = parseSignatureConfig(JSON.stringify(certificateInput()));

    await tester.execute(candidate);

    expect(probe.probed.map((entry) => entry.target)).toEqual([
      "pdf-converter",
      "signature-engine",
      "timestamp-authority",
      "signing-provider",
    ]);
    expect(probe.probed.every((entry) => entry.config === candidate)).toBe(true);
  });
});

describe("SaveSignatureConfig", () => {
  it("saves attestation without probing anything", async () => {
    const { save, settings, probe, audit } = build();

    const result = await save.execute({ ...DEFAULT_SIGNATURE_CONFIG }, ADMIN_ID);

    expect(result.error).toBeUndefined();
    expect(stored(settings).method).toBe("attestation");
    expect(probe.probed).toEqual([]);
    expect(audit.rows.map((row) => row.action)).toEqual(["settings.signature.updated"]);
  });

  it("saves a certificate config once every probe passes", async () => {
    const { save, settings } = build();

    const result = await save.execute(certificateInput(), ADMIN_ID);

    expect(result.error).toBeUndefined();
    expect(stored(settings).method).toBe("certificate");
    expect(stored(settings).csc?.clientSecret).toBe("s3cret");
  });

  it("refuses to save when a required probe fails, naming it, and writes nothing", async () => {
    const { save, settings, probe, audit } = build();
    probe.failing.add("timestamp-authority");

    const result = await save.execute(certificateInput(), ADMIN_ID);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("timestamp-authority unreachable");
    expect(settings.values.has(SIGNATURE_CONFIG_SETTING_KEY)).toBe(false);
    expect(audit.rows).toEqual([]);
  });

  it("refuses an incomplete certificate config before probing", async () => {
    const { save, probe } = build();

    const result = await save.execute(certificateInput({ csc: null }), ADMIN_ID);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("remote signing provider is required");
    expect(probe.probed).toEqual([]);
  });

  it("saves certificate signing on built-in engines with no timestamp authority set", async () => {
    const { save, settings, probe } = build();

    const result = await save.execute(
      certificateInput({ pdfConverter: { source: "built-in" }, signatureEngine: { source: "built-in" }, tsaUrl: null }),
      ADMIN_ID,
    );

    expect(result.error).toBeUndefined();
    expect(stored(settings)).toMatchObject({
      pdfConverter: { source: "built-in" },
      signatureEngine: { source: "built-in" },
      tsaUrl: null,
    });
    expect(probe.probed.map((entry) => entry.target)).toContain("timestamp-authority");
  });

  it("keeps the stored client secret when the form leaves it blank", async () => {
    const { save, settings } = build();
    await save.execute(certificateInput(), ADMIN_ID);

    const result = await save.execute(
      certificateInput({ csc: { baseUrl: "http://localhost:4001/csc/v2", clientId: "wayfinder", clientSecret: "" } }),
      ADMIN_ID,
    );

    expect(result.error).toBeUndefined();
    expect(stored(settings).csc?.clientSecret).toBe("s3cret");
  });

  it("never writes the client secret into the audit log", async () => {
    const { save, audit } = build();

    await save.execute(certificateInput(), ADMIN_ID);

    expect(JSON.stringify(audit.rows)).not.toContain("s3cret");
  });
});

describe("GetSignatureConfig", () => {
  it("returns the default when nothing is stored", async () => {
    const { get } = build();

    const result = await get.execute();

    expect(result.data?.method).toBe("attestation");
    expect(result.data?.csc).toBeNull();
    expect(result.data?.pdfConverter).toEqual({ source: "built-in" });
    expect(result.data?.signatureEngine).toEqual({ source: "built-in" });
  });

  it("returns the engine choices that were saved", async () => {
    const { save, get } = build();
    await save.execute(certificateInput(), ADMIN_ID);

    const result = await get.execute();

    expect(result.data?.pdfConverter).toEqual({ source: "external", url: "http://gotenberg:3000" });
    expect(result.data?.signatureEngine).toEqual({ source: "external", url: "http://dss:8080" });
  });

  it("masks the client secret, reporting only that one is set", async () => {
    const { save, get } = build();
    await save.execute(certificateInput(), ADMIN_ID);

    const result = await get.execute();

    expect(result.data?.csc).toEqual({
      baseUrl: "http://localhost:4001/csc/v2",
      clientId: "wayfinder",
      hasClientSecret: true,
    });
    expect(JSON.stringify(result.data)).not.toContain("s3cret");
  });
});
