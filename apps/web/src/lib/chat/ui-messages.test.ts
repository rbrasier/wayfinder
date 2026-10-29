import { describe, expect, it } from "vitest";
import { streamTurnMessageSchema } from "@rbrasier/shared";
import { toFeedMessage, toUiMessages, toWireMessages, type ChatUiMessage } from "./ui-messages";

const streamed: ChatUiMessage = {
  id: "m2",
  role: "assistant",
  parts: [
    { type: "step-start" },
    { type: "data-turn-annotation", data: { type: "cross-checking", active: true } },
    { type: "text", text: "The reply." },
    { type: "data-turn-annotation", data: { type: "confidence", score: 72 } },
    { type: "text", text: "A follow-up." },
    { type: "data-turn-annotation", data: { type: "cross-checking", active: false } },
  ],
};

describe("toUiMessages", () => {
  it("rebuilds a persisted message as one text part, with its confidence as an annotation", () => {
    const [message] = toUiMessages([{ id: "m1", role: "assistant", content: "Hi there.", confidence: 80 }]);

    expect(message).toEqual({
      id: "m1",
      role: "assistant",
      parts: [
        { type: "text", text: "Hi there." },
        { type: "data-turn-annotation", data: { type: "confidence", score: 80 } },
      ],
    });
  });

  it("adds no annotation when the message carries no confidence", () => {
    const [message] = toUiMessages([{ id: "m1", role: "user", content: "Hello", confidence: null }]);

    expect(message?.parts).toEqual([{ type: "text", text: "Hello" }]);
  });
});

describe("toFeedMessage", () => {
  // The feed renders one bubble per text part and reads badges from the
  // annotations, in the order the turn wrote them.
  it("keeps the text parts, joins them for content and lists annotations in order", () => {
    expect(toFeedMessage(streamed)).toEqual({
      id: "m2",
      role: "assistant",
      content: "The reply.A follow-up.",
      parts: streamed.parts,
      annotations: [
        { type: "cross-checking", active: true },
        { type: "confidence", score: 72 },
        { type: "cross-checking", active: false },
      ],
    });
  });

  it("round-trips a persisted message into the same feed shape the v4 history had", () => {
    const [message] = toUiMessages([{ id: "m1", role: "assistant", content: "Hi there.", confidence: 80 }]);

    const feed = toFeedMessage(message!);

    expect(feed.content).toBe("Hi there.");
    expect(feed.annotations).toEqual([{ type: "confidence", score: 80 }]);
  });
});

describe("toWireMessages", () => {
  it("sends each message as the role and text the stream route validates", () => {
    const wire = toWireMessages([streamed]);

    expect(wire).toEqual([{ id: "m2", role: "assistant", content: "The reply.A follow-up." }]);
    expect(streamTurnMessageSchema.safeParse(wire[0]).success).toBe(true);
  });
});
