// Mock lookup source: a mid-sized value set behind a bearer token (60 entries).
//
// Sixty options is over the inline threshold (30), so a field bound to this
// source omits its values from the AI prompt and renders a type-ahead instead.
// It is the smallest set where narrowing actually matters.
//
// Auth is RFC 6750 bearer, the most common convention for a read-only JSON API:
//
//   Authorization: Bearer <token>
//
// Wayfinder sends the stored credential as the Authorization header verbatim, so
// the admin types the whole value — the word "Bearer" included — into the
// credential box. It is encrypted at rest with the same key that protects the
// n8n and SMTP secrets, and no query ever returns it.
//
// Register it as:
//
//   kind          api
//   url           http://localhost:4001/lookup/skills
//   records path  data
//   display       skill_name
//   key           skill_code
//   credential    Bearer wf-mock-skills-2f9a1c7d
//   search param  q          ← optional; see below
//
// Leaving the search parameter EMPTY is the more interesting configuration: the
// source then returns its whole list and Wayfinder narrows in memory, which is
// the path `filtersAtSource` used to get wrong. Setting it to `q` hands the
// filtering to this endpoint instead.
//
// Worth trying, because none of these match on letters:
//   "buying"            → Category Sourcing
//   "people management" → Team Leadership
//   "GDPR"              → Data Protection
//   "spreadsheets"      → Financial Modelling

const BASE_PATH = "/lookup/skills";

const TOKEN = process.env.MOCK_LOOKUP_SKILLS_TOKEN ?? "wf-mock-skills-2f9a1c7d";

// Deliberately includes near-neighbours — "Financial Modelling" beside
// "Financial Reporting", "Data Engineering" beside "Data Architecture" — so a
// typo that could mean either is shortlisted rather than silently corrected.
const SKILLS = [
  ["SK-1001", "Category Sourcing", "Commercial"],
  ["SK-1002", "Contract Negotiation", "Commercial"],
  ["SK-1003", "Supplier Relationship Management", "Commercial"],
  ["SK-1004", "Tender Evaluation", "Commercial"],
  ["SK-1005", "Spend Analysis", "Commercial"],
  ["SK-1006", "Cost Modelling", "Commercial"],
  ["SK-1007", "Benefits Realisation", "Commercial"],
  ["SK-1008", "Market Engagement", "Commercial"],
  ["SK-2001", "Financial Modelling", "Finance"],
  ["SK-2002", "Financial Reporting", "Finance"],
  ["SK-2003", "Management Accounting", "Finance"],
  ["SK-2004", "Treasury Operations", "Finance"],
  ["SK-2005", "Tax Compliance", "Finance"],
  ["SK-2006", "Audit Preparation", "Finance"],
  ["SK-2007", "Budget Forecasting", "Finance"],
  ["SK-2008", "Capital Planning", "Finance"],
  ["SK-3001", "Data Engineering", "Technology"],
  ["SK-3002", "Data Architecture", "Technology"],
  ["SK-3003", "Data Protection", "Technology"],
  ["SK-3004", "Cloud Infrastructure", "Technology"],
  ["SK-3005", "Platform Reliability", "Technology"],
  ["SK-3006", "Application Development", "Technology"],
  ["SK-3007", "Integration Design", "Technology"],
  ["SK-3008", "Release Engineering", "Technology"],
  ["SK-3009", "Threat Detection", "Technology"],
  ["SK-3010", "Identity and Access Management", "Technology"],
  ["SK-3011", "Penetration Testing", "Technology"],
  ["SK-3012", "Incident Response", "Technology"],
  ["SK-4001", "Team Leadership", "Leadership"],
  ["SK-4002", "Performance Coaching", "Leadership"],
  ["SK-4003", "Change Management", "Leadership"],
  ["SK-4004", "Stakeholder Engagement", "Leadership"],
  ["SK-4005", "Strategic Planning", "Leadership"],
  ["SK-4006", "Organisational Design", "Leadership"],
  ["SK-4007", "Succession Planning", "Leadership"],
  ["SK-4008", "Conflict Resolution", "Leadership"],
  ["SK-5001", "Programme Delivery", "Delivery"],
  ["SK-5002", "Agile Facilitation", "Delivery"],
  ["SK-5003", "Risk Management", "Delivery"],
  ["SK-5004", "Dependency Planning", "Delivery"],
  ["SK-5005", "Benefits Tracking", "Delivery"],
  ["SK-5006", "Vendor Onboarding", "Delivery"],
  ["SK-5007", "Service Transition", "Delivery"],
  ["SK-5008", "Business Analysis", "Delivery"],
  ["SK-6001", "Regulatory Reporting", "Governance"],
  ["SK-6002", "Policy Drafting", "Governance"],
  ["SK-6003", "Records Management", "Governance"],
  ["SK-6004", "Freedom of Information", "Governance"],
  ["SK-6005", "Ethics and Conduct", "Governance"],
  ["SK-6006", "Internal Controls", "Governance"],
  ["SK-6007", "Assurance Review", "Governance"],
  ["SK-6008", "Case Management", "Governance"],
  ["SK-7001", "Technical Writing", "Communication"],
  ["SK-7002", "Media Relations", "Communication"],
  ["SK-7003", "Internal Communications", "Communication"],
  ["SK-7004", "Plain English Drafting", "Communication"],
  ["SK-7005", "Presentation Design", "Communication"],
  ["SK-7006", "Workshop Facilitation", "Communication"],
  ["SK-7007", "Translation and Localisation", "Communication"],
  ["SK-7008", "Accessibility Review", "Communication"],
].map(([skill_code, skill_name, category]) => ({ skill_code, skill_name, category }));

const sendJson = (res, status, body, headers = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
};

// Case-insensitive on the scheme, as RFC 6750 requires, and constant in shape:
// a wrong token and a missing one both answer 401 with the same challenge.
const bearerTokenOf = (authorization) => {
  const match = /^bearer\s+(.+)$/i.exec(authorization?.trim() ?? "");
  return match ? match[1].trim() : null;
};

function handle(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed", allowed: ["GET"] });
    return;
  }

  const presented = bearerTokenOf(req.headers.authorization);
  if (presented !== TOKEN) {
    sendJson(
      res,
      401,
      {
        error: "invalid_token",
        error_description:
          "Send Authorization: Bearer <token>. In Wayfinder, type the whole header value — the word Bearer included — into the source's credential box.",
      },
      { "WWW-Authenticate": 'Bearer realm="wayfinder-mock", error="invalid_token"' },
    );
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const matched = query
    ? SKILLS.filter(
        (skill) =>
          skill.skill_name.toLowerCase().includes(query) ||
          skill.skill_code.toLowerCase().includes(query) ||
          skill.category.toLowerCase().includes(query),
      )
    : SKILLS;

  sendJson(res, 200, { data: matched, meta: { total: matched.length, of: SKILLS.length } });
}

export const mock = {
  path: BASE_PATH,
  label: `lookup: skills (${SKILLS.length} entries, bearer token)`,
  handle,
};
