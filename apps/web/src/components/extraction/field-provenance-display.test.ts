import { describe, expect, it } from "vitest";
import {
  aggregateConfidenceSummaries,
  confidenceMetricLabel,
  derivationSummary,
  provenanceStyle,
  reportBandSource,
  sourceRefSummary,
} from "./field-provenance-display";

const field = (overrides: Record<string, unknown> = {}) => ({
  key: "price",
  value: "£10",
  confidence: 0.9,
  rationale: "",
  ...overrides,
});

describe("provenanceStyle", () => {
  it("gives each provenance its own label and marker, so none reads as another", () => {
    const styles = (["verbatim", "processed", "derived", "human_corrected"] as const).map((provenance) =>
      provenanceStyle(provenance),
    );
    expect(new Set(styles.map((style) => style.label)).size).toBe(4);
    expect(new Set(styles.map((style) => style.className)).size).toBe(4);
  });

  it("describes a human correction as a person's decision, not a model score", () => {
    expect(provenanceStyle("human_corrected").label).toBe("Corrected");
    expect(provenanceStyle("human_corrected").description).toContain("person");
  });

  it("says nothing about the source's own correctness for a verbatim field", () => {
    const description = provenanceStyle("verbatim").description.toLowerCase();
    expect(description).toContain("unchanged");
    expect(description).not.toContain("accurate");
    expect(description).not.toContain("correct");
  });
});

describe("confidenceMetricLabel", () => {
  it("asks the selection question of a copied value", () => {
    expect(confidenceMetricLabel(field({ provenance: "verbatim" }))).toBe(
      "Selection confidence",
    );
  });

  it("asks the accuracy question of a composed value", () => {
    expect(confidenceMetricLabel(field())).toBe("Accuracy confidence");
  });

  it("reads a field recorded before provenance existed as an accuracy metric", () => {
    expect(confidenceMetricLabel({ key: "price", value: "", confidence: 0, rationale: "" })).toBe(
      "Accuracy confidence",
    );
  });
});

describe("derivationSummary", () => {
  it("names the method and the fields it read", () => {
    const summary = derivationSummary(
      field({ derivation: { method: "unit × quantity", sourceKeys: ["unit", "quantity"] } }),
    );
    expect(summary).toBe("unit × quantity (from unit, quantity)");
  });

  it("names the method alone when it read no other fields", () => {
    expect(derivationSummary(field({ derivation: { method: "VAT at 20%", sourceKeys: [] } }))).toBe(
      "VAT at 20%",
    );
  });

  it("is absent for a field that was not derived", () => {
    expect(derivationSummary(field())).toBeNull();
  });
});

describe("sourceRefSummary", () => {
  it("names the document and the locator inside it", () => {
    const summary = sourceRefSummary(
      field({ sourceRef: { documentId: "doc-1", locator: "page 4, table 2" } }),
      new Map([["doc-1", "quote.pdf"]]),
    );
    expect(summary).toBe("quote.pdf — page 4, table 2");
  });

  it("falls back to the document id when the file is not on the record", () => {
    const summary = sourceRefSummary(
      field({ sourceRef: { documentId: "doc-9", locator: "page 1" } }),
      new Map(),
    );
    expect(summary).toBe("doc-9 — page 1");
  });

  it("is absent for a field with no source reference", () => {
    expect(sourceRefSummary(field(), new Map())).toBeNull();
  });
});

describe("aggregateConfidenceSummaries", () => {
  it("reports each scale it has, naming which question the number answers", () => {
    const summaries = aggregateConfidenceSummaries({
      fields: [field({ confidence: 0.4 }), field({ key: "rate", confidence: 0.6, provenance: "verbatim" })],
    });
    expect(summaries).toEqual([
      { kind: "accuracy", text: "40% overall accuracy confidence" },
      { kind: "selection", text: "60% overall selection confidence" },
    ]);
  });

  it("omits a scale the record has no fields of rather than reporting it as zero", () => {
    const summaries = aggregateConfidenceSummaries({ fields: [field({ confidence: 0.4 })] });
    expect(summaries).toEqual([{ kind: "accuracy", text: "40% overall accuracy confidence" }]);
  });

  it("reports nothing for a record with no fields", () => {
    expect(aggregateConfidenceSummaries({ fields: [] })).toEqual([]);
  });
});

describe("reportBandSource", () => {
  it("bands on accuracy when the record has accuracy-kind fields", () => {
    expect(reportBandSource({ selection: 0.9, accuracy: 0.3 })).toEqual({
      band: "red",
      kind: "accuracy",
    });
  });

  it("falls back to selection for a record that is entirely verbatim", () => {
    expect(reportBandSource({ selection: 0.9, accuracy: null })).toEqual({
      band: "green",
      kind: "selection",
    });
  });

  it("has no band to show for a record with no fields", () => {
    expect(reportBandSource({ selection: null, accuracy: null })).toBeNull();
  });
});
