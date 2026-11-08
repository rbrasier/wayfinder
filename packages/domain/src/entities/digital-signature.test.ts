import { describe, expect, it } from "vitest";
import {
  badgeForReport,
  certificateCheckFailure,
  type CertificateCheck,
  type EngineSignatureReport,
} from "./digital-signature";

const NOW = new Date("2026-11-08T10:00:00Z");

const report = (overrides: Partial<EngineSignatureReport> = {}): EngineSignatureReport => ({
  id: "S-1",
  indication: "TOTAL_PASSED",
  subIndication: null,
  signedBy: "Jane Doe",
  signingTime: "2026-11-08T09:00:00Z",
  level: "PAdES_BASELINE_LTA",
  timestampTimes: ["2026-11-08T09:00:01Z"],
  certificate: {
    subject: "CN=Jane Doe",
    issuer: "CN=Root",
    serialNumber: "1000",
    notAfter: "2027-11-08T00:00:00Z",
    sha256: "ab",
  },
  ...overrides,
});

describe("badgeForReport", () => {
  it("is valid when the engine passes it and the certificate is current", () => {
    expect(badgeForReport(report(), NOW)).toEqual({ badge: "valid", reason: null });
  });

  it("is valid-but-expired when it passes on a certificate that has since expired", () => {
    const expired = report({ certificate: { ...report().certificate!, notAfter: "2026-01-01T00:00:00Z" } });

    expect(badgeForReport(expired, NOW)).toEqual({ badge: "valid-but-expired", reason: "expired" });
  });

  it.each([
    ["TOTAL_FAILED", "HASH_FAILURE"],
    ["TOTAL_FAILED", "SIG_CRYPTO_FAILURE"],
    ["INDETERMINATE", "HASH_FAILURE"],
  ])("is invalid-modified for %s / %s", (indication, subIndication) => {
    expect(badgeForReport(report({ indication, subIndication }), NOW)).toEqual({
      badge: "invalid-modified",
      reason: "modified",
    });
  });

  it.each([
    ["REVOKED_NO_POE", "revoked"],
    ["OUT_OF_BOUNDS_NO_POE", "expired"],
    ["NO_CERTIFICATE_CHAIN_FOUND", "untrusted"],
    ["CHAIN_CONSTRAINTS_FAILURE", "wrong_key_usage"],
    ["TRY_LATER", "unavailable"],
    ["SOMETHING_NEW", "indeterminate"],
  ])("is unverifiable for INDETERMINATE / %s, with reason %s", (subIndication, reason) => {
    expect(badgeForReport(report({ indication: "INDETERMINATE", subIndication }), NOW)).toEqual({
      badge: "unverifiable",
      reason,
    });
  });
});

describe("certificateCheckFailure", () => {
  const check = (overrides: Partial<CertificateCheck> = {}): CertificateCheck => ({
    keyUsageAllowsSigning: true,
    validNow: true,
    revoked: false,
    indication: "PASSED",
    subIndication: null,
    ...overrides,
  });

  it("accepts a current, trusted, signing certificate", () => {
    expect(certificateCheckFailure(check())).toBeNull();
  });

  it("names each refusal", () => {
    expect(certificateCheckFailure(check({ validNow: false }))).toBe("expired");
    expect(certificateCheckFailure(check({ revoked: true }))).toBe("revoked");
    expect(certificateCheckFailure(check({ keyUsageAllowsSigning: false }))).toBe("wrong_key_usage");
    expect(
      certificateCheckFailure(check({ indication: "INDETERMINATE", subIndication: "NO_CERTIFICATE_CHAIN_FOUND" })),
    ).toBe("untrusted");
  });

  it("fails closed on anything short of a pass", () => {
    expect(certificateCheckFailure(check({ indication: "INDETERMINATE", subIndication: "TRY_LATER" }))).toBe(
      "unavailable",
    );
    expect(certificateCheckFailure(check({ indication: null }))).toBe("indeterminate");
  });
});
