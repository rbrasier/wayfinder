import { describe, expect, it } from "vitest";
import type { TemplateField } from "@rbrasier/domain";
import { buildStepOutputFields } from "./step-output-fields";

const field = (key: string, type: TemplateField["type"] = "text"): TemplateField => ({
  key,
  label: key.toUpperCase(),
  type,
  optional: false,
  raw: key,
});

describe("buildStepOutputFields", () => {
  it("maps scalar field values into step-output fields", () => {
    const fields = [field("owner"), field("amount", "currency")];
    const result = buildStepOutputFields(fields, { owner: "Alex", amount: "$1,200.00" });
    expect(result).toEqual([
      { key: "owner", label: "OWNER", type: "text", options: undefined, value: "Alex" },
      { key: "amount", label: "AMOUNT", type: "currency", options: undefined, value: "$1,200.00" },
    ]);
  });

  it("blanks a scalar value that is missing or not a string", () => {
    const result = buildStepOutputFields([field("owner")], {});
    expect(result[0]!.value).toBe("");
  });

  it("carries group items and leaves the group value blank", () => {
    const group = { ...field("people", "group"), itemFields: [field("name")] };
    const items = [{ name: "Sam" }, { name: "Jo" }];
    const result = buildStepOutputFields([group], { people: items });
    expect(result[0]).toEqual({
      key: "people",
      label: "PEOPLE",
      type: "group",
      options: undefined,
      value: "",
      items,
    });
  });

  it("defaults a non-array group value to an empty item list", () => {
    const group = { ...field("people", "group"), itemFields: [field("name")] };
    const result = buildStepOutputFields([group], { people: "not-an-array" });
    expect(result[0]!.items).toEqual([]);
  });
});

describe("buildStepOutputFields — external-sourced fields", () => {
  const snapshot = {
    name: "departments",
    version: "v-2026-08-02",
    fetchedAt: new Date("2026-08-02T09:00:00.000Z"),
  };

  const externalField: TemplateField = {
    key: "department",
    label: "Department",
    type: "text",
    optionsSource: "departments",
    optional: false,
    raw: "Department (options-source: departments)",
  };

  it("stores the key and the snapshot the value was validated against", () => {
    const [field] = buildStepOutputFields([externalField], { department: "Finance" }, {
      department: { valueKey: "FIN-001", sourceRef: snapshot },
    });

    expect(field?.value).toBe("Finance");
    expect(field?.valueKey).toBe("FIN-001");
    expect(field?.sourceRef).toEqual(snapshot);
  });

  it("stores the display alone when the source declares no key", () => {
    const [field] = buildStepOutputFields([externalField], { department: "Finance" }, {
      department: { sourceRef: snapshot },
    });

    expect(field?.valueKey).toBeUndefined();
    expect(field?.sourceRef).toEqual(snapshot);
  });

  it("leaves options empty for an external field even when a set was inlined", () => {
    const inlined = { ...externalField, options: ["Finance (FIN-001)"] };

    const [field] = buildStepOutputFields([inlined], { department: "Finance" });

    expect(field?.options).toBeUndefined();
  });

  it("keeps inline options for a field that is not externally sourced", () => {
    const inline: TemplateField = {
      key: "status",
      label: "Status",
      type: "text",
      options: ["Open", "Closed"],
      optional: false,
      raw: "Status (options: Open, Closed)",
    };

    const [field] = buildStepOutputFields([inline], { status: "Open" });

    expect(field?.options).toEqual(["Open", "Closed"]);
  });
});
