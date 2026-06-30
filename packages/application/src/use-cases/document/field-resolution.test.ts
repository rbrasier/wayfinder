import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  ConversationalNodeConfig,
  IDocumentGenerator,
  SessionMessage,
  TemplateField,
} from "@rbrasier/domain";
import {
  DEFAULT_FIELD_BATCH_SIZE,
  batchTemplateFields,
  buildDocumentTranscript,
  resolveTemplateFields,
} from "./field-resolution";

const field = (key: string): TemplateField => ({
  key,
  label: key,
  type: "text",
  optional: false,
  raw: key,
});

const makeConfig = (overrides: Partial<ConversationalNodeConfig> = {}): ConversationalNodeConfig => ({
  aiInstruction: "Gather details",
  doneWhen: "All gathered",
  outputType: "generate_document",
  documentTemplatePath: "tpl.docx",
  ...overrides,
});

const makeGenerator = (): IDocumentGenerator => ({
  extractTags: vi.fn().mockReturnValue(ok({ tags: [] })),
  extractFields: vi
    .fn()
    .mockReturnValue(ok({ fields: [field("project_title"), field("background")] })),
  extractFullText: vi.fn().mockReturnValue(ok({ text: "" })),
  generate: vi.fn().mockReturnValue(ok({ docxBytes: Buffer.from("x") })),
});

describe("resolveTemplateFields", () => {
  it("uses the node's inline fields without extracting from the template", () => {
    const generator = makeGenerator();
    const inline = [field("vendor")];

    const result = resolveTemplateFields(
      generator,
      makeConfig({ documentTemplateFields: inline }),
      Buffer.from("template"),
    );

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(inline);
    expect(generator.extractFields).not.toHaveBeenCalled();
  });

  it("extracts fields from the template when no inline fields are configured", () => {
    const generator = makeGenerator();

    const result = resolveTemplateFields(generator, makeConfig(), Buffer.from("template"));

    expect(result.error).toBeUndefined();
    expect(result.data?.map((f) => f.key)).toEqual(["project_title", "background"]);
    expect(generator.extractFields).toHaveBeenCalledTimes(1);
  });

  it("propagates an extraction error", () => {
    const generator = makeGenerator();
    (generator.extractFields as ReturnType<typeof vi.fn>).mockReturnValue(
      err(domainError("INFRA_FAILURE", "bad template")),
    );

    const result = resolveTemplateFields(generator, makeConfig(), Buffer.from("template"));

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});

describe("batchTemplateFields", () => {
  it("returns no batches for an empty field list", () => {
    expect(batchTemplateFields([])).toEqual([]);
  });

  it("splits fields into batches of the default size", () => {
    const fields = Array.from({ length: DEFAULT_FIELD_BATCH_SIZE + 2 }, (_, index) =>
      field(`field_${index}`),
    );

    const batches = batchTemplateFields(fields);

    expect(batches.length).toBe(2);
    expect(batches[0]!.length).toBe(DEFAULT_FIELD_BATCH_SIZE);
    expect(batches[1]!.length).toBe(2);
  });

  it("honours an injected batch size", () => {
    const fields = Array.from({ length: 14 }, (_, index) => field(`field_${index}`));

    expect(batchTemplateFields(fields, 5).length).toBe(3);
  });

  it("falls back to the default size when given a non-positive size", () => {
    const fields = Array.from({ length: 13 }, (_, index) => field(`field_${index}`));

    expect(batchTemplateFields(fields, 0).length).toBe(2);
  });
});

describe("buildDocumentTranscript", () => {
  const message = (role: SessionMessage["role"], content: string): SessionMessage =>
    ({ role, content } as SessionMessage);

  it("includes only user and assistant turns, labelled", () => {
    const transcript = buildDocumentTranscript([
      message("user", "I need an RFT"),
      message("assistant", "Sure, what is the budget?"),
      message("system", "Automated step started"),
    ]);

    expect(transcript).toContain("User: I need an RFT");
    expect(transcript).toContain("Assistant: Sure, what is the budget?");
    expect(transcript).not.toContain("Automated step started");
  });

  it("caps the transcript length", () => {
    const transcript = buildDocumentTranscript([message("user", "x".repeat(20000))]);

    expect(transcript.length).toBeLessThanOrEqual(8000);
  });
});
