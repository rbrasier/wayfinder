// Mock CSC v2 remote-signing provider (ETSI TS 119 432), mounted at /csc.
//
//   POST /csc/v2/info                      → service info, oauth2 base
//   GET  /csc/oauth2/authorize             → the signer's consent page
//   POST /csc/oauth2/authorize             → redirect back with a code
//   POST /csc/oauth2/token                 → access token (service or credential)
//   POST /csc/v2/credentials/list          → the signer's credential
//   POST /csc/v2/credentials/info          → its certificate chain
//   POST /csc/v2/signatures/signHash       → RSA signatures over the hashes
//   GET  /csc/test-ca.pem                  → the throwaway root, for the DSS
//                                            sidecar's development trust store
//
// The service-scope consent page is a certificate picker: each scenario is a
// real certificate from the test CA (test-ca.mjs) that fails — or passes —
// one specific check. Point Settings → PDF signatures → Signing provider URL at
// http://localhost:4001/csc/v2, with any client ID and secret.

import { randomBytes } from "node:crypto";
import { SCENARIOS, signDigest } from "./test-ca.mjs";

const BASE_PATH = "/csc";
const SHA256_OID = "2.16.840.1.101.3.4.2.1";

// CSC carries hashes base64url-encoded on the authorize URL and as standard
// base64 in API bodies; compare them in one form.
const standardBase64 = (value) => {
  const plain = value.replace(/-/g, "+").replace(/_/g, "/");
  return plain + "=".repeat((4 - (plain.length % 4)) % 4);
};

const escapeHtml = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const parseBody = (raw, contentType = "") => {
  if (raw.length === 0) return {};
  if (contentType.includes("application/json")) return JSON.parse(raw);
  return Object.fromEntries(new URLSearchParams(raw));
};

const sendJson = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const sendHtml = (res, html) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
};

const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem}
li{margin:.5rem 0;list-style:none}button{font:inherit;width:100%;text-align:left;padding:.6rem .8rem;cursor:pointer}
.hint{color:#666;font-size:.85rem}ul{padding:0}</style></head><body>${body}</body></html>`;

const hiddenFields = (params) =>
  Object.entries(params)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`)
    .join("");

const servicePicker = (params) =>
  page(
    "Mock signing provider — choose your digital ID",
    `<h1>Mock signing provider</h1>
<p class="hint">Choose the digital ID to sign with. Each one exercises a different outcome.</p>
<ul>${SCENARIOS.map(
      (scenario) => `<li><form method="post">${hiddenFields(params)}
<input type="hidden" name="credential" value="${scenario.id}" />
<button type="submit" data-credential="${scenario.id}">${escapeHtml(scenario.label)}</button></form></li>`,
    ).join("")}</ul>`,
  );

const credentialConsent = (params) =>
  page(
    "Mock signing provider — authorise signature",
    `<h1>Authorise this signature</h1>
<p>Digital ID: <strong>${escapeHtml(params.credentialID ?? "")}</strong></p>
<p class="hint">A real provider would ask for a one-time code here.</p>
<form method="post">${hiddenFields(params)}<button type="submit" data-authorise-signature>Authorise signature</button></form>`,
  );

export const createCscMock = (authorityPromise, publicBaseUrl) => {
  const codes = new Map();
  const tokens = new Map();

  const issueCode = (grant) => {
    const code = randomBytes(16).toString("hex");
    codes.set(code, grant);
    return code;
  };

  const bearer = (req) => {
    const header = req.headers.authorization ?? "";
    return tokens.get(header.replace(/^Bearer\s+/i, "")) ?? null;
  };

  const authorize = async (req, res, url) => {
    if (req.method === "GET") {
      const params = Object.fromEntries(url.searchParams);
      sendHtml(res, params.scope === "credential" ? credentialConsent(params) : servicePicker(params));
      return;
    }
    const form = parseBody(await readBody(req), req.headers["content-type"]);
    const credential = form.scope === "credential" ? form.credentialID : form.credential;
    const code = issueCode({
      scope: form.scope === "credential" ? "credential" : "service",
      credential,
      hashes: form.hashes ? form.hashes.split(",").map(standardBase64) : [],
      redirectUri: form.redirect_uri,
    });
    const target = new URL(form.redirect_uri);
    target.searchParams.set("code", code);
    if (form.state) target.searchParams.set("state", form.state);
    res.writeHead(302, { Location: target.toString() });
    res.end();
  };

  const token = async (req, res) => {
    const form = parseBody(await readBody(req), req.headers["content-type"]);
    const grant = codes.get(form.code);
    if (form.grant_type !== "authorization_code" || !grant || !form.client_id || !form.client_secret) {
      sendJson(res, 400, { error: "invalid_grant" });
      return;
    }
    codes.delete(form.code);
    const accessToken = randomBytes(24).toString("hex");
    tokens.set(accessToken, grant);
    sendJson(res, 200, { access_token: accessToken, token_type: "Bearer", expires_in: 300 });
  };

  const credentialsInfo = async (res, body) => {
    const authority = await authorityPromise;
    const signer = authority.signerById(body.credentialID);
    if (!signer) {
      sendJson(res, 400, { error: "invalid_request", error_description: "Unknown credentialID" });
      return;
    }
    sendJson(res, 200, {
      key: { status: "enabled", algo: ["1.2.840.113549.1.1.11"], len: 2048 },
      cert: {
        status: "valid",
        certificates: authority.chainOf(signer),
        subjectDN: signer.certificate.subject,
        issuerDN: signer.certificate.issuer,
        serialNumber: signer.certificate.serialNumber,
      },
      authMode: "oauth2code",
      multisign: 1,
    });
  };

  // A credential token signs only the hashes the signer authorised, with the
  // credential they authorised — the property SCAL2 exists to guarantee.
  const signHash = async (res, grant, body) => {
    const authority = await authorityPromise;
    const hashes = body.hashes ?? [];
    const authorised = grant.scope === "credential" && grant.credential === body.credentialID;
    const covered = hashes.every((hash) => grant.hashes.includes(hash));
    if (!authorised || !covered || body.hashAlgorithmOID !== SHA256_OID) {
      sendJson(res, 403, { error: "invalid_request", error_description: "Hashes not authorised for this credential" });
      return;
    }
    const signer = authority.signerById(body.credentialID);
    const signatures = hashes.map((hash) =>
      signDigest(signer.keys.privateKey, Buffer.from(hash, "base64")).toString("base64"),
    );
    sendJson(res, 200, { signatures });
  };

  const api = async (req, res, endpoint) => {
    const body = parseBody(await readBody(req), "application/json");
    if (endpoint === "/v2/info") {
      sendJson(res, 200, {
        specs: "2.0.0.2",
        name: "Wayfinder mock signing provider",
        region: "AU",
        lang: "en-AU",
        authType: ["oauth2code"],
        oauth2: `${publicBaseUrl}${BASE_PATH}`,
        methods: ["credentials/list", "credentials/info", "signatures/signHash"],
      });
      return;
    }
    const grant = bearer(req);
    if (!grant) {
      sendJson(res, 401, { error: "invalid_token" });
      return;
    }
    if (endpoint === "/v2/credentials/list") {
      sendJson(res, 200, { credentialIDs: grant.credential ? [grant.credential] : [] });
      return;
    }
    if (endpoint === "/v2/credentials/info") {
      await credentialsInfo(res, body);
      return;
    }
    if (endpoint === "/v2/signatures/signHash") {
      await signHash(res, grant, body);
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  };

  const handle = async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const endpoint = url.pathname.slice(BASE_PATH.length);

    if (endpoint === "/test-ca.pem") {
      res.writeHead(200, { "Content-Type": "application/x-pem-file" });
      res.end((await authorityPromise).rootPem);
      return;
    }
    if (endpoint === "/oauth2/authorize") {
      await authorize(req, res, url);
      return;
    }
    if (endpoint === "/oauth2/token" && req.method === "POST") {
      await token(req, res);
      return;
    }
    if (req.method === "POST" && endpoint.startsWith("/v2/")) {
      await api(req, res, endpoint);
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  };

  return { path: BASE_PATH, label: "CSC remote signing provider (mock)", handle };
};

// The CRL the test CA's certificates point at. DSS fetches it while building
// B-LT revocation data; it lists the "revoked" scenario's certificate.
export const createRevocationMock = (authorityPromise) => ({
  path: "/ocsp",
  label: "Revocation list for the test CA (mock)",
  handle: async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== "/ocsp/root.crl") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    res.writeHead(200, { "Content-Type": "application/pkix-crl" });
    res.end(await (await authorityPromise).currentCrl());
  },
});
