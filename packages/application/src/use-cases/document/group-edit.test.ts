import { describe, it, expect } from "vitest";
import type { TemplateField } from "@rbrasier/domain";
import { validateGroupItems } from "./group-edit";

const suppliersGroup = (overrides: Partial<TemplateField> = {}): TemplateField => ({
  key: "suppliers",
  label: "Suppliers",
  type: "group",
  optional: true,
  raw: "#Suppliers (repeat)",
  itemFields: [
    { key: "name", label: "Name", type: "text", optional: false, raw: "Name" },
    { key: "contact", label: "Contact", type: "email", optional: true, raw: "Contact (email) (optional)" },
    { key: "status", label: "Status", type: "yesno", optional: true, raw: "Status (yesno) (optional)" },
  ],
  ...overrides,
});

describe("validateGroupItems", () => {
  it("keeps valid items and canonicalises each sub-field value", () => {
    const result = validateGroupItems(suppliersGroup(), [
      { name: "Acme", contact: "a@acme.com", status: "yes" },
      { name: "Globex", contact: "", status: "" },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.items).toEqual([
      { name: "Acme", contact: "a@acme.com", status: "Yes" },
      { name: "Globex", contact: "", status: "" },
    ]);
  });

  it("drops a fully-blank row without raising an error", () => {
    const result = validateGroupItems(suppliersGroup(), [
      { name: "Acme", contact: "", status: "" },
      { name: "", contact: "", status: "" },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: "Acme" });
  });

  it("errors when a non-blank row is missing a required sub-field", () => {
    const result = validateGroupItems(suppliersGroup(), [
      { name: "", contact: "a@acme.com", status: "" },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.key).toBe("suppliers");
    expect(result.errors[0]!.message).toContain("Item 1");
    expect(result.errors[0]!.message).toContain("Name");
  });

  it("errors when a sub-field value is invalid for its type", () => {
    const result = validateGroupItems(suppliersGroup(), [
      { name: "Acme", contact: "not-an-email", status: "" },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain("Item 1");
  });

  it("errors when the submitted item count exceeds the group's cap", () => {
    const capped = suppliersGroup({ itemCap: 1 });
    const result = validateGroupItems(capped, [{ name: "Acme" }, { name: "Globex" }]);

    expect(result.errors.some((error) => error.message.includes("at most 1"))).toBe(true);
  });

  it("returns an empty result for no items", () => {
    const result = validateGroupItems(suppliersGroup(), []);
    expect(result).toEqual({ items: [], errors: [] });
  });
});
