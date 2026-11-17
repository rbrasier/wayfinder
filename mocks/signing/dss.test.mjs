import { describe, expect, it } from "vitest";
import { json, request, response } from "../test-support/http.mjs";
import { createTestAuthority } from "./test-ca.mjs";
import { mock } from "./dss.mjs";

const authority = await createTestAuthority("http://localhost:4001");

const call = async (path, body) => {
  const res = response();
  await mock.handle(request("POST", `/dss${path}`, JSON.stringify(body), { "Content-Type": "application/json" }), res);
  return json(res.recorded);
};

const parametersFor = (scenario, pdf = Buffer.from("%PDF-1.7 frozen")) => ({
  pdf: pdf.toString("base64"),
  certificateChain: authority.chainOf(authority.signerById(scenario)),
  signingTime: "2026-11-08T10:00:00.000Z",
});

describe("the canned DSS mock", () => {
  it.each([
    ["valid", { indication: "PASSED" }],
    ["expired", { validNow: false }],
    ["revoked", { revoked: true }],
    ["wrong-key-usage", { keyUsageAllowsSigning: false }],
    ["untrusted", { subIndication: "NO_CERTIFICATE_CHAIN_FOUND" }],
  ])("checks the %s scenario's certificate as the real engine would", async (scenario, expected) => {
    const prepared = await call("/prepare", parametersFor(scenario));

    expect(prepared.certificateCheck).toMatchObject(expected);
    expect(prepared.dataToSignDigest).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("appends a signature revision that validate reads back, earlier ones intact", async () => {
    const once = Buffer.from((await call("/sign", { ...parametersFor("valid"), signatureValue: "c2ln" })).pdf, "base64");
    const twice = Buffer.from((await call("/sign", { ...parametersFor("valid", once), signatureValue: "c2ln" })).pdf, "base64");

    const report = await call("/validate", { pdf: twice.toString("base64") });

    expect(twice.subarray(0, once.length).equals(once)).toBe(true);
    expect(report.signatures).toHaveLength(2);
    expect(report.signatures[0]).toMatchObject({ indication: "TOTAL_PASSED", signedBy: "Jane Doe", level: "PAdES_BASELINE_LTA" });
  });
});
