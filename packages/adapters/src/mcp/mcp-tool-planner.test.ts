import { describe, expect, it } from "vitest";
import { firstProposedCall } from "./mcp-tool-planner";

describe("firstProposedCall", () => {
  it("returns the model's first proposed tool call", () => {
    const call = firstProposedCall([
      { toolName: "create_ticket", args: { title: "Broken login" } },
      { toolName: "ignored", args: {} },
    ]);
    expect(call).toEqual({ toolName: "create_ticket", args: { title: "Broken login" } });
  });

  it("defaults missing args to an empty object", () => {
    const call = firstProposedCall([{ toolName: "ping", args: undefined }]);
    expect(call).toEqual({ toolName: "ping", args: {} });
  });

  it("returns null when the model declined to call a tool", () => {
    expect(firstProposedCall([])).toBeNull();
  });
});
