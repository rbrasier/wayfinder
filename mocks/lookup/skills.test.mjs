import { describe, expect, it } from "vitest";
import { json, request, response } from "../test-support/http.mjs";
import { mock } from "./skills.mjs";

const TOKEN = "wf-mock-skills-2f9a1c7d";

const call = async (method, url, headers = {}) => {
  const res = response();
  await mock.handle(request(method, url, null, headers), res);
  return res.recorded;
};

const authorised = (url) => call("GET", url, { Authorization: `Bearer ${TOKEN}` });

describe("mock registration", () => {
  it("claims the /lookup/skills path", () => {
    expect(mock.path).toBe("/lookup/skills");
    expect(mock.label).toContain("skills");
  });
});

describe("bearer authentication", () => {
  it("401s with a challenge when no credential is sent", async () => {
    const recorded = await call("GET", "/lookup/skills");

    expect(recorded.statusCode).toBe(401);
    expect(recorded.headers["WWW-Authenticate"]).toContain("Bearer");
  });

  it("401s on the wrong token", async () => {
    expect((await call("GET", "/lookup/skills", { Authorization: "Bearer nope" })).statusCode).toBe(
      401,
    );
  });

  it("401s when the credential is sent under the wrong scheme", async () => {
    const recorded = await call("GET", "/lookup/skills", { Authorization: `Basic ${TOKEN}` });

    expect(recorded.statusCode).toBe(401);
  });

  it("accepts the scheme in any case, as RFC 6750 requires", async () => {
    const recorded = await call("GET", "/lookup/skills", { Authorization: `bearer ${TOKEN}` });

    expect(recorded.statusCode).toBe(200);
  });

  it("says how to configure the credential rather than only refusing", async () => {
    expect(json(await call("GET", "/lookup/skills")).error_description).toContain("credential box");
  });
});

describe("GET /lookup/skills", () => {
  it("nests the records so the source needs a records path", async () => {
    const body = json(await authorised("/lookup/skills"));

    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.total).toBe(body.data.length);
  });

  it("sits above the inline threshold, which is what this endpoint is for", async () => {
    // Below 30 the field would inline its values and render a dropdown, and this
    // mock would stop testing the type-ahead path.
    expect(json(await authorised("/lookup/skills")).data.length).toBe(60);
  });

  it("gives every entry a display and a key", async () => {
    for (const skill of json(await authorised("/lookup/skills")).data) {
      expect(skill.skill_name).toBeTruthy();
      expect(skill.skill_code).toMatch(/^SK-\d{4}$/);
    }
  });

  it("keys every entry uniquely, so nothing resolves ambiguously by key", async () => {
    const codes = json(await authorised("/lookup/skills")).data.map((skill) => skill.skill_code);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it("filters on a search term when the source delegates the narrowing", async () => {
    const names = json(await authorised("/lookup/skills?q=data")).data.map(
      (skill) => skill.skill_name,
    );

    expect(names).toEqual(["Data Engineering", "Data Architecture", "Data Protection"]);
  });

  it("keeps the near-neighbours that must not be silently corrected into each other", async () => {
    const names = json(await authorised("/lookup/skills")).data.map((skill) => skill.skill_name);

    expect(names).toContain("Financial Modelling");
    expect(names).toContain("Financial Reporting");
    expect(names).toContain("Data Engineering");
    expect(names).toContain("Data Architecture");
  });
});

describe("rejections", () => {
  it("405s a write", async () => {
    const recorded = await call("POST", "/lookup/skills", { Authorization: `Bearer ${TOKEN}` });

    expect(recorded.statusCode).toBe(405);
  });
});
