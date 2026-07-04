import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildEnrolParticipantStatement } from "./drizzle-session-participant-repository";

// Enrolment must be idempotent: opening the collaborate link twice, or a
// revoked viewer re-opening it, must never duplicate the row or silently upgrade
// the role (scaling wall #11). A live DB is needed to prove the conflict handling
// end to end, so here we lock in the ON CONFLICT DO NOTHING shape so it can never
// regress into a duplicate-key crash or an unconditional upsert.
const render = (statement: Parameters<PgDialect["sqlToQuery"]>[0]) =>
  new PgDialect().sqlToQuery(statement);

describe("buildEnrolParticipantStatement", () => {
  it("inserts the participant but does nothing on an existing membership", () => {
    const { sql, params } = render(
      buildEnrolParticipantStatement({
        sessionId: "session-1",
        userId: "user-1",
        role: "collaborator",
        invitedBy: "owner-1",
      }),
    );
    const text = sql.toLowerCase();

    expect(text).toContain("insert into");
    expect(text).toContain("on conflict");
    expect(text).toContain("do nothing");
    // Returns the inserted row so the caller can distinguish a fresh join from a
    // no-op (which then re-reads the existing row).
    expect(text).toContain("returning");
    expect(params).toContain("session-1");
    expect(params).toContain("user-1");
    expect(params).toContain("collaborator");
    expect(params).toContain("owner-1");
  });

  it("carries a null inviter when none is supplied", () => {
    const { params } = render(
      buildEnrolParticipantStatement({
        sessionId: "session-2",
        userId: "user-2",
        role: "viewer",
      }),
    );
    expect(params).toContain(null);
  });
});
