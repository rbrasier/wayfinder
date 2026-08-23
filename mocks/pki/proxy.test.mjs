import { describe, expect, it } from "vitest";
import { formOwning, formStructure, request, response } from "../test-support/http.mjs";
import { featuredEmployees } from "../directory/roster.mjs";
import { certificateHeadersFor, mock } from "./proxy.mjs";

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

  it("keeps the free-typed address and every certificate-shape toggle", async () => {
    const body = (await picker()).body;
    for (const testId of [
      "mock-pki-email",
      "mock-pki-omit-san",
      "mock-pki-fail-verification",
      "mock-pki-surname-first",
      "mock-pki-dn-email",
      "mock-pki-no-cert",
      "mock-pki-submit",
    ]) {
      expect(body, testId).toContain(`data-testid="${testId}"`);
    }
  });

  it("closes every form it opens", async () => {
    const structure = formStructure((await picker()).body);
    expect(structure.unclosed).toBe(false);
    expect(structure.swallowed).toEqual([]);
    expect(structure.opened).toBe(featuredEmployees().length + 1);
  });

  it("keeps the free-typed address in a form of its own, with no identity attached", async () => {
    const form = formOwning((await picker()).body, "mock-pki-email");
    expect(form).toContain('data-testid="mock-pki-submit"');
    expect(form).not.toContain('type="hidden" name="email"');
  });

  it("carries the redirect target into every certificate form", async () => {
    const body = (await picker("/pki/connect?redirect=/admin")).body;
    expect(body).toContain('name="redirect" value="/admin"');
  });
});

describe("the headers a real mTLS proxy would forward", () => {
  const headers = (form) => certificateHeadersFor(new URLSearchParams(form));

  it("verifies as SUCCESS and forwards an RFC 2253 subject DN", () => {
    const forwarded = headers({ email: "ada@example.com", name: "Ada Lovelace", organisational_unit: "Technology" });
    expect(forwarded["x-ssl-client-verified"]).toBe("SUCCESS");
    // nginx has emitted $ssl_client_s_dn in RFC 2253 form — comma separated,
    // most specific first — since 1.11.6.
    expect(forwarded["x-ssl-client-subject-dn"]).toBe(
      "CN=Ada Lovelace,OU=Technology,O=Wayfinder,C=GB",
    );
    expect(forwarded["x-ssl-client-san-email"]).toBe("ada@example.com");
  });

  it("reports a rejection the way nginx does, with a reason after the colon", () => {
    const forwarded = headers({ email: "ada@example.com", verification_failed: "1" });
    // $ssl_client_verify is SUCCESS, NONE, or FAILED:<reason> (nginx >= 1.11.7).
    // A bare "FAILED" is not a string any real proxy sends.
    expect(forwarded["x-ssl-client-verified"]).toMatch(/^FAILED:\S/);
  });

  it("forwards a SHA-1 fingerprint, the only digest nginx computes", () => {
    const forwarded = headers({ email: "ada@example.com" });
    expect(forwarded["x-ssl-client-fingerprint"]).toMatch(/^[0-9a-f]{40}$/);
  });

  it("keeps the fingerprint stable per address and distinct between addresses", () => {
    expect(headers({ email: "ada@example.com" })["x-ssl-client-fingerprint"]).toBe(
      headers({ email: "ADA@example.com" })["x-ssl-client-fingerprint"],
    );
    expect(headers({ email: "ada@example.com" })["x-ssl-client-fingerprint"]).not.toBe(
      headers({ email: "grace@example.com" })["x-ssl-client-fingerprint"],
    );
  });

  it("issues a surname-first common name, escaped as RFC 2253 requires", () => {
    const forwarded = headers({
      email: "ada@example.com",
      name: "Ada Lovelace",
      surname_first: "1",
    });
    expect(forwarded["x-ssl-client-subject-dn"]).toContain("CN=Lovelace\\, Ada,");
  });

  it("issues an address in the subject instead of a SAN, as a CA without SANs does", () => {
    const forwarded = headers({
      email: "ada@example.com",
      name: "Ada Lovelace",
      dn_email: "1",
    });
    expect(forwarded["x-ssl-client-san-email"]).toBeUndefined();
    expect(forwarded["x-ssl-client-subject-dn"]).toContain("emailAddress=ada@example.com");
    expect(forwarded["x-ssl-client-subject-dn"]).toContain("CN=Ada Lovelace");
  });

  it("reports NONE and sends no certificate when none was presented", () => {
    const forwarded = headers({ email: "ada@example.com", no_certificate: "1" });
    expect(forwarded["x-ssl-client-verified"]).toBe("NONE");
    expect(forwarded["x-ssl-client-subject-dn"]).toBeUndefined();
    expect(forwarded["x-ssl-client-fingerprint"]).toBeUndefined();
    expect(forwarded["x-ssl-client-san-email"]).toBeUndefined();
  });

  it("omits the SAN email on request, leaving the CN as the only address", () => {
    const forwarded = headers({ email: "ada@example.com", name: "Ada Lovelace", omit_san_email: "1" });
    expect(forwarded["x-ssl-client-san-email"]).toBeUndefined();
    expect(forwarded["x-ssl-client-subject-dn"]).toContain("CN=ada@example.com");
  });
});
