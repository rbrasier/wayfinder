import { describe, expect, it } from "vitest";
import { json, request, response } from "../test-support/http.mjs";
import { mock } from "./contract-types.mjs";

const call = async (method, url) => {
  const res = response();
  await mock.handle(request(method, url), res);
  return res.recorded;
};

describe("mock registration", () => {
  it("claims the /lookup/contract-types path", () => {
    expect(mock.path).toBe("/lookup/contract-types");
    expect(mock.label).toContain("contract types");
  });
});

describe("GET /lookup/contract-types", () => {
  it("serves the set as a bare array, so the records path stays empty", async () => {
    const recorded = await call("GET", "/lookup/contract-types");

    expect(recorded.statusCode).toBe(200);
    expect(Array.isArray(json(recorded))).toBe(true);
  });

  it("stays under the inline threshold, which is what this endpoint is for", () => {
    // Above 30 the field would render a type-ahead instead of a dropdown, and
    // this mock would no longer be testing the small-set path.
    return call("GET", "/lookup/contract-types").then((recorded) => {
      expect(json(recorded)).toHaveLength(8);
    });
  });

  it("gives every entry a display and a key", async () => {
    for (const entry of json(await call("GET", "/lookup/contract-types"))) {
      expect(entry.name).toBeTruthy();
      expect(entry.code).toMatch(/^CT-/);
    }
  });

  it("needs no credential", async () => {
    expect((await call("GET", "/lookup/contract-types")).statusCode).toBe(200);
  });

  it("filters on a search term", async () => {
    const recorded = await call("GET", "/lookup/contract-types?q=framework");

    expect(json(recorded).map((entry) => entry.code)).toEqual(["CT-FWK"]);
  });

  it("holds the entries a letter-based search cannot reach", async () => {
    // The point of the set: an operator's word for these is not the source's.
    const names = json(await call("GET", "/lookup/contract-types")).map((entry) => entry.name);

    expect(names).toContain("Time and Materials");
    expect(names).toContain("Licence and Subscription");
  });
});

describe("rejections", () => {
  it("405s a write", async () => {
    const recorded = await call("POST", "/lookup/contract-types");

    expect(recorded.statusCode).toBe(405);
    expect(json(recorded).allowed).toEqual(["GET"]);
  });
});
