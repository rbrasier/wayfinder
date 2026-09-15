// Mock lookup source: a short, unauthenticated value set (8 entries).
//
// The small-set case. Eight options is under the inline threshold (30), so a
// field bound to this source inlines its values into the AI prompt and renders a
// dropdown rather than a type-ahead — which is the behaviour this endpoint
// exists to exercise.
//
// The body is a bare JSON array, so the records path is empty. No credential:
// Test should succeed against it with the credential box left blank.
//
// Register it in Configuration → Lookup Sources as:
//
//   kind          api
//   url           http://localhost:4001/lookup/contract-types
//   records path  (leave empty — the body is the array)
//   display       name
//   key           code
//   credential    (leave empty)
//
// Worth trying once registered, because none of these match on letters:
//   "hourly rate"  → Time and Materials
//   "SaaS"         → Licence and Subscription
//   "panel"        → Framework Agreement

const BASE_PATH = "/lookup/contract-types";

const CONTRACT_TYPES = [
  { code: "CT-FIX", name: "Fixed Price", note: "One agreed sum for a defined scope." },
  { code: "CT-TM", name: "Time and Materials", note: "Charged on hours worked plus expenses." },
  { code: "CT-CR", name: "Cost Reimbursable", note: "Actual costs recovered against an agreed ceiling." },
  { code: "CT-FWK", name: "Framework Agreement", note: "A standing panel of pre-approved suppliers." },
  { code: "CT-CALL", name: "Call-Off Order", note: "An order placed under an existing framework." },
  { code: "CT-MSP", name: "Managed Service", note: "An outcome bought as an ongoing service." },
  { code: "CT-LIC", name: "Licence and Subscription", note: "Software licensed per seat or per term." },
  { code: "CT-GRANT", name: "Grant Funding", note: "Funds awarded against agreed deliverables." },
];

const sendJson = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
};

function handle(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed", allowed: ["GET"] });
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  if (!query) {
    sendJson(res, 200, CONTRACT_TYPES);
    return;
  }

  sendJson(
    res,
    200,
    CONTRACT_TYPES.filter(
      (type) =>
        type.name.toLowerCase().includes(query) || type.code.toLowerCase().includes(query),
    ),
  );
}

export const mock = {
  path: BASE_PATH,
  label: "lookup: contract types (8 entries, no credential)",
  handle,
};
