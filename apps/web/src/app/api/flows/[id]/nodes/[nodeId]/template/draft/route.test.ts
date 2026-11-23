import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const draftExecute = vi.fn();
const storagePut = vi.fn();
const authorise = vi.fn();

vi.mock("@/lib/template-route-helpers", () => ({
  authoriseTemplateNode: (...args: unknown[]) => authorise(...args),
  // Example bytes in these tests are their own text, so extraction is a decode.
  generatorFor: () => ({
    extractFullText: ({ templateBytes }: { templateBytes: Buffer }) => {
      const text = templateBytes.toString("utf8");
      return text === "corrupt" ? { error: { message: "bad" } } : { data: { text } };
    },
  }),
}));

const { POST } = await import("./route");

const params = Promise.resolve({ id: "flow-1", nodeId: "node-1" });

const requestWith = (files: { name: string; text: string }[], baseIndex?: number) => {
  const form = new FormData();
  for (const file of files) form.append("files", new File([file.text], file.name));
  if (baseIndex !== undefined) form.append("baseIndex", String(baseIndex));
  return new NextRequest("http://localhost/api/flows/flow-1/nodes/node-1/template/draft", {
    method: "POST",
    body: form,
  });
};

const DRAFTED = {
  field: { key: "supplier_name", label: "Supplier Name" },
  line: "Supplier Name",
  sourceText: "Acme",
  occurrence: 0,
  insertAfter: false,
  replacedValue: "Acme",
  context: "Supplier: Acme",
  evidence: { kind: "varies", differsIn: 1, of: 1 },
};

beforeEach(() => {
  storagePut.mockReset();
  authorise.mockReset().mockResolvedValue({
    data: {
      container: {
        objectStorage: { put: storagePut },
        useCases: { draftTemplateFromExamples: { execute: draftExecute } },
      },
      node: { id: "node-1", config: {} },
    },
  });
  draftExecute.mockReset().mockResolvedValue({
    data: {
      fields: [DRAFTED],
      sameInEveryExample: [],
      unplaced: [{ label: "Reference", sourceValue: "PO-42", reason: "could-not-place" }],
      comparison: { originalText: "Supplier: Acme", taggedText: "Supplier: {{ Supplier Name }}", links: [] },
      taggedDocument: Buffer.from("tagged"),
    },
  });
});

describe("POST …/template/draft", () => {
  it("drafts from the base example, comparing it against the others", async () => {
    const response = await POST(
      requestWith([
        { name: "a.docx", text: "Supplier: Globex" },
        { name: "b.docx", text: "Supplier: Acme" },
      ], 1),
      { params },
    );

    expect(response.status).toBe(200);
    expect(draftExecute).toHaveBeenCalledWith(
      expect.objectContaining({ baseText: "Supplier: Acme", otherTexts: ["Supplier: Globex"] }),
    );
  });

  it("returns review rows, the comparison and the tagged document for download", async () => {
    const response = await POST(requestWith([{ name: "a.docx", text: "Supplier: Acme" }]), { params });
    const body = await response.json();

    expect(body.filename).toBe("a.docx");
    expect(body.exampleCount).toBe(1);
    expect(body.rows[0]).toMatchObject({ key: "supplier_name", draft: { replacedValue: "Acme" } });
    expect(body.unplaced).toHaveLength(1);
    expect(body.comparison.taggedText).toBe("Supplier: {{ Supplier Name }}");
    expect(Buffer.from(body.taggedDocument, "base64").toString("utf8")).toBe("tagged");
  });

  it("never stores an example", async () => {
    await POST(requestWith([{ name: "a.docx", text: "Supplier: Acme" }]), { params });

    expect(storagePut).not.toHaveBeenCalled();
  });

  it("refuses a file that is not a Word document, naming it", async () => {
    const response = await POST(requestWith([{ name: "prices.xlsx", text: "x" }]), { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.details[0].subject).toBe("prices.xlsx");
    expect(draftExecute).not.toHaveBeenCalled();
  });

  it("names an example it cannot read", async () => {
    const response = await POST(requestWith([{ name: "broken.docx", text: "corrupt" }]), { params });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.details).toEqual([{ subject: "broken.docx", message: "This file could not be read as a Word document." }]);
  });

  it("says drafting failed when the AI could not draft", async () => {
    draftExecute.mockResolvedValue({ error: { code: "AI_PROVIDER_FAILED", message: "down" } });

    const response = await POST(requestWith([{ name: "a.docx", text: "Supplier: Acme" }]), { params });

    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("Couldn't draft fields from these examples.");
  });

  it("stops at authorisation for a caller who may not edit the flow", async () => {
    authorise.mockResolvedValue({ error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });

    const response = await POST(requestWith([{ name: "a.docx", text: "Supplier: Acme" }]), { params });

    expect(response.status).toBe(403);
    expect(draftExecute).not.toHaveBeenCalled();
  });
});
