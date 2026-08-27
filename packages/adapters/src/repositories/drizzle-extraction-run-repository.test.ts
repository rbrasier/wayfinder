import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { ExtractionFieldResult } from "@rbrasier/domain";
import {
  buildClaimPendingStatement,
  persistedAggregateConfidence,
} from "./drizzle-extraction-run-repository";

// The claim runs against a live DB, so here we lock in the generated SQL shape:
// a bounded, oldest-first, single-batch UPDATE that atomically leases pending
// documents with FOR UPDATE SKIP LOCKED — never a double-claim, never an
// unbounded rewrite.
const render = (runId: string, limit: number) =>
  new PgDialect().sqlToQuery(buildClaimPendingStatement(runId, limit));

describe("buildClaimPendingStatement", () => {
  it("claims pending rows for one run with SKIP LOCKED", () => {
    const { sql, params } = render("run-1", 10);
    const text = sql.toLowerCase();

    expect(text).toContain("update");
    expect(text).toContain("app_extraction_documents");
    expect(text).toContain("status = 'extracting'");
    expect(text).toContain("attempts = attempts + 1");
    expect(text).toContain("status = 'pending'");
    expect(text).toContain("for update skip locked");
    expect(params).toContain("run-1");
    expect(params).toContain(10);
  });

  it("bounds and orders the claimed batch", () => {
    const { sql } = render("run-1", 5);
    const text = sql.toLowerCase();

    expect(text).toContain("order by");
    expect(text).toContain("asc");
    expect(text).toContain("limit");
    // The bounded id set is chosen in a nested select before the update.
    expect(text.indexOf("select")).toBeGreaterThan(text.indexOf("update"));
    expect(text).toContain("returning");
  });
});

// The column is the accuracy aggregate and nothing else: every historical field
// is accuracy-kind, so what it already holds keeps its exact meaning. It is
// written through the domain function so the adapter cannot drift from it again
// (ADR-053 §3).
describe("persistedAggregateConfidence", () => {
  const field = (overrides: Partial<ExtractionFieldResult> = {}): ExtractionFieldResult => ({
    key: "price",
    value: "£10",
    confidence: 0.9,
    rationale: "",
    ...overrides,
  });

  it("writes the weakest field's confidence for an all-accuracy record, as it always has", () => {
    expect(
      persistedAggregateConfidence([field({ confidence: 0.9 }), field({ key: "term", confidence: 0.4 })]),
    ).toBe(0.4);
  });

  it("writes zero for a record with no fields", () => {
    expect(persistedAggregateConfidence([])).toBe(0);
  });

  it("clamps a confidence outside [0, 1] — the clamp the adapter's own copy omitted", () => {
    expect(persistedAggregateConfidence([field({ confidence: 1.4 })])).toBe(1);
  });

  it("leaves selection-scale fields out, so the column never mixes two questions", () => {
    const fields = [
      field({ key: "rate", confidence: 0.2, provenance: "verbatim" }),
      field({ key: "summary", confidence: 0.7 }),
    ];
    expect(persistedAggregateConfidence(fields)).toBe(0.7);
  });

  it("writes zero for a record whose fields are all selection-scale", () => {
    expect(persistedAggregateConfidence([field({ confidence: 0.6, provenance: "verbatim" })])).toBe(0);
  });
});
