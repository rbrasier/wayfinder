// Real-crypto check of the signing chain (ADR-067 §7): the mocks server's CSC
// provider, timestamp authority and CRL, and this DSS sidecar, with no fakes in
// between. Signs a PDF twice, checks both signatures validate at PAdES B-LTA,
// that the second is an incremental revision, that tampering is caught, and
// that every refusal scenario is refused before anything is signed.
//
//   MOCKS_URL=http://localhost:4001 DSS_URL=http://localhost:8085 node smoke-test.mjs

import assert from "node:assert/strict";
import { minimalPdf } from "../../mocks/signing/minimal-pdf.mjs";

const MOCKS = process.env.MOCKS_URL ?? "http://localhost:4001";
const DSS = process.env.DSS_URL ?? "http://localhost:8085";
const REDIRECT = "http://localhost:3000/api/signing/csc/callback";

const form = (fields) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
  redirect: "manual",
});

const postJson = async (url, body, token) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${url}: ${JSON.stringify(json)}`);
  return json;
};

const grant = async (fields) => {
  const authorized = await fetch(`${MOCKS}/csc/oauth2/authorize`, form({ redirect_uri: REDIRECT, ...fields }));
  const code = new URL(authorized.headers.get("location")).searchParams.get("code");
  const token = await fetch(
    `${MOCKS}/csc/oauth2/token`,
    form({ grant_type: "authorization_code", code, client_id: "smoke", client_secret: "smoke", redirect_uri: REDIRECT }),
  );
  return (await token.json()).access_token;
};

const prepareAs = async (pdfBase64, credential, y) => {
  const serviceToken = await grant({ scope: "service", credential });
  const info = await postJson(`${MOCKS}/csc/v2/credentials/info`, { credentialID: credential, certificates: "chain" }, serviceToken);
  const parameters = {
    pdf: pdfBase64,
    certificateChain: info.cert.certificates,
    signingTime: new Date().toISOString(),
    reason: "Smoke test",
    appearance: { page: 1, x: 72, y, width: 200, height: 60, text: `Digitally signed (${credential})` },
  };
  const prepared = await postJson(`${DSS}/prepare`, parameters);
  return { parameters, prepared };
};

const sign = async (pdfBase64, y) => {
  const { parameters, prepared } = await prepareAs(pdfBase64, "valid", y);
  assert.equal(prepared.certificateCheck.indication, "PASSED", "the valid certificate passes its check");
  const credentialToken = await grant({
    scope: "credential",
    credentialID: "valid",
    hashes: Buffer.from(prepared.dataToSignDigest, "base64").toString("base64url"),
  });
  const signed = await postJson(
    `${MOCKS}/csc/v2/signatures/signHash`,
    { credentialID: "valid", hashes: [prepared.dataToSignDigest], hashAlgorithmOID: "2.16.840.1.101.3.4.2.1", signAlgo: "1.2.840.113549.1.1.11" },
    credentialToken,
  );
  const result = await postJson(`${DSS}/sign`, {
    ...parameters,
    signatureValue: signed.signatures[0],
    signatureAlgorithm: "RSA_SHA256",
    tsaUrl: `${MOCKS}/tsa`,
  });
  return result.pdf;
};

const original = minimalPdf("Wayfinder signing smoke test").toString("base64");

const refusals = {
  expired: (check) => check.validNow === false,
  revoked: (check) => check.revoked === true,
  "wrong-key-usage": (check) => check.keyUsageAllowsSigning === false,
  untrusted: (check) => check.subIndication?.startsWith("NO_CERTIFICATE_CHAIN_FOUND"),
};
for (const [credential, refused] of Object.entries(refusals)) {
  const { prepared } = await prepareAs(original, credential, 100);
  assert.ok(refused(prepared.certificateCheck), `${credential}: ${JSON.stringify(prepared.certificateCheck)}`);
  console.log(`ok - ${credential} certificate is refused before signing`);
}

const once = await sign(original, 600);
const twice = await sign(once, 680);
assert.ok(
  Buffer.from(twice, "base64").subarray(0, Buffer.from(once, "base64").length).equals(Buffer.from(once, "base64")),
  "the second signature is an incremental revision",
);
console.log("ok - second signature is added incrementally");

const report = await postJson(`${DSS}/validate`, { pdf: twice });
assert.equal(report.signatures.length, 2);
for (const signature of report.signatures) {
  assert.equal(signature.indication, "TOTAL_PASSED", JSON.stringify(signature));
  assert.equal(signature.level, "PAdES_BASELINE_LTA", JSON.stringify(signature));
}
console.log("ok - both signatures validate at PAdES B-LTA");

const tampered = Buffer.from(twice, "base64");
const target = tampered.indexOf("Wayfinder signing smoke test");
tampered[target] = tampered[target] ^ 0x20;
const tamperedReport = await postJson(`${DSS}/validate`, { pdf: tampered.toString("base64") });
for (const signature of tamperedReport.signatures) {
  assert.equal(signature.indication, "TOTAL_FAILED", JSON.stringify(signature));
}
console.log("ok - a changed byte invalidates every signature");
