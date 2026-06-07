import { describe, expect, it } from "vitest";
import type { FieldValueSource, PriorStepField } from "@rbrasier/domain";
import { decodeSource, encodeSource, groupPriorStepFields } from "./field-value-selector";

const priorField = (
  nodeId: string,
  stepNumber: number,
  stepName: string,
  key: string,
): PriorStepField => ({
  nodeId,
  stepLabel: `${stepNumber}. ${stepName}`,
  stepNumber,
  stepName,
  field: { key, label: key, type: "text" },
});

describe("encodeSource / decodeSource", () => {
  const roundTrip = (source: FieldValueSource) => decodeSource(encodeSource(source), source);

  it("round-trips ai, none, literal and step_field sources", () => {
    expect(roundTrip({ kind: "ai" })).toEqual({ kind: "ai" });
    expect(roundTrip({ kind: "none" })).toEqual({ kind: "none" });
    expect(roundTrip({ kind: "literal", value: "hello" })).toEqual({ kind: "literal", value: "hello" });
    expect(roundTrip({ kind: "step_field", nodeId: "n1", fieldKey: "f1" })).toEqual({
      kind: "step_field",
      nodeId: "n1",
      fieldKey: "f1",
    });
  });

  it("encodes No value as `none`", () => {
    expect(encodeSource({ kind: "none" })).toBe("none");
    expect(decodeSource("none", { kind: "ai" })).toEqual({ kind: "none" });
  });
});

describe("groupPriorStepFields", () => {
  it("groups fields by step and orders the groups by step number", () => {
    const groups = groupPriorStepFields([
      priorField("n2", 2, "Choose vendor", "vendor"),
      priorField("n1", 1, "Gather", "name"),
      priorField("n1", 1, "Gather", "email"),
    ]);

    expect(groups.map((group) => group.stepNumber)).toEqual([1, 2]);
    expect(groups[0]!.fields.map((field) => field.field.key)).toEqual(["name", "email"]);
    expect(groups[1]!.stepName).toBe("Choose vendor");
  });
});
