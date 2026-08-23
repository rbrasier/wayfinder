import { describe, expect, it } from "vitest";
import { commonNameFrom, emailAddressFrom, parseSubjectDn } from "./subject-dn";

describe("parseSubjectDn — RFC 2253 / RFC 4514", () => {
  it("reads a plain comma-separated DN, most specific first", () => {
    expect(parseSubjectDn("CN=Ada Lovelace,OU=Technology,O=Wayfinder,C=GB")).toEqual([
      { type: "CN", value: "Ada Lovelace" },
      { type: "OU", value: "Technology" },
      { type: "O", value: "Wayfinder" },
      { type: "C", value: "GB" },
    ]);
  });

  it("keeps an escaped comma inside a value instead of splitting on it", () => {
    // The standard encoding of a "Surname, Given" common name — a routine CA
    // issuance convention, and the case a naive /CN=([^,]+)/ truncates.
    expect(parseSubjectDn("CN=Ravenscroft\\, Cordelia,OU=Technology,O=Wayfinder")).toEqual([
      { type: "CN", value: "Ravenscroft, Cordelia" },
      { type: "OU", value: "Technology" },
      { type: "O", value: "Wayfinder" },
    ]);
  });

  it("decodes backslash escapes and hex escapes in a value", () => {
    expect(commonNameFrom(String.raw`CN=a\+b\;c,O=x`)).toBe("a+b;c");
    expect(commonNameFrom(String.raw`CN=Ada\20Lovelace,O=x`)).toBe("Ada Lovelace");
    expect(commonNameFrom(String.raw`CN=back\\slash,O=x`)).toBe("back\\slash");
  });

  it("keeps a multi-valued RDN's first attribute rather than splitting the DN", () => {
    expect(parseSubjectDn("CN=Ada+UID=12345,O=Wayfinder")).toEqual([
      { type: "CN", value: "Ada" },
      { type: "UID", value: "12345" },
      { type: "O", value: "Wayfinder" },
    ]);
  });

  it("reads the OpenSSL oneline format some proxies still emit", () => {
    // nginx $ssl_client_s_dn_legacy, and Apache's SSL_CLIENT_S_DN.
    expect(parseSubjectDn("/C=GB/O=Wayfinder/OU=Technology/CN=Ada Lovelace")).toEqual([
      { type: "C", value: "GB" },
      { type: "O", value: "Wayfinder" },
      { type: "OU", value: "Technology" },
      { type: "CN", value: "Ada Lovelace" },
    ]);
  });

  it("tolerates whitespace around separators and an empty or malformed DN", () => {
    expect(commonNameFrom("CN = Ada Lovelace , O = Wayfinder")).toBe("Ada Lovelace");
    expect(parseSubjectDn("")).toEqual([]);
    expect(parseSubjectDn("not-a-dn")).toEqual([]);
    expect(commonNameFrom("not-a-dn")).toBeNull();
  });
});

describe("commonNameFrom", () => {
  it("is case-insensitive on the attribute type and returns null when absent", () => {
    expect(commonNameFrom("cn=Ada Lovelace,o=Wayfinder")).toBe("Ada Lovelace");
    expect(commonNameFrom("O=Wayfinder,C=GB")).toBeNull();
  });

  it("returns the first CN when a DN carries more than one", () => {
    expect(commonNameFrom("CN=Ada Lovelace,CN=Users,DC=example")).toBe("Ada Lovelace");
  });
});

describe("emailAddressFrom", () => {
  it("reads the emailAddress attribute a CA puts in the subject", () => {
    expect(emailAddressFrom("CN=Ada Lovelace,emailAddress=ada@example.com,O=Wayfinder")).toBe(
      "ada@example.com",
    );
  });

  it("accepts the E and OID spellings of the same attribute", () => {
    expect(emailAddressFrom("CN=Ada,E=ada@example.com")).toBe("ada@example.com");
    expect(emailAddressFrom("CN=Ada,1.2.840.113549.1.9.1=ada@example.com")).toBe(
      "ada@example.com",
    );
  });

  it("ignores a value that is not an address, and returns null when absent", () => {
    expect(emailAddressFrom("CN=Ada,emailAddress=not-an-address")).toBeNull();
    expect(emailAddressFrom("CN=Ada Lovelace,O=Wayfinder")).toBeNull();
  });
});
