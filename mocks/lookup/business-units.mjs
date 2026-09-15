// Mock lookup source: a large, paginated value set behind HTTP Basic (5,000
// entries) — business units of a multinational.
//
// This is the case narrowing was built for. Five thousand options cannot be
// scrolled, cannot be inlined into a prompt, and an operator will not know the
// organisation's own vocabulary for them.
//
// Auth is RFC 7617 Basic, the other convention Wayfinder can carry, because the
// stored credential is sent as the Authorization header verbatim:
//
//   Authorization: Basic base64("bu-service:s3cr3t-mock-pw")
//                = Basic YnUtc2VydmljZTpzM2NyM3QtbW9jay1wdw==
//
// (An `X-API-Key` style source cannot use the encrypted credential at all today
// — only the Authorization header carries it. Static values can be set as
// config headers, but those are not encrypted, so they are not a place for a
// secret. Worth knowing before registering a real key-header API.)
//
// Register it as:
//
//   kind          api
//   url           http://localhost:4001/lookup/business-units
//   records path  items
//   display       unit_name
//   key           unit_code
//   credential    Basic YnUtc2VydmljZTpzM2NyM3QtbW9jay1wdw==
//   pagination    offset · param "offset" · size param "limit" · size 250
//   stop after    5000
//
// **Set the page size to 250 or more.** The walk is capped at 20 pages, so the
// default size of 200 reaches only 4,000 of the 5,000 entries. 250 × 20 = 5,000
// exactly. This ceiling is deliberate and is the thing to notice here.
//
// All three paging styles work against this one endpoint, so a source can be
// reconfigured without touching the mock:
//
//   offset   ?offset=0&limit=250            page numbers start at 1
//   page     ?page=1&per_page=250
//   cursor   ?cursor=<token>&limit=250      next token at page.next_cursor
//
// Worth trying, because none of these match on letters:
//   "procurement"  → Sourcing & Supplier Management
//   "HR"           → People & Culture
//   "recruitment"  → Talent Acquisition
//   "GDPR"         → Data Protection Office
//   "warehouse"    → Logistics & Distribution
//   "PR"           → Corporate Communications
//
// And worth trying because it must NOT be corrected silently: every function
// exists at five sites per country, so "Sourcing Germany" reaches five entries
// scoring alike. The near-certain rule refuses a correction without a clear
// winner, so that one is shortlisted rather than guessed.

const BASE_PATH = "/lookup/business-units";

const USERNAME = process.env.MOCK_LOOKUP_BU_USER ?? "bu-service";
const PASSWORD = process.env.MOCK_LOOKUP_BU_PASSWORD ?? "s3cr3t-mock-pw";

const DEFAULT_PAGE_SIZE = 250;
const MAX_PAGE_SIZE = 1_000;

const REGIONS = [
  ["EMEA", [
    ["GB", "United Kingdom"], ["DE", "Germany"], ["FR", "France"], ["NL", "Netherlands"],
    ["ES", "Spain"], ["IT", "Italy"], ["SE", "Sweden"], ["PL", "Poland"],
    ["IE", "Ireland"], ["CH", "Switzerland"], ["AT", "Austria"], ["BE", "Belgium"],
    ["DK", "Denmark"], ["NO", "Norway"], ["FI", "Finland"], ["PT", "Portugal"],
  ]],
  ["NA", [["US", "United States"], ["CA", "Canada"]]],
  ["LATAM", [
    ["BR", "Brazil"], ["MX", "Mexico"], ["AR", "Argentina"], ["CL", "Chile"],
    ["CO", "Colombia"], ["PE", "Peru"], ["UY", "Uruguay"], ["CR", "Costa Rica"],
  ]],
  ["APAC", [
    ["JP", "Japan"], ["CN", "China"], ["IN", "India"], ["SG", "Singapore"],
    ["MY", "Malaysia"], ["TH", "Thailand"], ["VN", "Vietnam"], ["PH", "Philippines"],
    ["ID", "Indonesia"], ["KR", "South Korea"], ["TW", "Taiwan"], ["HK", "Hong Kong"],
  ]],
  ["ANZ", [["AU", "Australia"], ["NZ", "New Zealand"]]],
];

// Named the way an organisation names itself, not the way an operator asks for
// it — which is the whole point of the set.
const FUNCTIONS = [
  ["SRC", "Sourcing & Supplier Management"],
  ["AP", "Accounts Payable"],
  ["FPA", "Financial Planning & Analysis"],
  ["TRE", "Treasury & Cash Management"],
  ["STR", "Statutory Reporting"],
  ["IA", "Internal Audit"],
  ["TAX", "Tax Advisory"],
  ["PAC", "People & Culture"],
  ["TA", "Talent Acquisition"],
  ["LND", "Learning & Development"],
  ["PAY", "Payroll Services"],
  ["LEG", "Legal Counsel"],
  ["REG", "Regulatory Compliance"],
  ["DPO", "Data Protection Office"],
  ["TPL", "Technology Platforms"],
  ["APS", "Application Support"],
  ["CYB", "Cyber Defence"],
  ["NET", "Network Operations"],
  ["CS", "Customer Success"],
  ["FS", "Field Services"],
  ["MFG", "Manufacturing Operations"],
  ["QA", "Quality Assurance"],
  ["LOG", "Logistics & Distribution"],
  ["FM", "Facilities Management"],
  ["COM", "Corporate Communications"],
];

const SITES_PER_FUNCTION = 5;

// 40 countries × 25 functions × 5 sites = 5,000. Built once at startup and held,
// so every page of a walk sees the same stable order.
const buildUnits = () => {
  const units = [];
  for (const [region, countries] of REGIONS) {
    for (const [countryCode, countryName] of countries) {
      for (const [functionCode, functionName] of FUNCTIONS) {
        for (let site = 1; site <= SITES_PER_FUNCTION; site += 1) {
          const sequence = String(units.length + 1).padStart(4, "0");
          units.push({
            unit_code: `BU-${region}-${countryCode}-${functionCode}-${sequence}`,
            unit_name: `${functionName} — ${countryName} ${String(site).padStart(2, "0")}`,
            region,
            country: countryName,
            country_code: countryCode,
            function: functionName,
            cost_centre: `CC-${sequence}`,
          });
        }
      }
    }
  }
  return units;
};

const UNITS = buildUnits();

const sendJson = (res, status, body, headers = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
};

const basicCredentialOf = (authorization) => {
  const match = /^basic\s+(.+)$/i.exec(authorization?.trim() ?? "");
  if (!match) return null;
  try {
    return Buffer.from(match[1].trim(), "base64").toString("utf8");
  } catch {
    return null;
  }
};

// Absent and blank must both come back null, not 0 — `Number(null)` is 0, which
// would read a missing page parameter as "page 0" and pin every request in an
// offset-style walk to the first page.
const positiveInt = (raw) => {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

// One endpoint, three conventions. The style is whatever the caller's parameters
// say it is, so a source can be switched between them without a mock change.
const offsetFor = (params, size) => {
  const cursor = params.get("cursor");
  if (cursor) return positiveInt(Buffer.from(cursor, "base64url").toString("utf8")) ?? 0;

  const page = positiveInt(params.get("page"));
  // Page numbers here start at 1, which is the commoner convention; a source
  // numbering from 0 sends page=0 and lands on the same first record.
  if (page !== null) return Math.max(0, page - 1) * size;

  return positiveInt(params.get("offset")) ?? 0;
};

function handle(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed", allowed: ["GET"] });
    return;
  }

  const presented = basicCredentialOf(req.headers.authorization);
  if (presented !== `${USERNAME}:${PASSWORD}`) {
    sendJson(
      res,
      401,
      {
        error: "unauthorized",
        error_description:
          "Send Authorization: Basic base64(user:password). In Wayfinder, type the whole header value — the word Basic included — into the source's credential box.",
      },
      { "WWW-Authenticate": 'Basic realm="wayfinder-mock", charset="UTF-8"' },
    );
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const params = url.searchParams;

  const query = params.get("q")?.trim().toLowerCase() ?? "";
  const matched = query
    ? UNITS.filter(
        (unit) =>
          unit.unit_name.toLowerCase().includes(query) ||
          unit.unit_code.toLowerCase().includes(query) ||
          unit.function.toLowerCase().includes(query),
      )
    : UNITS;

  const requestedSize = positiveInt(params.get("limit") ?? params.get("per_page"));
  const size = Math.min(requestedSize && requestedSize > 0 ? requestedSize : DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = Math.min(offsetFor(params, size), matched.length);
  const items = matched.slice(offset, offset + size);
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < matched.length;

  sendJson(res, 200, {
    items,
    page: {
      offset,
      limit: size,
      returned: items.length,
      total: matched.length,
      has_more: hasMore,
      next_cursor: hasMore ? Buffer.from(String(nextOffset), "utf8").toString("base64url") : null,
    },
  });
}

export const mock = {
  path: BASE_PATH,
  label: `lookup: business units (${UNITS.length} entries, basic auth, paginated)`,
  handle,
};
