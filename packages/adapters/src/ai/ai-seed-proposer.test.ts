import { describe, expect, it, vi } from "vitest";
import {
  domainError,
  err,
  ok,
  type GenerateObjectInput,
  type ILanguageModel,
  type Result,
  type SeedProposalRequest,
  type TemplateField,
  type TokenUsage,
} from "@wayfinder/domain";
import { AiSeedProposer } from "./ai-seed-proposer";

const usage: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const stubModel = (
  generate: (input: GenerateObjectInput) => Promise<Result<{ object: unknown; usage: TokenUsage }>>,
): ILanguageModel =>
  ({
    provider: "openai",
    generateObject: vi.fn(generate),
    generateText: vi.fn(),
    streamText: vi.fn(),
    streamObject: vi.fn(),
  }) as unknown as ILanguageModel;

const field = (key: string, label: string): TemplateField => ({
  key,
  label,
  type: "text",
  optional: false,
  raw: label,
});

const request: SeedProposalRequest = {
  flowName: "Procurement Request",
  nodes: [
    {
      nodeId: "node-1",
      nodeName: "Gather requirements",
      aiInstruction: "Find out what they need.",
      fields: [field("supplier", "Supplier"), field("budget", "Budget")],
    },
  ],
};

describe("AiSeedProposer", () => {
  it("maps the model's proposal onto the seed shape", async () => {
    const model = stubModel(async () =>
      ok({
        object: {
          nodes: [
            {
              nodeId: "node-1",
              gatheredContext: [{ key: "urgency", value: "High" }],
              fields: [
                { key: "supplier", value: "Acme Ltd" },
                { key: "budget", value: "50000" },
              ],
            },
          ],
        },
        usage,
      }),
    );

    const result = await new AiSeedProposer(model).propose(request);

    expect(result.data?.gatheredContext).toEqual([
      { nodeId: "node-1", key: "urgency", value: "High" },
    ]);
    expect(result.data?.stepOutputs).toEqual([
      {
        nodeId: "node-1",
        fields: [
          { key: "supplier", label: "Supplier", type: "text", value: "Acme Ltd" },
          { key: "budget", label: "Budget", type: "text", value: "50000" },
        ],
      },
    ]);
  });

  it("drops a field key the model invented", async () => {
    const model = stubModel(async () =>
      ok({
        object: {
          nodes: [
            {
              nodeId: "node-1",
              gatheredContext: [],
              fields: [
                { key: "supplier", value: "Acme Ltd" },
                { key: "hallucinated", value: "nonsense" },
              ],
            },
          ],
        },
        usage,
      }),
    );

    const result = await new AiSeedProposer(model).propose(request);

    expect(result.data?.stepOutputs[0]?.fields.map((entry) => entry.key)).toEqual(["supplier"]);
  });

  it("drops a node the model invented", async () => {
    const model = stubModel(async () =>
      ok({
        object: {
          nodes: [
            { nodeId: "node-elsewhere", gatheredContext: [{ key: "x", value: "y" }], fields: [] },
          ],
        },
        usage,
      }),
    );

    const result = await new AiSeedProposer(model).propose(request);

    expect(result.data?.gatheredContext).toEqual([]);
    expect(result.data?.stepOutputs).toEqual([]);
  });

  it("takes the label and type from the declared field, never from the model", async () => {
    const model = stubModel(async () =>
      ok({
        object: {
          nodes: [
            {
              nodeId: "node-1",
              gatheredContext: [],
              fields: [{ key: "supplier", value: "Acme Ltd" }],
            },
          ],
        },
        usage,
      }),
    );

    const result = await new AiSeedProposer(model).propose(request);

    expect(result.data?.stepOutputs[0]?.fields[0]?.label).toBe("Supplier");
    expect(result.data?.stepOutputs[0]?.fields[0]?.type).toBe("text");
  });

  it("records the test-seed purpose so the spend is attributable", async () => {
    let seen: GenerateObjectInput | null = null;
    const model = stubModel(async (input) => {
      seen = input;
      return ok({ object: { nodes: [] }, usage });
    });

    await new AiSeedProposer(model).propose(request);

    expect(seen!.purpose).toBe("test-seed");
  });

  it("tells the model what each step is for, so values are coherent rather than merely typed", async () => {
    let seen: GenerateObjectInput | null = null;
    const model = stubModel(async (input) => {
      seen = input;
      return ok({ object: { nodes: [] }, usage });
    });

    await new AiSeedProposer(model).propose(request);

    expect(seen!.prompt).toContain("Find out what they need.");
    expect(seen!.prompt).toContain("Procurement Request");
  });

  it("returns a provider failure as a Result rather than throwing", async () => {
    const model = stubModel(async () =>
      err(domainError("AI_PROVIDER_FAILED", "The model is unavailable.")),
    );

    const result = await new AiSeedProposer(model).propose(request);

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });

  it("survives a malformed proposal without throwing", async () => {
    const model = stubModel(async () => ok({ object: { nodes: "not an array" }, usage }));

    const result = await new AiSeedProposer(model).propose(request);

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ gatheredContext: [], stepOutputs: [] });
  });

  it("skips a step whose fields were all dropped rather than proposing an empty one", async () => {
    const model = stubModel(async () =>
      ok({
        object: {
          nodes: [
            { nodeId: "node-1", gatheredContext: [], fields: [{ key: "ghost", value: "x" }] },
          ],
        },
        usage,
      }),
    );

    const result = await new AiSeedProposer(model).propose(request);

    expect(result.data?.stepOutputs).toEqual([]);
  });
});
