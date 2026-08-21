// Mock Microsoft Entra ID, mounted at /entra on the shared mocks server.
//
// Better Auth's Microsoft provider derives every endpoint from
// `options.authority` (default https://login.microsoftonline.com), so pointing
// ENTRA_AUTHORITY at http://localhost:4001/entra routes the whole OAuth code
// flow here:
//
//   GET  /entra/:tenant/oauth2/v2.0/authorize      → identity picker
//   POST /entra/:tenant/oauth2/v2.0/authorize      → picker submission, redirects back
//   POST /entra/:tenant/oauth2/v2.0/token          → id_token for the code
//   GET  /entra/:tenant/discovery/v2.0/keys        → JWKS
//
// The same token endpoint also answers `grant_type=client_credentials`, which is
// what GraphClient uses. That is what lets M365_AUTHORITY point here and the
// mock Graph at /graph stand in for the real directory.
//
// Identities come from the shared roster, so whoever signs in here matches a row
// in the HR upload and a user in the mock Graph.
//
// The provider reads the identity out of the id_token with `decodeJwt`, which
// does not check the signature on the code flow, so the token here is signed
// with a fixed "none"-style placeholder. That is the whole point of a mock:
// never wire this to anything real.

import { randomUUID } from "node:crypto";
import { FEATURED_EMAILS, findEmployeeByEmail, roster } from "../directory/roster.mjs";

const BASE_PATH = "/entra";

// Cleared on restart — a dev-only store keyed by the authorization code.
const pendingCodes = new Map();

// Featured first, then everyone else. One list rather than two, so the
// `mock-entra-identity` selector means "any employee" no matter where they sit.
const pickerIdentities = () => {
  const featured = FEATURED_EMAILS.map(findEmployeeByEmail).filter(Boolean);
  const featuredEmails = new Set(featured.map((employee) => employee.email));
  const rest = roster.filter((employee) => !featuredEmails.has(employee.email));
  return [
    ...featured.map((employee) => ({ employee, isFeatured: true })),
    ...rest.map((employee) => ({ employee, isFeatured: false })),
  ];
};

const base64url = (input) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const encodeIdToken = (claims) => {
  const header = base64url(JSON.stringify({ alg: "none", typ: "JWT", kid: "mock-entra-key" }));
  const payload = base64url(JSON.stringify(claims));
  return `${header}.${payload}.`;
};

const escapeHtml = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const identityRow = ({ employee, isFeatured }, redirectUri, state) => `<li${
  isFeatured ? ' class="featured"' : ""
} data-search="${escapeHtml(`${employee.name} ${employee.email} ${employee.jobTitle} ${employee.businessUnit}`.toLowerCase())}">
      <form method="post">
        <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
        <input type="hidden" name="state" value="${escapeHtml(state)}" />
        <input type="hidden" name="email" value="${escapeHtml(employee.email)}" />
        <button type="submit" data-testid="mock-entra-identity">
          <span class="who">${escapeHtml(employee.name)} — ${escapeHtml(employee.email)}</span>
          <span class="role">${escapeHtml(employee.jobTitle)} · ${escapeHtml(employee.businessUnit)}</span>
        </button>
      </li>`;

const pickerPage = (tenant, redirectUri, state) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Mock Entra ID — sign in</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; }
    h1 { font-size: 1.25rem; }
    .hint { color: #666; font-size: 0.85rem; }
    button, input { font: inherit; }
    ul { list-style: none; padding: 0; max-height: 26rem; overflow-y: auto; border: 1px solid #ddd; border-radius: 0.4rem; }
    li { margin: 0; border-bottom: 1px solid #eee; }
    li.featured { background: #f6f8ff; }
    li button { width: 100%; text-align: left; padding: 0.5rem 0.8rem; cursor: pointer; background: none; border: 0; display: block; }
    li button:hover { background: #eef2ff; }
    .who { display: block; }
    .role { display: block; color: #666; font-size: 0.8rem; }
    form.filter { margin: 1rem 0 0.5rem; }
    form.filter input, form.custom input { width: 100%; padding: 0.5rem; box-sizing: border-box; }
    form.custom { margin-top: 1.5rem; display: flex; gap: 0.5rem; }
    form.custom input { flex: 1; }
  </style>
</head>
<body>
  <h1>Mock Entra ID</h1>
  <p class="hint">Tenant <code>${escapeHtml(tenant)}</code>. Not a real identity provider. The
  ${roster.length} people below are the same roster the mock HR upload and the mock Graph serve —
  the highlighted ones are one per level of the org.</p>
  <form class="filter" onsubmit="return false">
    <input type="search" data-testid="mock-entra-filter" placeholder="Filter by name, email, role or unit" oninput="filterIdentities(this.value)" />
  </form>
  <ul id="identities">
    ${pickerIdentities()
      .map((identity) => identityRow(identity, redirectUri, state))
      .join("\n")}
  </ul>
  <form method="post" class="custom">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
    <input type="hidden" name="state" value="${escapeHtml(state)}" />
    <input type="email" name="email" placeholder="any@address.example" required data-testid="mock-entra-email" />
    <button type="submit" data-testid="mock-entra-submit">Sign in</button>
  </form>
  <script>
    function filterIdentities(query) {
      var needle = query.trim().toLowerCase();
      var rows = document.getElementById("identities").children;
      for (var index = 0; index < rows.length; index += 1) {
        var row = rows[index];
        row.hidden = needle !== "" && row.dataset.search.indexOf(needle) === -1;
      }
    }
  </script>
</body>
</html>`;

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const sendJson = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const handleAuthorizeGet = (res, tenant, url) => {
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!redirectUri) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("missing redirect_uri");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(pickerPage(tenant, redirectUri, state));
};

const handleAuthorizePost = async (req, res, tenant) => {
  const form = new URLSearchParams(await readBody(req));
  const redirectUri = form.get("redirect_uri");
  const email = form.get("email");
  if (!redirectUri || !email) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("missing redirect_uri or email");
    return;
  }

  const code = randomUUID();
  pendingCodes.set(code, { tenant, email: email.trim().toLowerCase() });

  const location = new URL(redirectUri);
  location.searchParams.set("code", code);
  const state = form.get("state");
  if (state) location.searchParams.set("state", state);

  res.writeHead(302, { Location: location.toString() });
  res.end();
};

// GraphClient's client-credentials grant. No code, no identity — just a bearer
// token the mock Graph does not check.
const handleClientCredentials = (res) => {
  sendJson(res, 200, {
    token_type: "Bearer",
    expires_in: 3600,
    ext_expires_in: 3600,
    access_token: `mock-app-token-${randomUUID()}`,
  });
};

const handleAuthorizationCode = (res, tenant, form) => {
  const code = form.get("code");
  const pending = code ? pendingCodes.get(code) : undefined;
  if (!pending) {
    sendJson(res, 400, { error: "invalid_grant", error_description: "unknown or reused code" });
    return;
  }
  pendingCodes.delete(code);

  // A typed address that matches nobody still signs in — the escape hatch has to
  // keep working — it just carries no directory claims.
  const employee = findEmployeeByEmail(pending.email);
  const issuedAt = Math.floor(Date.now() / 1000);
  const idToken = encodeIdToken({
    iss: `mock-entra/${tenant}`,
    aud: form.get("client_id") ?? "mock-client",
    sub: `mock-entra|${pending.email}`,
    tid: tenant,
    name: employee?.name ?? pending.email,
    email: pending.email,
    preferred_username: pending.email,
    email_verified: true,
    ...(employee
      ? { jobTitle: employee.jobTitle, department: employee.businessUnit, employeeId: employee.employeeId }
      : {}),
    iat: issuedAt,
    exp: issuedAt + 3600,
  });

  sendJson(res, 200, {
    token_type: "Bearer",
    scope: "openid profile email User.Read",
    expires_in: 3600,
    access_token: `mock-access-${randomUUID()}`,
    refresh_token: `mock-refresh-${randomUUID()}`,
    id_token: idToken,
  });
};

const handleToken = async (req, res, tenant) => {
  const form = new URLSearchParams(await readBody(req));
  if (form.get("grant_type") === "client_credentials") {
    handleClientCredentials(res);
    return;
  }
  handleAuthorizationCode(res, tenant, form);
};

async function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const segments = url.pathname.slice(BASE_PATH.length).split("/").filter(Boolean);
  const tenant = segments[0];
  const endpoint = segments.slice(1).join("/");

  if (!tenant) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("missing tenant segment");
    return;
  }

  if (endpoint === "oauth2/v2.0/authorize" && req.method === "GET") {
    handleAuthorizeGet(res, tenant, url);
    return;
  }

  if (endpoint === "oauth2/v2.0/authorize" && req.method === "POST") {
    await handleAuthorizePost(req, res, tenant);
    return;
  }

  if (endpoint === "oauth2/v2.0/token" && req.method === "POST") {
    await handleToken(req, res, tenant);
    return;
  }

  // Served for completeness. The authorization-code flow decodes the id_token
  // without verifying it, so nothing fetches these keys today.
  if (endpoint === "discovery/v2.0/keys" && req.method === "GET") {
    sendJson(res, 200, { keys: [] });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}

export const mock = {
  path: BASE_PATH,
  label: "entra (mock identity provider)",
  handle,
};
