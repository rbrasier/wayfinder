import { describe, expect, it } from "vitest";
import type { SigningParameters } from "@wayfinder/domain";
import { DssSignatureEngine } from "./dss-signature-engine";

const parameters: SigningParameters = {
  engineUrl: "http://dss:8080/",
  pdf: Buffer.from("%PDF-1.7 doc"),
  certificateChain: ["c2lnbmVy", "cm9vdA=="],
  signingTime: "2026-11-08T10:00:00.000Z",
  reason: "Within delegated authority.",
  appearance: { page: 1, x: 72, y: 600, width: 200, height: 60, imagePng: Buffer.from("png"), text: "Jane Doe" },
};

const capture = (respond: () => Response) => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return respond();
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
};

const check = { keyUsageAllowsSigning: true, validNow: true, revoked: false, indication: "PASSED", subIndication: null };

describe("DssSignatureEngine", () => {
  it("sends prepare the document, chain, time, reason and appearance in the sidecar's JSON", async () => {
    const { fetchFn, calls } = capture(() => Response.json({ dataToSignDigest: "ZGlnZXN0", certificateCheck: check }));

    const result = await new DssSignatureEngine(fetchFn).prepare(parameters);

    expect(result.data).toEqual({ dataToSignDigest: "ZGlnZXN0", certificateCheck: check });
    expect(calls[0]!.url).toBe("http://dss:8080/prepare");
    expect(calls[0]!.body).toEqual({
      pdf: Buffer.from("%PDF-1.7 doc").toString("base64"),
      certificateChain: ["c2lnbmVy", "cm9vdA=="],
      signingTime: "2026-11-08T10:00:00.000Z",
      reason: "Within delegated authority.",
      appearance: { page: 1, x: 72, y: 600, width: 200, height: 60, imagePng: Buffer.from("png").toString("base64"), text: "Jane Doe" },
    });
  });

  it("returns the signed PDF bytes from sign", async () => {
    const signed = Buffer.from("%PDF-1.7 signed");
    const { fetchFn, calls } = capture(() => Response.json({ pdf: signed.toString("base64") }));

    const result = await new DssSignatureEngine(fetchFn).sign({
      ...parameters,
      signatureValue: "c2ln",
      tsaUrl: "http://tsa/tsr",
    });

    expect(result.data?.equals(signed)).toBe(true);
    expect(calls[0]!.body).toMatchObject({ signatureValue: "c2ln", signatureAlgorithm: "RSA_SHA256", tsaUrl: "http://tsa/tsr" });
  });

  it("reads every signature's report from validate", async () => {
    const reportEntry = {
      id: "S-1",
      indication: "TOTAL_PASSED",
      subIndication: null,
      signedBy: "Jane Doe",
      signingTime: "2026-11-08T10:00:00Z",
      bestSignatureTime: "2026-11-08T10:00:01Z",
      level: "PAdES_BASELINE_LTA",
      timestampTimes: ["2026-11-08T10:00:01Z"],
      certificate: { subject: "CN=Jane Doe", issuer: "CN=Root", serialNumber: "4096", notAfter: "2027-01-01T00:00:00Z", sha256: "ab" },
    };
    const { fetchFn } = capture(() => Response.json({ signatures: [reportEntry] }));

    const result = await new DssSignatureEngine(fetchFn).validate("http://dss:8080", Buffer.from("%PDF"));

    expect(result.data).toEqual([
      {
        id: "S-1",
        indication: "TOTAL_PASSED",
        subIndication: null,
        signedBy: "Jane Doe",
        signingTime: "2026-11-08T10:00:00Z",
        level: "PAdES_BASELINE_LTA",
        timestampTimes: ["2026-11-08T10:00:01Z"],
        certificate: reportEntry.certificate,
      },
    ]);
  });

  it("maps a sidecar error to an infrastructure failure with its message", async () => {
    const { fetchFn } = capture(() => Response.json({ error: "certificateChain must list the signing certificate first" }, { status: 400 }));

    const result = await new DssSignatureEngine(fetchFn).prepare(parameters);

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(result.error?.message).toBe("The signature engine refused: certificateChain must list the signing certificate first");
  });

  it("reports an unreachable sidecar", async () => {
    const fetchFn = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const result = await new DssSignatureEngine(fetchFn).validate("http://dss:8080", Buffer.from("%PDF"));

    expect(result.error?.message).toBe("The signature engine is unreachable.");
  });
});
