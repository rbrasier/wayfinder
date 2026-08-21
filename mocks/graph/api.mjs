// Mock Microsoft Graph, mounted at /graph on the shared mocks server.
//
// GraphClient builds every request as `${baseUrl}${path}`, so pointing
// M365_GRAPH_BASE_URL at http://localhost:4001/graph/v1.0 routes the directory
// adapters here:
//
//   GET /graph/v1.0/users                    → $search / $top people search
//   GET /graph/v1.0/users/:idOrEmail         → one user
//   GET /graph/v1.0/users/:idOrEmail/manager → the next hop up the chain
//
// The version segment is optional so a base URL with or without /v1.0 works.
//
// What this mock *does* enforce is the advanced-query rule: $search on directory
// objects is rejected with 400 unless the request carries
// `ConsistencyLevel: eventual`, exactly as real Graph does. Accepting the query
// anyway would let a dropped header pass CI and fail in production.
//
// Nothing here checks the bearer token. It is a mock: it must only ever be
// reachable on loopback, behind restart.sh --with-mocks.

import { roster, findEmployeeByEmail, managerOf } from "../directory/roster.mjs";

const BASE_PATH = "/graph";

export const toGraphUser = (employee) => ({
  id: employee.employeeId,
  displayName: employee.name,
  mail: employee.email,
  userPrincipalName: employee.email,
  jobTitle: employee.jobTitle,
  department: employee.businessUnit,
});

// GraphPeopleDirectory sends `"displayName:<term>" OR "mail:<term>"`. Real Graph
// treats the field prefix as a scope; matching any field is close enough for a
// mock and keeps a bare term working too.
export const searchTermsFrom = (search) => {
  if (!search) return [];
  const quoted = [...search.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  const candidates = quoted.length > 0 ? quoted : [search];
  const terms = candidates
    .map((candidate) => candidate.split(":").slice(1).join(":") || candidate)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(terms)];
};

const matches = (employee, terms) =>
  terms.some(
    (term) =>
      employee.name.toLowerCase().includes(term) ||
      employee.email.includes(term) ||
      employee.jobTitle.toLowerCase().includes(term) ||
      employee.businessUnit.toLowerCase().includes(term),
  );

const findEmployee = (reference) => {
  const decoded = decodeURIComponent(reference);
  const byEmail = findEmployeeByEmail(decoded);
  if (byEmail) return byEmail;
  return roster.find((employee) => employee.employeeId === decoded.toUpperCase());
};

const sendJson = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const sendNotFound = (res, message) =>
  sendJson(res, 404, { error: { code: "Request_ResourceNotFound", message } });

const sendBadRequest = (res, message) =>
  sendJson(res, 400, { error: { code: "Request_UnsupportedQuery", message } });

// Real Graph returns id whether or not it was selected, and nothing else beyond
// the selection. A mock that ignored $select would hide a missing field until
// production.
const applySelect = (user, select) => {
  if (!select) return user;
  const wanted = new Set(
    select
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean),
  );
  wanted.add("id");
  return Object.fromEntries(Object.entries(user).filter(([field]) => wanted.has(field)));
};

const handleUserCollection = (res, url) => {
  const terms = searchTermsFrom(url.searchParams.get("$search"));
  const matched = terms.length === 0 ? roster : roster.filter((employee) => matches(employee, terms));
  const top = Number(url.searchParams.get("$top") ?? matched.length);
  const limit = Number.isFinite(top) && top > 0 ? top : matched.length;
  const select = url.searchParams.get("$select");
  sendJson(res, 200, {
    "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users",
    value: matched.slice(0, limit).map((employee) => applySelect(toGraphUser(employee), select)),
  });
};

const handle = (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const select = url.searchParams.get("$select");
  const segments = url.pathname.slice(BASE_PATH.length).split("/").filter(Boolean);
  const path = segments[0] === "v1.0" ? segments.slice(1) : segments;

  if (path[0] !== "users") {
    sendNotFound(res, "This mock implements /users only.");
    return;
  }

  if (path.length === 1) {
    if (
      url.searchParams.has("$search") &&
      (req.headers["consistencylevel"] ?? "").toLowerCase() !== "eventual"
    ) {
      sendBadRequest(
        res,
        "Request with $search requires the ConsistencyLevel header set to eventual.",
      );
      return;
    }
    handleUserCollection(res, url);
    return;
  }

  const employee = findEmployee(path[1]);
  if (!employee) {
    sendNotFound(res, `No user matches ${path[1]}.`);
    return;
  }

  if (path.length === 2) {
    sendJson(res, 200, applySelect(toGraphUser(employee), select));
    return;
  }

  if (path[2] === "manager") {
    const manager = managerOf(employee.email);
    if (!manager) {
      sendNotFound(res, `${employee.email} has no manager.`);
      return;
    }
    sendJson(res, 200, applySelect(toGraphUser(manager), select));
    return;
  }

  sendNotFound(res, `This mock does not implement /users/{id}/${path[2]}.`);
};

export const mock = {
  path: BASE_PATH,
  label: "graph (mock Microsoft Graph directory)",
  handle,
};
