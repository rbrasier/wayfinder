import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The chat holds one EventSource and invalidates `session.get` on
// `session.updated` (_content.tsx). Every mutation in the session router
// publishes it; none in the approval router did — so an open chat was never
// told that a request had been sent, decided, withdrawn or reassigned, and the
// originator's gate went on showing a request that had already moved on.
//
// Asserted over the source because the alternative is standing up a tRPC caller
// with a full container: the claim here is "no approval mutation forgets to
// publish", which is a property of the file, and a test that a future mutation
// cannot quietly opt out of.
const source = readFileSync(
  resolve(import.meta.dirname, "routers/approval.ts"),
  "utf8",
);

// Everything that writes to an approval row and so changes what a watcher sees.
const MUTATIONS_THAT_CHANGE_A_ROW = [
  "confirmAndSend",
  "reassign",
  "withdraw",
  "decide",
  // An off-system nomination decides the row and advances the session, so an
  // open chat has exactly as much to re-read as it does after a decision.
  "recordOffSystem",
] as const;

// The block of source belonging to one procedure, up to the next one.
const procedureBody = (name: string): string => {
  const start = source.indexOf(`  ${name}: authenticatedProcedure`);
  expect(start, `${name} procedure not found`).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const end = rest.search(/\n {2}[a-zA-Z]+: authenticatedProcedure/);
  return end === -1 ? rest : rest.slice(0, end);
};

describe("the approval router publishes session events", () => {
  for (const name of MUTATIONS_THAT_CHANGE_A_ROW) {
    it(`${name} publishes session.updated`, () => {
      expect(procedureBody(name)).toContain("publishSessionUpdated(");
    });
  }

  it("publishes with the session id, never the approval id", () => {
    // `sessionEvents.publish` is keyed on the session the chat is watching.
    // Passing an approval id would compile and silently notify nobody.
    const calls = source.match(/publishSessionUpdated\(ctx, ([^)]+)\)/g) ?? [];
    expect(calls.length).toBe(MUTATIONS_THAT_CHANGE_A_ROW.length);
    for (const call of calls) {
      expect(call).toContain("sessionId");
      expect(call).not.toMatch(/approvalId/);
    }
  });

  // Reads must not publish: an event on every poll would invalidate the query
  // that issued it.
  it("does not publish from the read-only procedures", () => {
    for (const name of ["forNode", "listPending", "emailStatus"]) {
      const start = source.indexOf(`  ${name}: authenticatedProcedure`);
      if (start === -1) continue;
      const rest = source.slice(start + 1);
      const end = rest.search(/\n {2}[a-zA-Z]+: authenticatedProcedure/);
      const body = end === -1 ? rest : rest.slice(0, end);
      expect(body).not.toContain("publishSessionUpdated(");
    }
  });
});
