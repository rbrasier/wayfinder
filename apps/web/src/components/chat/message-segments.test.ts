import { describe, expect, it } from "vitest";
import { messageTextSegments } from "./message-segments";

// Regression for the cross-check "message replacement": the fail path streams
// a corrective follow-up (and the pass path a cross-check note) into the same
// streamed assistant message behind a finish_step boundary. Each text part must
// render as its own bubble so the streamed view matches the persisted messages
// exactly and nothing appears rewritten when the views swap.
describe("messageTextSegments", () => {
  it("splits a streamed message into one segment per text part", () => {
    const segments = messageTextSegments({
      content: "All set — submitting.Actually, two details are still missing.",
      parts: [
        { type: "text", text: "All set — submitting." },
        { type: "step-start" },
        { type: "text", text: "Actually, two details are still missing." },
      ],
    });

    expect(segments).toEqual([
      "All set — submitting.",
      "Actually, two details are still missing.",
    ]);
  });

  it("falls back to the whole content when the message carries no parts", () => {
    expect(messageTextSegments({ content: "hello" })).toEqual(["hello"]);
    expect(messageTextSegments({ content: "hello", parts: [] })).toEqual(["hello"]);
  });

  it("ignores non-text parts and empty text parts", () => {
    const segments = messageTextSegments({
      content: "only",
      parts: [
        { type: "step-start" },
        { type: "text", text: "" },
        { type: "text", text: "only" },
      ],
    });

    expect(segments).toEqual(["only"]);
  });

  it("falls back to content when every text part is empty", () => {
    expect(messageTextSegments({ content: "", parts: [{ type: "text", text: "" }] })).toEqual([""]);
  });
});
