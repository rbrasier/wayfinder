import { describe, expect, it } from "vitest";
import { createImpersonationTicket } from "@wayfinder/domain";
import {
  IMPERSONATION_COOKIE_NAME,
  signImpersonationTicket,
  verifyImpersonationTicket,
} from "./impersonation-cookie";

const SECRET = "test-secret-please-do-not-reuse";
const OTHER_SECRET = "a-different-secret-entirely";
const ADMIN = "11111111-1111-1111-1111-111111111111";
const TARGET = "22222222-2222-2222-2222-222222222222";
const NOW = new Date("2026-09-15T10:00:00.000Z");

const ticket = createImpersonationTicket(
  { targetUserId: TARGET, impersonatorId: ADMIN },
  NOW,
).data!;

describe("IMPERSONATION_COOKIE_NAME", () => {
  it("is distinct from the Better Auth session cookie", () => {
    expect(IMPERSONATION_COOKIE_NAME).toBe("wf.impersonation");
    expect(IMPERSONATION_COOKIE_NAME).not.toContain("session_token");
  });
});

describe("signImpersonationTicket / verifyImpersonationTicket", () => {
  it("round-trips a ticket unchanged, dates included", () => {
    const signed = signImpersonationTicket(ticket, SECRET);

    expect(verifyImpersonationTicket(signed, SECRET)).toEqual(ticket);
  });

  it("refuses a ticket signed with a different secret", () => {
    const signed = signImpersonationTicket(ticket, OTHER_SECRET);

    expect(verifyImpersonationTicket(signed, SECRET)).toBeNull();
  });

  it("refuses a payload whose contents were edited after signing", () => {
    const signed = signImpersonationTicket(ticket, SECRET);
    const [payload, signature] = signed.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...ticket, targetUserId: ADMIN }),
      "utf8",
    ).toString("base64url");

    expect(verifyImpersonationTicket(`${tamperedPayload}.${signature}`, SECRET)).toBeNull();
    expect(payload).not.toBe(tamperedPayload);
  });

  it("refuses a truncated cookie rather than throwing", () => {
    const signed = signImpersonationTicket(ticket, SECRET);

    expect(verifyImpersonationTicket(signed.slice(0, 10), SECRET)).toBeNull();
  });

  it("refuses a cookie with no signature segment", () => {
    expect(verifyImpersonationTicket("just-one-segment", SECRET)).toBeNull();
  });

  it("refuses an empty cookie", () => {
    expect(verifyImpersonationTicket("", SECRET)).toBeNull();
  });

  it("refuses a signature of the wrong length rather than throwing", () => {
    const [payload] = signImpersonationTicket(ticket, SECRET).split(".");

    expect(verifyImpersonationTicket(`${payload}.abc`, SECRET)).toBeNull();
  });

  it("refuses a well-signed payload that is not a ticket", () => {
    const notATicket = Buffer.from(JSON.stringify({ hello: "world" }), "utf8")
      .toString("base64url");
    const signed = signImpersonationTicket(ticket, SECRET);
    const signature = signed.split(".")[1];

    expect(verifyImpersonationTicket(`${notATicket}.${signature}`, SECRET)).toBeNull();
  });

  it("refuses valid base64 that is not JSON", () => {
    const garbage = Buffer.from("not json at all", "utf8").toString("base64url");

    expect(verifyImpersonationTicket(`${garbage}.abcdef`, SECRET)).toBeNull();
  });
});
