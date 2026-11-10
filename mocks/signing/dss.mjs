// Canned stand-in for the DSS signature engine sidecar, mounted at /dss.
//
//   GET  /dss/health     POST /dss/prepare     POST /dss/sign     POST /dss/validate
//
// Lets the e2e suite drive certificate signing end to end without a JVM. It
// reads the signer's certificate to decide the certificate check — so the CSC
// picker's scenarios still refuse for the right reason — and "signs" by
// appending a marker revision, which validate reads back. It builds no PAdES:
// the real engine is exercised against the real crypto by
// deploy/dss/smoke-test.mjs. Never point a real deployment at it.

import { createHash, X509Certificate } from "node:crypto";

const BASE_PATH = "/dss";
const MARKER = "%wayfinder-mock-signature ";

const readJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

const sendJson = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const certificateOf = (request) => new X509Certificate(Buffer.from(request.certificateChain[0], "base64"));

const commonName = (distinguishedName) => /CN=([^\n,]+)/.exec(distinguishedName)?.[1] ?? "";

// Mirrors what the real engine reports for each picker scenario.
export const certificateCheckFor = (certificate) => {
  const name = commonName(certificate.subject);
  const check = { keyUsageAllowsSigning: true, validNow: true, revoked: false, indication: "PASSED", subIndication: null };
  if (name === "Expired Signer") return { ...check, validNow: false, indication: "INDETERMINATE", subIndication: "OUT_OF_BOUNDS_NO_POE" };
  if (name === "Revoked Signer") return { ...check, revoked: true, indication: "INDETERMINATE", subIndication: "REVOKED_NO_POE" };
  if (name === "Encryption Only") return { ...check, keyUsageAllowsSigning: false };
  if (name === "Untrusted Signer") return { ...check, indication: "INDETERMINATE", subIndication: "NO_CERTIFICATE_CHAIN_FOUND" };
  return check;
};

const digestFor = (request) =>
  createHash("sha256").update(`${request.pdf}|${request.signingTime}|${request.certificateChain[0]}`).digest("base64");

const signatureEntry = (request) => {
  const certificate = certificateOf(request);
  return {
    signedBy: commonName(certificate.subject),
    signingTime: request.signingTime,
    certificate: {
      subject: certificate.subject.replace(/\n/g, ","),
      issuer: certificate.issuer.replace(/\n/g, ","),
      serialNumber: BigInt(`0x${certificate.serialNumber}`).toString(),
      notAfter: new Date(certificate.validTo).toISOString(),
      sha256: createHash("sha256").update(certificate.raw).digest("hex"),
    },
  };
};

const readSignatures = (pdf) =>
  pdf
    .toString("latin1")
    .split("\n")
    .filter((line) => line.startsWith(MARKER))
    .map((line, index) => {
      const entry = JSON.parse(Buffer.from(line.slice(MARKER.length), "base64").toString("utf8"));
      return {
        id: `S-MOCK-${index + 1}`,
        indication: "TOTAL_PASSED",
        subIndication: null,
        signedBy: entry.signedBy,
        signingTime: entry.signingTime,
        bestSignatureTime: entry.signingTime,
        level: "PAdES_BASELINE_LTA",
        certificate: entry.certificate,
        timestampTimes: [entry.signingTime],
      };
    });

const handle = async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const endpoint = url.pathname.slice(BASE_PATH.length);

  if (req.method === "GET" && endpoint === "/health") {
    sendJson(res, 200, { status: "up", trustAnchors: 1 });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }

  const request = await readJson(req);
  if (endpoint === "/prepare") {
    sendJson(res, 200, { dataToSignDigest: digestFor(request), certificateCheck: certificateCheckFor(certificateOf(request)) });
    return;
  }
  if (endpoint === "/sign") {
    const line = `\n${MARKER}${Buffer.from(JSON.stringify(signatureEntry(request))).toString("base64")}\n`;
    const signed = Buffer.concat([Buffer.from(request.pdf, "base64"), Buffer.from(line, "latin1")]);
    sendJson(res, 200, { pdf: signed.toString("base64") });
    return;
  }
  if (endpoint === "/validate") {
    sendJson(res, 200, { signatures: readSignatures(Buffer.from(request.pdf, "base64")) });
    return;
  }
  sendJson(res, 404, { error: "not found" });
};

export const mock = { path: BASE_PATH, label: "DSS signature engine (canned mock)", handle };
