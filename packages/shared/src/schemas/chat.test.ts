import { describe, expect, it } from "vitest";
import { streamTurnRequestSchema } from "./chat";

describe("streamTurnRequestSchema", () => {
  it("accepts a well-formed messages array", () => {
    const result = streamTurnRequestSchema.safeParse({
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an omitted messages field (optional)", () => {
    expect(streamTurnRequestSchema.safeParse({}).success).toBe(true);
  });

  it("strips unknown per-message fields the useChat client may attach", () => {
    const result = streamTurnRequestSchema.safeParse({
      messages: [{ role: "user", content: "hi", id: "abc", createdAt: 123 }],
    });
    expect(result.success).toBe(true);
    expect(result.data?.messages?.[0]).toEqual({ role: "user", content: "hi" });
  });

  it("rejects a non-array messages field", () => {
    expect(streamTurnRequestSchema.safeParse({ messages: "nope" }).success).toBe(false);
  });

  it("rejects a message missing content", () => {
    expect(
      streamTurnRequestSchema.safeParse({ messages: [{ role: "user" }] }).success,
    ).toBe(false);
  });
});
