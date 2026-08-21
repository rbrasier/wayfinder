// Mock PKI client-certificate front door, mounted at /pki on the shared mocks
// server.
//
// PKI auth is not a redirect-based identity provider like Entra — there is no
// authority to point at. Wayfinder's contract (ADR-025, PkiCertAdapter) is with
// a reverse proxy that terminates mTLS and forwards the verified certificate as
// headers:
//
//   x-ssl-client-verified     SUCCESS when the CA chain validated
//   x-ssl-client-subject-dn   the certificate subject
//   x-ssl-client-fingerprint  a stable per-certificate identifier
//   x-ssl-client-san-email    the SAN rfc822Name, when the cert carries one
//
// The app trusts those headers only from an IP in PKI_TRUSTED_PROXY_IPS, so the
// thing to mock is the proxy, not an identity provider. This mock stands in for
// nginx with `ssl_verify_client on`:
//
//   GET  /pki/connect?redirect=/admin   → certificate picker
//   POST /pki/connect                   → forwards to the app as that certificate
//
// The picker submission is server-to-server: the mock POSTs to the app's
// /api/auth/cert with the cert headers set, takes the session cookie off the
// app's response, replays it to the browser, and sends the browser on to the
// app. Cookie scope ignores port, so a cookie set from localhost:4001 is
// presented to the app on localhost:3000 — which is what makes a side-door mock
// work without proxying every asset request.
//
// Never point this at anything real: it mints a Wayfinder session for any
// address typed into the form, which is exactly what a trusted proxy is
// permitted to do.

import { createHash } from "node:crypto";
import { featuredEmployees } from "../directory/roster.mjs";

const BASE_PATH = "/pki";

// Where the app under test is listening. The mock talks to it server-side.
const APP_ORIGIN = process.env.MOCK_PKI_APP_ORIGIN ?? "http://localhost:3000";

// What the app sees as the request source. Must appear in the app's
// PKI_TRUSTED_PROXY_IPS or every sign-in comes back 401.
const FORWARDED_FOR = process.env.MOCK_PKI_FORWARDED_FOR ?? "127.0.0.1";

// The same identities the mock Entra picker features, drawn from the roster the
// mock HR upload and the mock Graph also serve. Signing in by certificate and by
// Entra therefore collide on one address, which is what keeps "one address is
// one account" testable across the two methods.
const seededCertificates = () =>
  featuredEmployees().map((employee) => ({
    email: employee.email,
    name: employee.name,
    organisationalUnit: employee.businessUnit,
  }));

// RFC 4514 §3: a comma inside an attribute value is escaped, not a separator.
// A "Surname, Given" common name is a routine CA issuance convention, so the
// mock has to be able to produce one — it is the shape that breaks a DN parser
// that splits on commas.
const escapeRdnValue = (value) => value.replace(/([,+"\\<>;=])/g, "\\$1");

const subjectDnFor = (name, organisationalUnit, emailAddress = null) => {
  const rdns = [`CN=${escapeRdnValue(name)}`];
  if (emailAddress) rdns.push(`emailAddress=${escapeRdnValue(emailAddress)}`);
  rdns.push(`OU=${escapeRdnValue(organisationalUnit)}`, "O=Wayfinder", "C=GB");
  return rdns.join(",");
};

// "Lovelace, Ada" from "Ada Lovelace" — how a CA that orders names
// surname-first would issue the same person.
const surnameFirst = (name) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts.at(-1)}, ${parts.slice(0, -1).join(" ")}`;
};

// nginx computes $ssl_client_fingerprint with SHA-1 and forwards it as bare hex
// — no algorithm prefix. Stable across restarts so a repeat sign-in refreshes
// the same cert_fingerprint rather than looking like a newly issued certificate.
const fingerprintFor = (email) =>
  createHash("sha1").update(email.trim().toLowerCase()).digest("hex");

// $ssl_client_verify is "SUCCESS", "NONE" when no certificate was presented, or
// "FAILED:<reason>" (nginx >= 1.11.7). The adapter treats anything but SUCCESS
// as a rejection, so what matters here is that the mock never teaches a string
// shape no real proxy sends.
const VERIFICATION_FAILURE = "FAILED:unable to get local issuer certificate";

const escapeHtml = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const sendHtml = (res, status, html) => {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
};

const pickerPage = (redirectPath) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Mock PKI — present a certificate</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 30rem; margin: 4rem auto; padding: 0 1rem; }
    h1 { font-size: 1.25rem; }
    .hint { color: #666; font-size: 0.85rem; }
    button, input, select, label { font: inherit; }
    ul { list-style: none; padding: 0; }
    li { margin: 0.5rem 0; }
    li button { width: 100%; text-align: left; padding: 0.6rem 0.8rem; cursor: pointer; }
    form.custom { margin-top: 1.5rem; border-top: 1px solid #ddd; padding-top: 1rem; }
    form.custom input[type="email"] { width: 100%; padding: 0.5rem; box-sizing: border-box; }
    form.custom .row { margin: 0.5rem 0; }
  </style>
</head>
<body>
  <h1>Mock PKI reverse proxy</h1>
  <p class="hint">
    Stands in for nginx terminating mTLS. Choosing a certificate forwards it to
    <code>${escapeHtml(APP_ORIGIN)}/api/auth/cert</code> as
    <code>x-ssl-client-*</code> headers. Not a real certificate authority.
  </p>
  <ul>
    ${seededCertificates().map(
      (certificate) => `<li>
      <form method="post">
        <input type="hidden" name="redirect" value="${escapeHtml(redirectPath)}" />
        <input type="hidden" name="email" value="${escapeHtml(certificate.email)}" />
        <input type="hidden" name="name" value="${escapeHtml(certificate.name)}" />
        <input type="hidden" name="organisational_unit" value="${escapeHtml(certificate.organisationalUnit)}" />
        <button type="submit" data-testid="mock-pki-certificate">${escapeHtml(certificate.name)} — ${escapeHtml(certificate.email)}</button>
      </form>
    </li>`,
    ).join("\n")}
  </ul>
  <form method="post" class="custom">
    <input type="hidden" name="redirect" value="${escapeHtml(redirectPath)}" />
    <div class="row">
      <input type="email" name="email" placeholder="any@address.example" required data-testid="mock-pki-email" />
    </div>
    <div class="row">
      <label>
        <input type="checkbox" name="omit_san_email" value="1" data-testid="mock-pki-omit-san" />
        Issue without a SAN email (forces the CN fallback)
      </label>
    </div>
    <div class="row">
      <label>
        <input type="checkbox" name="verification_failed" value="1" data-testid="mock-pki-fail-verification" />
        Fail chain verification (sends <code>x-ssl-client-verified: FAILED:&lt;reason&gt;</code>)
      </label>
    </div>
    <div class="row">
      <label>
        <input type="checkbox" name="surname_first" value="1" data-testid="mock-pki-surname-first" />
        Issue a surname-first CN (<code>CN=Surname\, Given</code> — an escaped comma)
      </label>
    </div>
    <div class="row">
      <label>
        <input type="checkbox" name="dn_email" value="1" data-testid="mock-pki-dn-email" />
        Put the address in the subject as <code>emailAddress=</code>, with no SAN
      </label>
    </div>
    <div class="row">
      <label>
        <input type="checkbox" name="no_certificate" value="1" data-testid="mock-pki-no-cert" />
        Present no certificate at all (sends <code>x-ssl-client-verified: NONE</code>)
      </label>
    </div>
    <button type="submit" data-testid="mock-pki-submit">Present certificate</button>
  </form>
</body>
</html>`;

const rejectionPage = (status, detail) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Mock PKI — certificate rejected</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 30rem; margin: 4rem auto; padding: 0 1rem; }
    pre { background: #f4f4f4; padding: 0.75rem; overflow-x: auto; }
  </style>
</head>
<body>
  <h1 data-testid="mock-pki-rejected">Certificate rejected</h1>
  <p>The app answered <code>${status}</code>.</p>
  <pre data-testid="mock-pki-rejection-detail">${escapeHtml(detail)}</pre>
  <p><a href="${escapeHtml(BASE_PATH)}/connect">Present a different certificate</a></p>
</body>
</html>`;

// Only same-origin app paths — the mock hands this straight to the browser as a
// Location, and an absolute URL here would make it an open redirector.
const safeRedirectPath = (raw) => {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
};

export const certificateHeadersFor = (form) => {
  const email = form.get("email")?.trim().toLowerCase() ?? "";
  const name = form.get("name")?.trim() || email;
  const organisationalUnit = form.get("organisational_unit")?.trim() || "Engineering";

  // No certificate at all — the user dismissed the smart-card prompt. nginx
  // reports NONE and forwards no certificate fields.
  if (form.get("no_certificate") === "1") {
    return { "x-ssl-client-verified": "NONE", "x-forwarded-for": FORWARDED_FOR };
  }

  // With no SAN email the adapter falls back to the subject — either an
  // emailAddress attribute, which is what a CA issuing without SANs normally
  // sets, or a CN that happens to be an address.
  const omitSanEmail = form.get("omit_san_email") === "1";
  const addressInDn = form.get("dn_email") === "1";
  const withoutSan = omitSanEmail || addressInDn;
  const displayName = form.get("surname_first") === "1" ? surnameFirst(name) : name;
  const commonName = omitSanEmail && !addressInDn ? email : displayName;

  const headers = {
    "x-ssl-client-verified":
      form.get("verification_failed") === "1" ? VERIFICATION_FAILURE : "SUCCESS",
    "x-ssl-client-subject-dn": subjectDnFor(
      commonName,
      organisationalUnit,
      addressInDn ? email : null,
    ),
    "x-ssl-client-fingerprint": fingerprintFor(email),
    "x-forwarded-for": FORWARDED_FOR,
  };
  if (!withoutSan) headers["x-ssl-client-san-email"] = email;

  return headers;
};

const handleConnectGet = (res, url) => {
  sendHtml(res, 200, pickerPage(safeRedirectPath(url.searchParams.get("redirect"))));
};

const handleConnectPost = async (req, res) => {
  const form = new URLSearchParams(await readBody(req));
  const email = form.get("email")?.trim();
  if (!email) {
    sendHtml(res, 400, rejectionPage(400, "no email on the submitted certificate"));
    return;
  }

  const redirectPath = safeRedirectPath(form.get("redirect"));
  const certRoute = new URL("/api/auth/cert", APP_ORIGIN);
  certRoute.searchParams.set("redirect", redirectPath);

  const appResponse = await fetch(certRoute, {
    method: "POST",
    headers: certificateHeadersFor(form),
    redirect: "manual",
  });

  // The route answers 302 + Set-Cookie on success, and a JSON error otherwise.
  const sessionCookies = appResponse.headers.getSetCookie();
  if (sessionCookies.length === 0) {
    sendHtml(res, 200, rejectionPage(appResponse.status, await appResponse.text()));
    return;
  }

  res.writeHead(302, {
    "Set-Cookie": sessionCookies,
    Location: new URL(redirectPath, APP_ORIGIN).toString(),
  });
  res.end();
};

async function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const endpoint = url.pathname.slice(BASE_PATH.length).replace(/^\/+/, "");

  if (endpoint === "connect" && req.method === "GET") {
    handleConnectGet(res, url);
    return;
  }

  if (endpoint === "connect" && req.method === "POST") {
    await handleConnectPost(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}

export const mock = {
  path: BASE_PATH,
  label: "pki (mock mTLS reverse proxy)",
  handle,
};
