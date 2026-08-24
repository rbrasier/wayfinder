import { describe, expect, it } from "vitest";
import { request, response } from "../test-support/http.mjs";
import { roster } from "../directory/roster.mjs";
import { renderCsv } from "./dataset.mjs";
import { mock } from "./download.mjs";

const call = async (method, url) => {
  const res = response();
  await mock.handle(request(method, url), res);
  return res.recorded;
};

describe("mock registration", () => {
  it("claims the /hr path", () => {
    expect(mock.path).toBe("/hr");
    expect(mock.label).toContain("hr");
  });
});

describe("GET /hr/employees.csv", () => {
  it("serves the roster as a downloadable csv", async () => {
    const recorded = await call("GET", "/hr/employees.csv");
    expect(recorded.statusCode).toBe(200);
    expect(recorded.headers["Content-Type"]).toBe("text/csv; charset=utf-8");
    expect(recorded.headers["Content-Disposition"]).toBe('attachment; filename="employees.csv"');
    expect(recorded.body).toBe(renderCsv());
  });
});

describe("GET /hr/roster.json", () => {
  it("serves the same people as json for debugging", async () => {
    const recorded = await call("GET", "/hr/roster.json");
    expect(recorded.statusCode).toBe(200);
    expect(JSON.parse(recorded.body)).toEqual(roster);
  });
});

describe("GET /hr", () => {
  it("describes what the endpoint offers and how to map the columns", async () => {
    const recorded = await call("GET", "/hr");
    expect(recorded.statusCode).toBe(200);
    expect(recorded.body).toContain("/hr/employees.csv");
    expect(recorded.body).toContain("Employee Email → email");
  });
});

describe("rejections", () => {
  it("404s an unknown path", async () => {
    expect((await call("GET", "/hr/nope")).statusCode).toBe(404);
  });

  it("405s a write", async () => {
    const recorded = await call("POST", "/hr/employees.csv");
    expect(recorded.statusCode).toBe(405);
    expect(recorded.headers.Allow).toBe("GET");
  });
});
