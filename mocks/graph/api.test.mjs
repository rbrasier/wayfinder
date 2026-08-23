import { describe, expect, it } from "vitest";
import { request, response, json } from "../test-support/http.mjs";
import { findEmployeeByEmail, roster } from "../directory/roster.mjs";
import { mock, searchTermsFrom, toGraphUser } from "./api.mjs";

// Every $search request the adapter makes carries this header, and real Graph
// rejects the query without it.
const EVENTUAL = { ConsistencyLevel: "eventual", Authorization: "Bearer mock-app-token" };

const call = async (url, headers = EVENTUAL) => {
  const res = response();
  await mock.handle(request("GET", url, null, headers), res);
  return res.recorded;
};

const chiefExecutive = roster.find((employee) => employee.level === 1);
const contributor = roster.find((employee) => employee.level === 5);

describe("mock registration", () => {
  it("claims the /graph path", () => {
    expect(mock.path).toBe("/graph");
    expect(mock.label).toContain("graph");
  });
});

describe("user projection", () => {
  it("projects an employee into the fields GraphUser declares", () => {
    expect(toGraphUser(contributor)).toEqual({
      id: contributor.employeeId,
      displayName: contributor.name,
      mail: contributor.email,
      userPrincipalName: contributor.email,
      jobTitle: contributor.jobTitle,
      department: contributor.businessUnit,
    });
  });
});

describe("$search parsing", () => {
  it("reads the scoped terms out of the syntax GraphPeopleDirectory sends", () => {
    expect(searchTermsFrom('"displayName:Ada" OR "mail:Ada"')).toEqual([
      { property: "displayName".toLowerCase(), value: "ada" },
      { property: "mail", value: "ada" },
    ]);
  });

  it("reads a bare term as unscoped, and ignores empty or missing input", () => {
    expect(searchTermsFrom("Hopper")).toEqual([{ property: null, value: "hopper" }]);
    expect(searchTermsFrom("")).toEqual([]);
    expect(searchTermsFrom(null)).toEqual([]);
  });
});

describe("GET /users", () => {
  it("matches on display name", async () => {
    const recorded = await call('/graph/v1.0/users?$search="displayName:Lovelace"');
    expect(recorded.statusCode).toBe(200);
    expect(json(recorded).value.map((user) => user.mail)).toContain("ada@example.com");
  });

  it("matches on mail", async () => {
    const recorded = await call('/graph/v1.0/users?$search="mail:grace@example.com"');
    expect(json(recorded).value.map((user) => user.mail)).toEqual(["grace@example.com"]);
  });

  it("honours $top", async () => {
    const recorded = await call('/graph/v1.0/users?$search="displayName:a"&$top=3');
    expect(json(recorded).value.length).toBe(3);
  });

  it("returns an empty collection rather than an error when nothing matches", async () => {
    const recorded = await call('/graph/v1.0/users?$search="displayName:nobodyhere"');
    expect(recorded.statusCode).toBe(200);
    expect(json(recorded).value).toEqual([]);
  });

  it("lists everyone when no $search is given", async () => {
    const recorded = await call("/graph/v1.0/users");
    expect(json(recorded).value.length).toBe(roster.length);
  });

  it("serves the same collection without the version segment", async () => {
    const recorded = await call('/graph/users?$search="mail:grace@example.com"');
    expect(recorded.statusCode).toBe(200);
    expect(json(recorded).value.length).toBe(1);
  });
});

describe("GET /users/{id}", () => {
  it("resolves a user by email", async () => {
    const recorded = await call(`/graph/v1.0/users/${encodeURIComponent(contributor.email)}`);
    expect(recorded.statusCode).toBe(200);
    expect(json(recorded).mail).toBe(contributor.email);
  });

  it("resolves a user by employee id", async () => {
    const recorded = await call(`/graph/v1.0/users/${contributor.employeeId}`);
    expect(json(recorded).mail).toBe(contributor.email);
  });

  it("404s an unknown user with a graph-shaped error", async () => {
    const recorded = await call("/graph/v1.0/users/nobody@example.com");
    expect(recorded.statusCode).toBe(404);
    expect(json(recorded).error.code).toBe("Request_ResourceNotFound");
  });
});

describe("GET /users/{id}/manager", () => {
  it("returns the manager of a contributor", async () => {
    const recorded = await call(
      `/graph/v1.0/users/${encodeURIComponent(contributor.email)}/manager`,
    );
    expect(recorded.statusCode).toBe(200);
    expect(json(recorded).mail).toBe(contributor.managerEmail);
  });

  it("walks two hops the way second-level resolution does", async () => {
    const first = json(
      await call(`/graph/v1.0/users/${encodeURIComponent(contributor.email)}/manager`),
    );
    const second = json(await call(`/graph/v1.0/users/${encodeURIComponent(first.mail)}/manager`));
    expect(second.mail).toBe(findEmployeeByEmail(first.mail).managerEmail);
  });

  it("404s at the top of the org, so resolution reports unresolved", async () => {
    const recorded = await call(
      `/graph/v1.0/users/${encodeURIComponent(chiefExecutive.email)}/manager`,
    );
    expect(recorded.statusCode).toBe(404);
  });
});

describe("advanced-query rules", () => {
  // Real Graph requires ConsistencyLevel: eventual for $search on directory
  // objects and answers 400 without it. A mock that accepted the query anyway
  // would let a dropped header pass CI and fail in production.
  it("400s a $search with no ConsistencyLevel header", async () => {
    const recorded = await call('/graph/v1.0/users?$search="displayName:Lovelace"', {
      Authorization: "Bearer mock-app-token",
    });
    expect(recorded.statusCode).toBe(400);
    expect(json(recorded).error.code).toBe("Request_UnsupportedQuery");
  });

  it("400s a $search whose ConsistencyLevel is not eventual", async () => {
    const recorded = await call('/graph/v1.0/users?$search="displayName:Lovelace"', {
      ConsistencyLevel: "strong",
      Authorization: "Bearer mock-app-token",
    });
    expect(recorded.statusCode).toBe(400);
  });

  it("does not require the header when there is no $search", async () => {
    const recorded = await call("/graph/v1.0/users", { Authorization: "Bearer mock-app-token" });
    expect(recorded.statusCode).toBe(200);
  });

  it("reads the header case-insensitively, as a real HTTP server does", async () => {
    const recorded = await call('/graph/v1.0/users?$search="mail:ada@example.com"', {
      consistencylevel: "Eventual",
      authorization: "Bearer mock-app-token",
    });
    expect(recorded.statusCode).toBe(200);
  });
});

describe("$select", () => {
  it("returns only the selected properties, plus id as real Graph always does", async () => {
    const recorded = await call("/graph/v1.0/users?$select=displayName,mail");
    const [user] = json(recorded).value;
    expect(Object.keys(user).sort()).toEqual(["displayName", "id", "mail"]);
  });

  it("returns the full projection when nothing is selected", async () => {
    const [user] = json(await call("/graph/v1.0/users")).value;
    expect(Object.keys(user).sort()).toEqual([
      "department",
      "displayName",
      "id",
      "jobTitle",
      "mail",
      "userPrincipalName",
    ]);
  });

  it("applies to a single user and to the manager hop", async () => {
    const single = json(
      await call(`/graph/v1.0/users/${encodeURIComponent(contributor.email)}?$select=mail`),
    );
    expect(Object.keys(single).sort()).toEqual(["id", "mail"]);
    const manager = json(
      await call(
        `/graph/v1.0/users/${encodeURIComponent(contributor.email)}/manager?$select=mail,userPrincipalName`,
      ),
    );
    expect(Object.keys(manager).sort()).toEqual(["id", "mail", "userPrincipalName"]);
  });
});

describe("response envelope", () => {
  it("carries an @odata.context on the collection, as real Graph does", async () => {
    const payload = json(await call("/graph/v1.0/users"));
    expect(payload["@odata.context"]).toContain("$metadata#users");
  });
});

describe("rejections", () => {
  it("404s an endpoint the mock does not implement", async () => {
    expect((await call("/graph/v1.0/groups")).statusCode).toBe(404);
  });
});

describe("bearer token", () => {
  it("401s a request with no Authorization header", async () => {
    const recorded = await call("/graph/v1.0/users", {});
    expect(recorded.statusCode).toBe(401);
    expect(json(recorded).error.code).toBe("InvalidAuthenticationToken");
  });

  it("401s an Authorization header that is not a bearer token", async () => {
    const recorded = await call("/graph/v1.0/users", { Authorization: "Basic abc123" });
    expect(recorded.statusCode).toBe(401);
  });
});

describe("$search scoping", () => {
  // Real Graph scopes a "field:term" search to that field and tokenises the
  // term — it does not substring-match across everything. A mock that matched
  // more than production would make a local search look like it works.
  it("scopes displayName: to the display name", async () => {
    const byName = json(await call('/graph/v1.0/users?$search="displayName:Lovelace"')).value;
    expect(byName.map((user) => user.mail)).toEqual(["ada@example.com"]);
  });

  it("does not match a job title through a displayName: search", async () => {
    const found = json(
      await call('/graph/v1.0/users?$search="displayName:Chief Executive Officer"'),
    ).value;
    expect(found).toEqual([]);
  });

  it("matches on a word prefix, not on any substring", async () => {
    const prefix = json(await call('/graph/v1.0/users?$search="displayName:Love"')).value;
    expect(prefix.map((user) => user.mail)).toContain("ada@example.com");
    const middle = json(await call('/graph/v1.0/users?$search="displayName:ovelac"')).value;
    expect(middle).toEqual([]);
  });

  it("searches the default searchable properties for an unscoped term", async () => {
    const found = json(await call('/graph/v1.0/users?$search="Hopper"')).value;
    expect(found.map((user) => user.mail)).toEqual(["grace@example.com"]);
  });

  it("rejects a search scoped to a property real Graph cannot search on users", async () => {
    const recorded = await call('/graph/v1.0/users?$search="jobTitle:Director"');
    expect(recorded.statusCode).toBe(400);
  });
});
