import { describe, expect, it } from "vitest";
import { MessageInfoModal } from "./message-info-modal";

describe("MessageInfoModal", () => {
  it("exports a function component", () => {
    expect(typeof MessageInfoModal).toBe("function");
  });

  it("component name is MessageInfoModal", () => {
    expect(MessageInfoModal.name).toBe("MessageInfoModal");
  });
});
