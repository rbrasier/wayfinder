import { describe, it, expect } from "vitest";
import {
  approvalCommentSlotKey,
  DEFAULT_ITEM_CAP,
  describeTemplateFieldFormat,
  isApprovalOwnedTag,
  isSignatureTag,
  parseTemplateField,
  templateFieldToLine,
  validateTemplateFieldValue,
} from "./template-field";
import { parseTemplateFields } from "./template-field-set";

describe("parseTemplateFields", () => {
  it("parses a list of raw tags", () => {
    const result = parseTemplateFields([
      "Employee Email (email)",
      "Contract Value (currency) (optional)",
    ]);
    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]?.key).toBe("employee_email");
    expect(result.data?.[1]?.key).toBe("contract_value");
  });

  it("deduplicates by key, keeping the first occurrence", () => {
    const result = parseTemplateFields(["Total (currency)", "Total (currency)"]);
    expect(result.data).toHaveLength(1);
  });

  it("returns the first validation error encountered", () => {
    const result = parseTemplateFields(["Email (email)", "Bad (nope)"]);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("nope");
  });

  it("collapses a section open and close tag into one gate field", () => {
    const result = parseTemplateFields(["#Risk Section", "Mitigation (text)", "/Risk Section"]);
    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]).toMatchObject({
      key: "risk_section",
      label: "Risk Section",
      type: "section",
    });
    expect(result.data?.[1]?.key).toBe("mitigation");
  });
});

describe("narrative fields", () => {
  it("parses a bare (narrative) annotation", () => {
    const result = parseTemplateField("Background (narrative)");
    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({
      key: "background",
      label: "Background",
      type: "narrative",
    });
    expect(result.data?.instruction).toBeUndefined();
  });

  it("captures the instruction text from (narrative: \"…\")", () => {
    const result = parseTemplateField('Background (narrative: "Summarise the rationale and context")');
    expect(result.error).toBeUndefined();
    expect(result.data?.type).toBe("narrative");
    expect(result.data?.label).toBe("Background");
    expect(result.data?.instruction).toBe("Summarise the rationale and context");
  });

  it("allows (narrative) combined with (optional)", () => {
    const result = parseTemplateField("Background (narrative) (optional)");
    expect(result.data?.type).toBe("narrative");
    expect(result.data?.optional).toBe(true);
  });

  it("rejects combining (narrative) with a scalar type", () => {
    expect(parseTemplateField("X (date) (narrative)").error?.code).toBe("VALIDATION_FAILED");
    expect(parseTemplateField("X (narrative) (date)").error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects combining (narrative) with (options: …)", () => {
    expect(parseTemplateField("X (narrative) (options: A, B)").error?.code).toBe("VALIDATION_FAILED");
  });

  it("describes a narrative field with its instruction", () => {
    const field = parseTemplateField('Background (narrative: "Explain the funding gap")').data!;
    const description = describeTemplateFieldFormat(field);
    expect(description).toContain("narrative prose");
    expect(description).toContain("Explain the funding gap");
  });
});

describe("section gate fields", () => {
  it("parses a section open tag into a Yes/No gate", () => {
    const result = parseTemplateField("#Risk Section");
    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({
      key: "risk_section",
      label: "Risk Section",
      type: "section",
      optional: true,
    });
  });

  it("treats an inverted-section tag the same as an open tag", () => {
    const result = parseTemplateField("^Risk Section");
    expect(result.data?.key).toBe("risk_section");
    expect(result.data?.type).toBe("section");
  });

  it("derives the same key from the matching close tag", () => {
    expect(parseTemplateField("/Risk Section").data?.key).toBe("risk_section");
  });

  it("rejects a section tag with no name", () => {
    expect(parseTemplateField("#").error?.code).toBe("VALIDATION_FAILED");
  });

  it("describes a section gate as an include/omit decision", () => {
    const field = parseTemplateField("#Risk Section").data!;
    const description = describeTemplateFieldFormat(field);
    expect(description).toContain("Risk Section");
    expect(description.toLowerCase()).toContain("include");
    expect(description).not.toContain("may be left blank");
  });
});

describe("repeating group fields", () => {
  it("parses a {{#name (repeat)}} block into a group with itemFields", () => {
    const result = parseTemplateFields([
      "#Recommendations (repeat)",
      "Number (number)",
      "Owner",
      "/Recommendations",
    ]);
    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(1);
    const group = result.data![0]!;
    expect(group).toMatchObject({ key: "recommendations", label: "Recommendations", type: "group" });
    expect(group.itemFields?.map((field) => field.key)).toEqual(["number", "owner"]);
    expect(group.itemFields?.[0]?.type).toBe("number");
  });

  it("keeps a plain {{#section}} with an inner tag as a gate plus a top-level field", () => {
    // Regression guard: v1.19.0 narrative-in-section must NOT reclassify as a group.
    const result = parseTemplateFields(["#Risk Section", "Mitigation (text)", "/Risk Section"]);
    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]).toMatchObject({ key: "risk_section", type: "section" });
    expect(result.data?.[1]).toMatchObject({ key: "mitigation", type: "text" });
  });

  it("defaults the item cap to DEFAULT_ITEM_CAP", () => {
    const group = parseTemplateField("#Suppliers (repeat)").data!;
    expect(group.type).toBe("group");
    expect(group.itemCap).toBeUndefined();
    expect(describeTemplateFieldFormat({ ...group, itemFields: [] })).toContain(
      `up to ${DEFAULT_ITEM_CAP}`,
    );
  });

  it("reads a per-group item cap from (max: N)", () => {
    const group = parseTemplateField("#Suppliers (repeat) (max: 50)").data!;
    expect(group.type).toBe("group");
    expect(group.itemCap).toBe(50);
  });

  it("rejects a non-positive (max: N) on a group", () => {
    expect(parseTemplateField("#Suppliers (repeat) (max: 0)").error?.code).toBe("VALIDATION_FAILED");
    expect(parseTemplateField("#Suppliers (repeat) (max: two)").error?.code).toBe("VALIDATION_FAILED");
  });

  it("describes a group as a capped list of its item fields", () => {
    const result = parseTemplateFields([
      "#Suppliers (repeat) (max: 5)",
      "Name",
      "Price (currency)",
      "/Suppliers",
    ]);
    const description = describeTemplateFieldFormat(result.data![0]!);
    expect(description).toContain("up to 5 items");
    expect(description).toContain("Name");
    expect(description).toContain("Price");
    expect(description.toLowerCase()).toContain("currency");
  });

  it("rejects an empty repeating group", () => {
    const result = parseTemplateFields(["#Empty (repeat)", "/Empty"]);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message.toLowerCase()).toContain("no fields");
  });

  it("rejects a group nested inside a section", () => {
    const result = parseTemplateFields([
      "#Risk Section",
      "#Findings (repeat)",
      "Detail",
      "/Findings",
      "/Risk Section",
    ]);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message.toLowerCase()).toContain("section");
  });

  it("rejects a section nested inside a group", () => {
    const result = parseTemplateFields([
      "#Findings (repeat)",
      "#Inner Section",
      "/Inner Section",
      "/Findings",
    ]);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a group nested inside another group", () => {
    const result = parseTemplateFields([
      "#Outer (repeat)",
      "#Inner (repeat)",
      "Detail",
      "/Inner",
      "/Outer",
    ]);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  describe("templateFieldToLine", () => {
    const semantic = (line: string) => {
      const parsed = parseTemplateField(line);
      if (parsed.error) throw new Error(`unexpected parse error for "${line}": ${parsed.error.message}`);
      const { label, type, options, multiple, optional, maxLength, max, min } = parsed.data;
      return { label, type, options, multiple, optional, maxLength, max, min };
    };

    const roundTrips = (line: string) => {
      const parsed = parseTemplateField(line);
      if (parsed.error) throw new Error(parsed.error.message);
      const reserialised = templateFieldToLine(parsed.data);
      expect(semantic(reserialised)).toEqual(semantic(line));
    };

    it("omits annotations for a plain text field", () => {
      const parsed = parseTemplateField("Preferred Vendor (text)");
      expect(parsed.error).toBeUndefined();
      expect(templateFieldToLine(parsed.data!)).toBe("Preferred Vendor");
    });

    it("round-trips scalar, options, multi-options and constraint fields", () => {
      roundTrips("Approved (yesno)");
      roundTrips("Budget (currency) (optional)");
      roundTrips("Headcount (number) (min: 1) (max: 500)");
      roundTrips("Notes (text) (maxlen: 200) (optional)");
      roundTrips("Status (options: Approved, Rejected, Pending)");
      roundTrips("Skills (multi-options: Python, Go, Rust) (max: 3)");
      roundTrips("Contact (email)");
    });

    it("returns the raw open tag for a section field untouched", () => {
      const parsed = parseTemplateField("#Risk Section");
      expect(parsed.error).toBeUndefined();
      expect(templateFieldToLine(parsed.data!)).toBe("#Risk Section");
    });
  });

  describe("signature fields", () => {
    it("parses an (approval) tag as an optional signature field", () => {
      const result = parseTemplateField("Delegate Signature (approval)");

      expect(result.error).toBeUndefined();
      expect(result.data).toMatchObject({
        key: "delegate_signature",
        label: "Delegate Signature",
        type: "signature",
        optional: true,
      });
    });

    it("rejects (approval) combined with another type keyword", () => {
      expect(parseTemplateField("Signature (approval) (text)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Signature (date) (approval)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Signature (approval) (narrative)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
    });

    it("rejects (approval) combined with an options list", () => {
      expect(parseTemplateField("Signature (approval) (options: A, B)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Signature (multi-options: A, B) (approval)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
    });

    it("rejects length, numeric and multiple annotations on a signature", () => {
      expect(parseTemplateField("Signature (approval) (maxlen: 200)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Signature (approval) (min: 1)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Signature (max: 3) (approval)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Signature (approval) (multiple)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
    });

    it("rejects a signature inside a repeating group", () => {
      const result = parseTemplateFields([
        "#Findings (repeat)",
        "Detail",
        "Signature (approval)",
        "/Findings",
      ]);

      expect(result.error?.code).toBe("VALIDATION_FAILED");
    });

    it("allows a signature beside ordinary fields at the top level", () => {
      const result = parseTemplateFields([
        "Client Name",
        "Delegate Signature (approval)",
        "Finance Signature (approval)",
      ]);

      expect(result.error).toBeUndefined();
      expect(result.data?.map((field) => [field.key, field.type])).toEqual([
        ["client_name", "text"],
        ["delegate_signature", "signature"],
        ["finance_signature", "signature"],
      ]);
    });

    // Issue #286: `signature` is the parsed type name, the web type-picker value
    // and every internal identifier, so authors reach for it in the document too.
    it("accepts (signature) as a synonym for (approval)", () => {
      const result = parseTemplateField("Delegate Sign Off (signature)");

      expect(result.error).toBeUndefined();
      expect(result.data).toMatchObject({
        key: "delegate_sign_off",
        label: "Delegate Sign Off",
        type: "signature",
        optional: true,
      });
    });

    it("holds the synonym to the same constraints as (approval)", () => {
      expect(parseTemplateField("Signature (signature) (text)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Signature (signature) (maxlen: 200)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
    });

    it("recognises (signature) in the safety filter that keeps slots out of chat", () => {
      expect(isSignatureTag("Delegate Sign Off (signature)")).toBe(true);
      expect(isSignatureTag("Delegate Sign Off (SIGNATURE)")).toBe(true);
    });

    it("serialises a tag written as (signature) back out as (approval)", () => {
      const parsed = parseTemplateField("Delegate Sign Off (signature)");
      expect(parsed.error).toBeUndefined();

      expect(templateFieldToLine(parsed.data!)).toBe("Delegate Sign Off (approval)");
    });

    it("round-trips back to the (approval) annotation, not the type name", () => {
      const parsed = parseTemplateField("Delegate Signature (approval)");
      expect(parsed.error).toBeUndefined();

      expect(templateFieldToLine(parsed.data!)).toBe("Delegate Signature (approval)");
    });

    it("describes a signature as system-filled so it is never asked for", () => {
      const parsed = parseTemplateField("Delegate Signature (approval)");

      expect(describeTemplateFieldFormat(parsed.data!)).toContain("approval");
    });

    it("accepts an empty value and refuses a typed one", () => {
      const parsed = parseTemplateField("Delegate Signature (approval)");

      expect(validateTemplateFieldValue(parsed.data!, "")).toEqual({ data: "" });
      expect(validateTemplateFieldValue(parsed.data!, "Jane Doe").error?.code).toBe(
        "VALIDATION_FAILED",
      );
    });
  });

  describe("approval comment fields", () => {
    it("parses an (approval-comment: …) tag as an optional comment bound to its signature", () => {
      const result = parseTemplateField("Delegate Note (approval-comment: Delegate Signature)");

      expect(result.error).toBeUndefined();
      expect(result.data).toMatchObject({
        key: "delegate_note",
        label: "Delegate Note",
        type: "approval_comment",
        signatureLabel: "Delegate Signature",
        optional: true,
      });
    });

    it("accepts (signature-comment: …) as a synonym", () => {
      const result = parseTemplateField("Delegate Note (signature-comment: Delegate Signature)");

      expect(result.error).toBeUndefined();
      expect(result.data).toMatchObject({
        type: "approval_comment",
        signatureLabel: "Delegate Signature",
      });
    });

    it("resolves the bound signature to the key the slot renders under", () => {
      const parsed = parseTemplateField("Delegate Note (approval-comment: Delegate Signature)");
      const signature = parseTemplateField("Delegate Signature (approval)");

      expect(approvalCommentSlotKey(parsed.data!)).toBe(signature.data!.key);
    });

    it("binds a bare (approval-comment) to the template's only signature", () => {
      const result = parseTemplateFields([
        "Client Name",
        "Delegate Signature (approval)",
        "Reason For Decision (approval-comment)",
      ]);

      expect(result.error).toBeUndefined();
      const comment = result.data?.find((field) => field.type === "approval_comment");
      expect(approvalCommentSlotKey(comment!)).toBe("delegate_signature");
    });

    it("rejects a bare (approval-comment) when the template declares no signature", () => {
      const result = parseTemplateFields(["Client Name", "Reason For Decision (approval-comment)"]);

      expect(result.error?.code).toBe("VALIDATION_FAILED");
      expect(result.error?.message).toContain("Reason For Decision");
    });

    // The whole point of the explicit reference: with two slots, a guess would
    // print one approver's words under another approver's name.
    it("rejects a bare (approval-comment) when the template declares more than one signature", () => {
      const result = parseTemplateFields([
        "Delegate Signature (approval)",
        "Finance Signature (approval)",
        "Reason For Decision (approval-comment)",
      ]);

      expect(result.error?.code).toBe("VALIDATION_FAILED");
      expect(result.error?.message).toContain("Delegate Signature");
      expect(result.error?.message).toContain("Finance Signature");
    });

    it("rejects a comment naming a signature the template does not declare", () => {
      const result = parseTemplateFields([
        "Delegate Signature (approval)",
        "Legal Note (approval-comment: Legal Signature)",
      ]);

      expect(result.error?.code).toBe("VALIDATION_FAILED");
      expect(result.error?.message).toContain("Legal Signature");
    });

    it("binds each comment to its own signature when a document carries several", () => {
      const result = parseTemplateFields([
        "Delegate Note (approval-comment: Delegate Signature)",
        "Delegate Signature (approval)",
        "Finance Signature (approval)",
        "Finance Note (approval-comment: Finance Signature)",
      ]);

      expect(result.error).toBeUndefined();
      expect(
        result.data
          ?.filter((field) => field.type === "approval_comment")
          .map((field) => [field.key, approvalCommentSlotKey(field)]),
      ).toEqual([
        ["delegate_note", "delegate_signature"],
        ["finance_note", "finance_signature"],
      ]);
    });

    it("rejects an approval comment inside a repeating group", () => {
      const result = parseTemplateFields([
        "Delegate Signature (approval)",
        "#Findings (repeat)",
        "Detail",
        "Note (approval-comment: Delegate Signature)",
        "/Findings",
      ]);

      expect(result.error?.code).toBe("VALIDATION_FAILED");
    });

    it("rejects an approval comment combined with another type keyword", () => {
      expect(
        parseTemplateField("Note (approval-comment: Delegate Signature) (text)").error?.code,
      ).toBe("VALIDATION_FAILED");
      expect(
        parseTemplateField("Note (narrative) (approval-comment: Delegate Signature)").error?.code,
      ).toBe("VALIDATION_FAILED");
      expect(parseTemplateField("Note (approval) (approval-comment)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
    });

    it("rejects length, numeric, multiple and options annotations on an approval comment", () => {
      expect(parseTemplateField("Note (approval-comment) (maxlen: 200)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Note (approval-comment) (min: 1)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Note (approval-comment) (multiple)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
      expect(parseTemplateField("Note (approval-comment) (options: A, B)").error?.code).toBe(
        "VALIDATION_FAILED",
      );
    });

    it("round-trips back to the canonical (approval-comment: …) annotation", () => {
      const parsed = parseTemplateField("Delegate Note (signature-comment: Delegate Signature)");
      expect(parsed.error).toBeUndefined();

      expect(templateFieldToLine(parsed.data!)).toBe(
        "Delegate Note (approval-comment: Delegate Signature)",
      );
    });

    it("round-trips an unbound comment without inventing a signature", () => {
      const parsed = parseTemplateField("Delegate Note (approval-comment)");
      expect(parsed.error).toBeUndefined();

      expect(templateFieldToLine(parsed.data!)).toBe("Delegate Note (approval-comment)");
    });

    it("is recognised by the safety filter that keeps approval-owned tags out of chat", () => {
      expect(isApprovalOwnedTag("Delegate Note (approval-comment: Delegate Signature)")).toBe(true);
      expect(isApprovalOwnedTag("Delegate Note (SIGNATURE-COMMENT: Delegate Signature)")).toBe(
        true,
      );
      expect(isApprovalOwnedTag("Delegate Signature (approval)")).toBe(true);
      expect(isApprovalOwnedTag("Client Name (text)")).toBe(false);
    });

    // A comment tag is not a signature tag: the two filters answer different
    // questions, and conflating them would let a comment claim a signature slot.
    it("is not mistaken for a signature tag", () => {
      expect(isSignatureTag("Delegate Note (approval-comment: Delegate Signature)")).toBe(false);
    });

    it("describes an approval comment as system-filled so it is never asked for", () => {
      const parsed = parseTemplateField("Delegate Note (approval-comment: Delegate Signature)");

      expect(describeTemplateFieldFormat(parsed.data!)).toContain("approval");
    });

    it("accepts an empty value and refuses a typed one", () => {
      const parsed = parseTemplateField("Delegate Note (approval-comment: Delegate Signature)");

      expect(validateTemplateFieldValue(parsed.data!, "")).toEqual({ data: "" });
      expect(validateTemplateFieldValue(parsed.data!, "Looks fine to me").error?.code).toBe(
        "VALIDATION_FAILED",
      );
    });
  });

  it("allows a top-level field, a group, and a section together", () => {
    const result = parseTemplateFields([
      "Client Name",
      "#Recommendations (repeat)",
      "Text",
      "/Recommendations",
      "#Risk Section",
      "/Risk Section",
    ]);
    expect(result.error).toBeUndefined();
    expect(result.data?.map((field) => [field.key, field.type])).toEqual([
      ["client_name", "text"],
      ["recommendations", "group"],
      ["risk_section", "section"],
    ]);
  });
});
