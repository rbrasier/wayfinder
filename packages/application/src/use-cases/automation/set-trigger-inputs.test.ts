import { describe, expect, it } from "vitest";
import { ok, type Flow, type FlowUpdate } from "@rbrasier/domain";
import { SetTriggerInputs } from "./set-trigger-inputs";

const build = () => {
  const updates: FlowUpdate[] = [];
  const useCase = new SetTriggerInputs({
    update: async (_id, patch) => {
      updates.push(patch);
      return ok({ id: "flow-1", ...patch } as Flow);
    },
  });
  return { useCase, updates };
};

describe("SetTriggerInputs", () => {
  it("saves a valid set of inputs on the flow's draft", async () => {
    const { useCase, updates } = build();
    const inputs = [{ key: "hearing_id", label: "Hearing", type: "text" as const, required: true }];

    const result = await useCase.execute({ flowId: "flow-1", inputs });

    expect(result.error).toBeUndefined();
    expect(updates).toEqual([{ triggerInputs: inputs }]);
  });

  it("rejects an invalid set with every problem named, and saves nothing", async () => {
    const { useCase, updates } = build();

    const result = await useCase.execute({
      flowId: "flow-1",
      inputs: [{ key: "Bad Key", label: "", type: "text", required: false }],
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("Bad Key must start with a letter");
    expect(updates).toEqual([]);
  });
});
