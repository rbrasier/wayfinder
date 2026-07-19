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

  it("addresses a generic colleague when no user profile is provided", () => {
    const result = agent.buildSystemPrompt(baseInput);
    expect(result.data).toContain("helping a colleague complete");
  });

  it("names the user and their role and team when a profile is provided", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      userProfile: { name: "Ada Lovelace", role: "Analyst", team: "Risk" },
    });
    expect(result.data).toContain("helping Ada Lovelace, Analyst on the Risk team complete");
  });

  it("uses the name alone when role and team are absent", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      userProfile: { name: "Ada Lovelace", role: null, team: null },
    });
    expect(result.data).toContain("helping Ada Lovelace complete");
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

  it("omits the current-context block when no `now` is supplied", () => {
    const result = agent.buildSystemPrompt(baseInput);
    expect(result.data).not.toContain("<current_context>");
  });

  it("states the current date/time and how to read relative dates when `now` is supplied", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      now: new Date("2026-07-27T09:30:00.000Z"),
    });
    expect(result.data).toContain("<current_context>");
    expect(result.data).toContain("Mon, 27 Jul 2026 09:30:00 GMT");
    expect(result.data).toContain("next Tuesday");
  });

  it("omits <field_formats> for a conversation-only step", () => {
    const result = agent.buildSystemPrompt(baseInput);
    expect(result.data).not.toContain("<field_formats>");
  });

  it("injects <field_formats> with each field's required format for a document step", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      nodeConfig: {
        ...baseInput.nodeConfig,
        outputType: "generate_document" as const,
        documentTemplateContent: "Email: {{ Employee Email (email) }}",
      },
      templateFields: [
        { key: "employee_email", label: "Employee Email", type: "email", optional: false, raw: "Employee Email (email)" },
        { key: "approval_status", label: "Approval Status", type: "text", options: ["Approved", "Rejected"], optional: true, raw: "Approval Status (options: Approved, Rejected) (optional)" },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.data).toContain("<field_formats>");
    expect(result.data).toContain('"Employee Email" (key: employee_email)');
    expect(result.data).toContain("a valid email address");
    expect(result.data).toContain("exactly one of: Approved, Rejected");
    expect(result.data).toContain("DD-MM-YYYY");
  });

  it("falls back to nodeConfig.documentTemplateFields when templateFields is not supplied", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      nodeConfig: {
        ...baseInput.nodeConfig,
        outputType: "generate_document" as const,
        documentTemplateFields: [
          { key: "contract_value", label: "Contract Value", type: "currency", optional: false, raw: "Contract Value (currency)" },
        ],
      },
    });
    expect(result.data).toContain("<field_formats>");
    expect(result.data).toContain('"Contract Value" (key: contract_value)');
    expect(result.data).toContain("currency");
  });

  it("injects <field_formats> from structuredFields for a structured step, without a document template", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      nodeConfig: {
        ...baseInput.nodeConfig,
        outputType: "structured" as const,
        structuredFields: [
          { key: "decision", label: "Decision", type: "text", options: ["Approve", "Reject"], optional: false, raw: "Decision (options: Approve, Reject)" },
        ],
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.data).toContain("<field_formats>");
    expect(result.data).toContain('"Decision" (key: decision)');
    expect(result.data).toContain("exactly one of: Approve, Reject");
    expect(result.data).not.toContain("<document_template>");
  });

  it("maps a legacy conversation_only step to no field formats", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      nodeConfig: { ...baseInput.nodeConfig, outputType: "conversation_only" as const },
    });
    expect(result.data).not.toContain("<field_formats>");
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

  it("omits <reference_documents> when retrievedChunks is absent or empty", () => {
    expect(agent.buildSystemPrompt(baseInput).data).not.toContain("<reference_documents>");
    expect(
      agent.buildSystemPrompt({ ...baseInput, retrievedChunks: [] }).data,
    ).not.toContain("<reference_documents>");
  });

  it("renders <reference_documents> with a <chunk> tag per retrieved chunk", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      retrievedChunks: [
        {
          filename: "policy.pdf",
          chunkIndex: 3,
          chunkText: "All purchases must be approved.",
          sourceType: "flow_context_doc" as const,
          similarity: 0.82,
        },
        {
          filename: "spec.pdf",
          chunkIndex: 0,
          chunkText: "The widget must be blue.",
          sourceType: "session_upload" as const,
          similarity: 0.71,
        },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.data).toContain("<reference_documents>");
    expect(result.data).toContain('<chunk source="policy.pdf" chunk="3">');
    expect(result.data).toContain("All purchases must be approved.");
    expect(result.data).toContain('<chunk source="spec.pdf" chunk="0">');
    expect(result.data).toContain("The widget must be blue.");
  });

  it("places <reference_documents> after the <output> section so the structural prompt stays cacheable", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      retrievedChunks: [
        {
          filename: "policy.pdf",
          chunkIndex: 0,
          chunkText: "Relevant excerpt.",
          sourceType: "flow_context_doc" as const,
          similarity: 0.9,
        },
      ],
    });
    const prompt = result.data ?? "";
    expect(prompt.indexOf("<output>")).toBeLessThan(prompt.indexOf("<reference_documents>"));
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

  it("omits <global_instructions> when none are set", () => {
    expect(agent.buildSystemPrompt(baseInput).data).not.toContain("<global_instructions>");
    expect(
      agent.buildSystemPrompt({ ...baseInput, globalInstructions: "   " }).data,
    ).not.toContain("<global_instructions>");
  });

  it("renders <global_instructions> when operator guidance is set", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      globalInstructions: "Use Australian English spelling. Be matter-of-fact.",
    });
    expect(result.data).toContain("<global_instructions>");
    expect(result.data).toContain("Australian English spelling");
  });

  it("omits <skills> when no skills are resolved", () => {
    expect(agent.buildSystemPrompt(baseInput).data).not.toContain("<skills>");
    expect(
      agent.buildSystemPrompt({ ...baseInput, resolvedSkills: [] }).data,
    ).not.toContain("<skills>");
  });

  it("renders each resolved skill in a <skills> block, above reference documents", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      resolvedSkills: [
        { name: "Contract Reviewer", body: "Flag unusual indemnity clauses." },
        { name: "Tone", body: "Be concise." },
      ],
    });
    expect(result.data).toContain("<skills>");
    expect(result.data).toContain('<skill name="Contract Reviewer">');
    expect(result.data).toContain("Flag unusual indemnity clauses.");
    expect(result.data).toContain('<skill name="Tone">');
    // Skills sit in the stable region, before the per-turn instructions block.
    const skillsIndex = result.data?.indexOf("<skills>") ?? -1;
    const instructionsIndex = result.data?.indexOf("<instructions>") ?? -1;
    expect(skillsIndex).toBeGreaterThanOrEqual(0);
    expect(skillsIndex).toBeLessThan(instructionsIndex);
  });

  it("omits <attached_documents> when there are no session uploads", () => {
    expect(agent.buildSystemPrompt(baseInput).data).not.toContain("<attached_documents>");
    expect(
      agent.buildSystemPrompt({ ...baseInput, sessionUploads: [] }).data,
    ).not.toContain("<attached_documents>");
  });

  it("injects attached session uploads framed as documents the user provided", () => {
    const result = agent.buildSystemPrompt({
      ...baseInput,
      sessionUploads: [
        { filename: "Dave.docx", extractedText: "Please buy Office 365 licences, about $99 each." },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.data).toContain("<attached_documents>");
    expect(result.data).toContain("Dave.docx");
    expect(result.data).toContain("Office 365 licences");
    // It must read as the user's own attachment, not a generic reference excerpt.
    expect(result.data?.toLowerCase()).toContain("the user has attached");
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

  it("includes each branch's purpose when provided", () => {
    const result = agent.buildBranchChoicePrompt({
      branchNodes: [
        { id: "node-a", name: "Standard Route", purpose: "The request is within the approval limit" },
        { id: "node-b", name: "Escalation Route", purpose: "The request exceeds the approval limit" },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.data).toContain("The request is within the approval limit");
    expect(result.data).toContain("The request exceeds the approval limit");
  });

  it("remains well-formed when a branch has no purpose", () => {
    const result = agent.buildBranchChoicePrompt({
      branchNodes: [
        { id: "node-a", name: "Standard Route" },
        { id: "node-b", name: "Escalation Route", purpose: "The request exceeds the approval limit" },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.data).toContain("node-a");
    expect(result.data).toContain("Standard Route");
    expect(result.data).toContain("The request exceeds the approval limit");
    expect(result.data).not.toContain("undefined");
  });
});
