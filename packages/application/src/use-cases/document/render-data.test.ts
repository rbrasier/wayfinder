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

  it("substitutes a signature slot with the attestation block it was given", () => {
    const signature = field({ key: "delegate_signature", label: "Delegate Signature", type: "signature", optional: true });
    const block = "Approved by:   Jane Doe\nDecision:      Approved";

    const data = buildRenderData([signature], { delegate_signature: block });

    expect(data).toEqual({ delegate_signature: block });
  });

  it("renders an undecided signature slot empty rather than implying an approval", () => {
    const signature = field({ key: "delegate_signature", label: "Delegate Signature", type: "signature", optional: true });

    expect(buildRenderData([signature], {})).toEqual({ delegate_signature: "" });
  });

  it("binds a missing or non-array group value to an empty array", () => {
    const group = parseTemplateFields(["#Recommendations (repeat)", "Owner", "/Recommendations"])
      .data![0]!;
    expect(buildRenderData([group], {})).toEqual({ recommendations: [] });
    expect(buildRenderData([group], { recommendations: "oops" })).toEqual({ recommendations: [] });
  });
});

describe("buildRenderData — external-sourced fields", () => {
  const externalField: TemplateField = {
    key: "department",
    label: "Department",
    type: "text",
    optionsSource: "departments",
    optional: false,
    raw: "Department (options-source: departments)",
  };

  it("renders the display for the field and the key for its accessor", () => {
    const data = buildRenderData([externalField], { department: "Finance" }, {
      department: "FIN-001",
    });

    expect(data.department).toBe("Finance");
    expect(data.department_key).toBe("FIN-001");
  });

  it("renders an empty accessor when the source declares no key field", () => {
    const data = buildRenderData([externalField], { department: "Finance" });

    expect(data.department_key).toBe("");
  });

  it("adds no accessor entry for a field with no source", () => {
    const data = buildRenderData(
      [{ key: "client", label: "Client", type: "text", optional: false, raw: "Client" }],
      { client: "Acme" },
    );

    expect("client_key" in data).toBe(false);
  });
});
