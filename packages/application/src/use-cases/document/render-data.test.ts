import { describe, expect, it } from "vitest";
import { parseTemplateFields, type TemplateField } from "@rbrasier/domain";
import { buildRenderData } from "./render-data";

const field = (overrides: Partial<TemplateField>): TemplateField => ({
  key: "field",
  label: "Field",
  type: "text",
  optional: false,
  raw: "Field",
  ...overrides,
});

describe("buildRenderData", () => {
  it("passes string placeholders through and maps a section gate to a boolean", () => {
    const fields = [
      field({ key: "vendor", label: "Vendor" }),
      field({ key: "risk_section", label: "Risk Section", type: "section" }),
    ];
    const data = buildRenderData(fields, { vendor: "Acme", risk_section: "Yes" });
    expect(data).toEqual({ vendor: "Acme", risk_section: true });
  });

  it("binds a group field to its array of item records", () => {
    const group = parseTemplateFields([
      "#Recommendations (repeat)",
      "Owner",
      "/Recommendations",
    ]).data![0]!;
    const items = [{ owner: "Finance" }, { owner: "Ops" }];
    const data = buildRenderData([group], { recommendations: items });
    expect(data).toEqual({ recommendations: items });
  });

  it("binds a missing or non-array group value to an empty array", () => {
    const group = parseTemplateFields(["#Recommendations (repeat)", "Owner", "/Recommendations"])
      .data![0]!;
    expect(buildRenderData([group], {})).toEqual({ recommendations: [] });
    expect(buildRenderData([group], { recommendations: "oops" })).toEqual({ recommendations: [] });
  });
});
