import { describe, expect, it } from "vitest";
import { userInfoFromIdToken } from "../entra-user-info";

const base64url = (value: string): string =>
  Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const idTokenFor = (claims: Record<string, unknown>): string =>
  `${base64url(JSON.stringify({ alg: "none" }))}.${base64url(JSON.stringify(claims))}.`;

describe("userInfoFromIdToken", () => {
  it("reads the identity out of the id token", () => {
    const result = userInfoFromIdToken({
      idToken: idTokenFor({
        sub: "mock-entra|person@example.com",
        name: "Test Person",
        email: "person@example.com",
        email_verified: true,
      }),
    });

    expect(result?.user).toEqual({
      id: "mock-entra|person@example.com",
      name: "Test Person",
      email: "person@example.com",
      emailVerified: true,
    });
  });

  it("lowercases the email so it matches the account key", () => {
    const result = userInfoFromIdToken({
      idToken: idTokenFor({ sub: "abc", email: "Person@Example.com" }),
    });

    expect(result?.user.email).toBe("person@example.com");
  });

  it("falls back to preferred_username when the email claim is absent", () => {
    const result = userInfoFromIdToken({
      idToken: idTokenFor({ sub: "abc", preferred_username: "person@example.com" }),
    });

    expect(result?.user.email).toBe("person@example.com");
  });

  it("returns null when there is no id token", () => {
    expect(userInfoFromIdToken({})).toBeNull();
  });

  it("returns null when no address can be resolved", () => {
    expect(userInfoFromIdToken({ idToken: idTokenFor({ sub: "abc" }) })).toBeNull();
  });

  it("returns null for a malformed token rather than throwing", () => {
    expect(userInfoFromIdToken({ idToken: "not-a-jwt" })).toBeNull();
    expect(userInfoFromIdToken({ idToken: "a.!!!not-base64!!!.c" })).toBeNull();
  });

  describe("email verification", () => {
    it("treats an Entra identity as verified without any verification claim", () => {
      // Entra never emits `email_verified` — that is a generic OIDC claim. The
      // address comes from the tenant directory, not from the user, so it is
      // verified by the tenant vouching for it.
      const result = userInfoFromIdToken({
        idToken: idTokenFor({ sub: "abc", email: "person@example.com" }),
      });

      expect(result?.user.emailVerified).toBe(true);
    });

    it("honours xms_edov: false — Entra saying outright the domain is unverified", () => {
      const result = userInfoFromIdToken({
        idToken: idTokenFor({ sub: "abc", email: "person@example.com", xms_edov: false }),
      });

      expect(result?.user.emailVerified).toBe(false);
    });

    it("honours xms_edov: true", () => {
      const result = userInfoFromIdToken({
        idToken: idTokenFor({ sub: "abc", email: "person@example.com", xms_edov: true }),
      });

      expect(result?.user.emailVerified).toBe(true);
    });

    it("reads the string and numeric spellings some tenants emit", () => {
      const spellings: Array<[unknown, boolean]> = [
        ["false", false],
        ["0", false],
        ["true", true],
        ["1", true],
        [0, false],
        [1, true],
      ];
      for (const [claim, expected] of spellings) {
        const result = userInfoFromIdToken({
          idToken: idTokenFor({ sub: "abc", email: "person@example.com", xms_edov: claim }),
        });
        expect(result?.user.emailVerified, JSON.stringify(claim)).toBe(expected);
      }
    });

    it("trusts an address taken from preferred_username, as the tenant UPN", () => {
      const result = userInfoFromIdToken({
        idToken: idTokenFor({ sub: "abc", preferred_username: "person@example.com" }),
      });

      expect(result?.user.emailVerified).toBe(true);
    });

    it("still defers to a legacy email_verified: false when a provider sends one", () => {
      const result = userInfoFromIdToken({
        idToken: idTokenFor({
          sub: "abc",
          email: "person@example.com",
          email_verified: false,
        }),
      });

      expect(result?.user.emailVerified).toBe(false);
    });
  });
});
