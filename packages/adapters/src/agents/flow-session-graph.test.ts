import { describe, it, expect } from "vitest";
import { FlowSessionGraph } from "./flow-session-graph";

const agent = new FlowSessionGraph();

const baseInput = {
  nodeConfig: {
    aiInstruction: "Help the user describe their procurement need.",
    doneWhen: "The user has described what they need to buy and approximate budget.",
    outputType: "conversation_only" as const,
    documentTemplateContent: null,
    documentTemplatePath: null,
    documentTemplateFilename: null,
  },
  contextDocs: [],
  gatheredContext: "",
  workflowName: "Procurement Request",
  organisationName: null,
  expertRole: null,
};

// ── buildSystemPrompt ────────────────────────────────────────────────────────

describe("FlowSessionGraph.buildSystemPrompt", () => {
  it("omits expert sentences when expertRole is null but still names the workflow", () => {
    const result = agent.buildSystemPrompt(baseInput);
    expect(result.error).toBeUndefined();
    expect(result.data).toContain("Procurement Request");
    expect(result.data).not.toContain("world-class");
    expect(result.data).not.toContain("AI assistant");
  });

  it("includes expert persona when expertRole is set", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      expertRole: "procurement specialist",
      organisationName: null,
    });
    expect(result.error).toBeUndefined();
    expect(result.data).toContain("world-class procurement specialist");
    expect(result.data).not.toMatch(/experience at \w/);
  });

  it("includes organisation name in role when set", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      expertRole: "procurement specialist",
      organisationName: "Acme Corp",
    });
    expect(result.data).toContain("at Acme Corp");
  });

  it("omits organisation clause when organisationName is null", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      expertRole: "procurement specialist",
      organisationName: null,
    });
    expect(result.data).not.toMatch(/experience at \w/);
  });

  it("includes <instructions> with aiInstruction", () => {
    const result = agent.buildSystemPrompt(baseInput);
    expect(result.data).toContain("<instructions>");
    expect(result.data).toContain("Help the user describe their procurement need.");
  });

  it("includes <completion_criteria> with doneWhen", () => {
    const result = agent.buildSystemPrompt(baseInput);
    expect(result.data).toContain("<completion_criteria>");
    expect(result.data).toContain("described what they need to buy");
  });

  it("omits <gathered_context> when gatheredContext is empty", () => {
    const result = agent.buildSystemPrompt(baseInput);
    expect(result.data).not.toContain("<gathered_context>");
  });

  it("includes <gathered_context> when gatheredContext is non-empty", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      gatheredContext: "- Item needed: laptops\n- Budget: $5000",
    });
    expect(result.data).toContain("<gathered_context>");
    expect(result.data).toContain("laptops");
  });

  it("omits <reference_documents> when contextDocs is empty", () => {
    const result = agent.buildSystemPrompt(baseInput);
    expect(result.data).not.toContain("<reference_documents>");
  });

  it("includes <reference_documents> when contextDocs are present", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      contextDocs: [
        { id: "doc-1", filename: "policy.pdf", mimeType: "application/pdf", sizeBytes: 1024, storagePath: "/docs/policy.pdf", extractedText: null, extractionStatus: "pending" as const },
      ],
    });
    expect(result.data).toContain("<reference_documents>");
    expect(result.data).toContain("policy.pdf");
  });

  it("injects extracted text inside <document> tags when status is complete", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      contextDocs: [
        { id: "doc-1", filename: "policy.pdf", mimeType: "application/pdf", sizeBytes: 1024, storagePath: "/docs/policy.pdf", extractedText: "All purchases must be approved.", extractionStatus: "complete" as const },
      ],
    });
    expect(result.data).toContain('<document name="policy.pdf">');
    expect(result.data).toContain("All purchases must be approved.");
  });

  it("falls back to filename-only listing when extractionStatus is failed", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      contextDocs: [
        { id: "doc-1", filename: "policy.pdf", mimeType: "application/pdf", sizeBytes: 1024, storagePath: "/docs/policy.pdf", extractedText: null, extractionStatus: "failed" as const },
      ],
    });
    expect(result.data).toContain("policy.pdf");
    expect(result.data).not.toContain("<document name=");
  });

  it("applies total budget across multiple complete docs", () => {
    const longText = "x".repeat(50_000);
    const result = agent.buildSystemPrompt({
      ...baseInput,
      contextDocs: [
        { id: "doc-1", filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 1024, storagePath: "/a.pdf", extractedText: longText, extractionStatus: "complete" as const },
        { id: "doc-2", filename: "b.pdf", mimeType: "application/pdf", sizeBytes: 1024, storagePath: "/b.pdf", extractedText: longText, extractionStatus: "complete" as const },
      ],
    });
    const prompt = result.data ?? "";
    const docMatches = [...prompt.matchAll(/<document[^>]*>([\s\S]*?)<\/document>/g)];
    const totalDocContentLength = docMatches.reduce((sum, m) => sum + (m[1] ?? "").trim().length, 0);
    expect(totalDocContentLength).toBeLessThanOrEqual(65_536);
  });

  it("omits <document_template> when outputType is conversation_only", () => {
    const result = agent.buildSystemPrompt(baseInput);
    expect(result.data).not.toContain("<document_template>");
  });

  it("omits <document_template> when documentTemplateContent is null even if outputType is generate_document", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      nodeConfig: {
        ...baseInput.nodeConfig,
        outputType: "generate_document" as const,
        documentTemplateContent: null,
      },
    });
    expect(result.data).not.toContain("<document_template>");
  });

  it("includes <document_template> when outputType is generate_document and template is set", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      nodeConfig: {
        ...baseInput.nodeConfig,
        outputType: "generate_document" as const,
        documentTemplateContent: "# Procurement Brief\n## Item: {{item}}",
      },
    });
    expect(result.data).toContain("<document_template>");
    expect(result.data).toContain("Procurement Brief");
  });

  it("includes <output> section with JSON schema", () => {
    const result = agent.buildSystemPrompt(baseInput);
    expect(result.data).toContain("<output>");
    expect(result.data).toContain("stepCompleteConfidence");
    expect(result.data).toContain("contextGathered");
  });
});

// ── buildBranchChoicePrompt ──────────────────────────────────────────────────

describe("FlowSessionGraph.buildBranchChoicePrompt", () => {
  it("lists all branch nodes", () => {
    const result = agent.buildBranchChoicePrompt({
      branchNodes: [
        { id: "node-a", name: "Standard Route" },
        { id: "node-b", name: "Escalation Route" },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.data).toContain("node-a");
    expect(result.data).toContain("Standard Route");
    expect(result.data).toContain("node-b");
    expect(result.data).toContain("Escalation Route");
  });

  it("includes branchChoice in the output schema description", () => {
    const result = agent.buildBranchChoicePrompt({
      branchNodes: [{ id: "node-a", name: "Route A" }],
    });
    expect(result.data).toContain("branchChoice");
  });
});
