import { describe, expect, it } from "vitest";
import { request, response } from "../test-support/http.mjs";
import { featuredEmployees } from "../directory/roster.mjs";
import { mock } from "./proxy.mjs";

const picker = async (url = "/pki/connect") => {
  const res = response();
  await mock.handle(request("GET", url), res);
  return res.recorded;
};

describe("the certificate picker", () => {
  it("offers a certificate for each featured identity in the shared roster", async () => {
    const body = (await picker()).body;
    for (const employee of featuredEmployees()) {
      expect(body, employee.email).toContain(employee.email);
      expect(body, employee.name).toContain(employee.name);
    }
    expect(body.match(/data-testid="mock-pki-certificate"/g).length).toBe(
      featuredEmployees().length,
    );
  });

  it("puts each certificate's organisational unit on its business unit", async () => {
    const body = (await picker()).body;
    for (const employee of featuredEmployees()) {
      expect(body, employee.email).toContain(
        `name="organisational_unit" value="${employee.businessUnit}"`,
      );
    }
  });

  it("keeps the free-typed address and the two failure toggles", async () => {
    const body = (await picker()).body;
    expect(body).toContain('data-testid="mock-pki-email"');
    expect(body).toContain('data-testid="mock-pki-omit-san"');
    expect(body).toContain('data-testid="mock-pki-fail-verification"');
    expect(body).toContain('data-testid="mock-pki-submit"');
  });

  it("carries the redirect target into every certificate form", async () => {
    const body = (await picker("/pki/connect?redirect=/admin")).body;
    expect(body).toContain('name="redirect" value="/admin"');
  });
});
