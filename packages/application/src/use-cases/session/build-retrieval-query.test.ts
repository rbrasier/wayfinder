import { describe, it, expect } from "vitest";
import type { ConversationalNodeConfig } from "@wayfinder/domain";
import { buildTurnRetrievalQueries } from "./build-retrieval-query";

// The reported flow: a step that captures a new hire's name and start date,
// against a policy document whose start-date clause never appears in what the
// operator types.
const onboardingStep: ConversationalNodeConfig = {
  aiInstruction: "Capture the new employee's full name and their start date.",
  doneWhen: "The full name and a confirmed start date have been captured.",
  outputType: "generate_document",
  documentTemplateFields: [
    { key: "employee_name", label: "Employee name", type: "text", optional: false, raw: "" },
    { key: "start_date", label: "Start date", type: "date", optional: false, raw: "" },
  ],
};

describe("buildTurnRetrievalQueries", () => {
  it("derives a step query from the node alone, with no user message at all", () => {
    // The opening turn of a session: nothing has been said yet. Today this path
    // retrieves against an empty string and returns nothing, so the first thing
    // the assistant says is ungrounded.
    const queries = buildTurnRetrievalQueries({
      nodeConfig: onboardingStep,
      recentMessages: [],
      latestUserMessage: "",
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("start date");
    expect(queries[0]).toContain("Start date");
    expect(queries[0]).toContain("Employee name");
  });

  it("carries the conversation tail into the message query", () => {
    // "Joe Bloggs, are there any options for a start date?" is nearly
    // contentless on its own. The assistant turn before it supplies the subject
    // that makes it retrievable.
    const queries = buildTurnRetrievalQueries({
      nodeConfig: onboardingStep,
      recentMessages: [
        {
          role: "assistant",
          content: "Could you please provide the new employee's full name and their start date?",
        },
        { role: "user", content: "Joe Bloggs, are there any options for a start date?" },
      ],
      latestUserMessage: "Joe Bloggs, are there any options for a start date?",
    });

    const messageQuery = queries[0]!;
    expect(messageQuery).toContain("Joe Bloggs, are there any options for a start date?");
    expect(messageQuery).toContain("full name and their start date");
  });

  it("returns the message query first and the step query second", () => {
    const queries = buildTurnRetrievalQueries({
      nodeConfig: onboardingStep,
      recentMessages: [{ role: "user", content: "What about the start date?" }],
      latestUserMessage: "What about the start date?",
    });

    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain("What about the start date?");
    expect(queries[1]).toContain("Capture the new employee's full name");
  });

  it("never puts the template-complete sentinel in a query", () => {
    // `__TEMPLATE_COMPLETE__` is a marker, not guidance. Embedding it would
    // spend a call on a token that means nothing to a policy document.
    const queries = buildTurnRetrievalQueries({
      nodeConfig: {
        aiInstruction: "Fill in the offer letter.",
        doneWhen: "__TEMPLATE_COMPLETE__",
        outputType: "generate_document",
      },
      recentMessages: [],
      latestUserMessage: "",
    });

    expect(queries.join(" ")).not.toContain("__TEMPLATE_COMPLETE__");
    expect(queries[0]).toContain("Fill in the offer letter.");
  });

  it("returns no queries when neither the step nor the conversation says anything", () => {
    const queries = buildTurnRetrievalQueries({
      nodeConfig: {},
      recentMessages: [],
      latestUserMessage: "   ",
    });

    expect(queries).toEqual([]);
  });

  it("de-duplicates when the step and message queries coincide", () => {
    // A one-line step whose instruction the operator has echoed verbatim must
    // not cost two identical embedding calls.
    const nodeConfig: ConversationalNodeConfig = { aiInstruction: "Confirm the start date." };
    const queries = buildTurnRetrievalQueries({
      nodeConfig,
      recentMessages: [{ role: "user", content: "Confirm the start date." }],
      latestUserMessage: "Confirm the start date.",
    });

    expect(queries).toEqual(["Confirm the start date."]);
  });

  it("bounds the conversation tail so a long chat cannot dominate the query", () => {
    const recentMessages = Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `Turn ${index} — ${"filler ".repeat(80)}`,
    }));

    const queries = buildTurnRetrievalQueries({
      nodeConfig: onboardingStep,
      recentMessages,
      latestUserMessage: "Turn 39 content",
    });

    const messageQuery = queries[0]!;
    expect(messageQuery.length).toBeLessThanOrEqual(2000);
    // The newest turns survive the trim; the oldest do not.
    expect(messageQuery).toContain("Turn 39 content");
    expect(messageQuery).not.toContain("Turn 0 —");
  });

  it("ignores system rows in the tail", () => {
    // Cross-check notes and scheduling notices are the system talking about the
    // conversation, not content of it.
    const queries = buildTurnRetrievalQueries({
      nodeConfig: {},
      recentMessages: [
        { role: "system", content: "Cross-check complete — everything is in alignment." },
        { role: "user", content: "Understood." },
      ],
      latestUserMessage: "Understood.",
    });

    expect(queries.join(" ")).not.toContain("Cross-check complete");
    expect(queries[0]).toContain("Understood.");
  });

  it("includes structured field labels for a structured step", () => {
    const queries = buildTurnRetrievalQueries({
      nodeConfig: {
        outputType: "structured",
        structuredFields: [
          { key: "notice_period", label: "Notice period", type: "text", optional: false, raw: "" },
        ],
      },
      recentMessages: [],
      latestUserMessage: "",
    });

    expect(queries[0]).toContain("Notice period");
  });
});
