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
