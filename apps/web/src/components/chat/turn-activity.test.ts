import { describe, expect, it } from "vitest";
import { awaitingFirstText, consultingLabel, describeToolSources, resolveTurnActivityLabel } from "./turn-activity";

describe("describeToolSources", () => {
  it("names one, two or several tool sources the way a person would say them", () => {
    expect(describeToolSources(["ParlView"])).toBe("ParlView");
    expect(describeToolSources(["ParlView", "Hansard"])).toBe("ParlView and Hansard");
    expect(describeToolSources(["ParlView", "Hansard", "APH"])).toBe("ParlView, Hansard and APH");
  });

  it("falls back to a plain phrase when no source is named", () => {
    expect(describeToolSources([])).toBe("tools");
  });
});

describe("consultingLabel", () => {
  it("says which sources are being consulted", () => {
    expect(consultingLabel(["ParlView"])).toBe("Consulting ParlView…");
  });
});

describe("resolveTurnActivityLabel", () => {
  it("reads as thinking until a lookup starts", () => {
    expect(resolveTurnActivityLabel(undefined)).toBe("Thinking…");
    expect(resolveTurnActivityLabel([{ type: "confidence", score: 40 }])).toBe("Thinking…");
  });

  it("names the sources while the lookup runs", () => {
    expect(
      resolveTurnActivityLabel([{ type: "consulting-tools", active: true, sources: ["ParlView"] }]),
    ).toBe("Consulting ParlView…");
  });

  it("goes back to thinking once the lookup has finished", () => {
    expect(
      resolveTurnActivityLabel([
        { type: "consulting-tools", active: true, sources: ["ParlView"] },
        { type: "consulting-tools", active: false, sources: [] },
      ]),
    ).toBe("Thinking…");
  });
});

describe("awaitingFirstText", () => {
  it("waits while the reply has not arrived, or has brought only its status", () => {
    expect(awaitingFirstText(undefined)).toBe(true);
    expect(awaitingFirstText({ role: "user", content: "Look it up" })).toBe(true);
    expect(awaitingFirstText({ role: "assistant", content: "", parts: [] })).toBe(true);
  });

  it("stops once the reply has text", () => {
    expect(awaitingFirstText({ role: "assistant", content: "Here", parts: [{ type: "text", text: "Here" }] })).toBe(false);
  });
});
