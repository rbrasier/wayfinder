import { describe, expect, it } from "vitest";
import { renderSkillsBlock } from "./skill";

describe("renderSkillsBlock", () => {
  it("renders applied skills as one tagged block, in order", () => {
    expect(
      renderSkillsBlock([
        { name: "Plain English", body: " Write simply. " },
        { name: "Citations", body: "Cite the page." },
      ]),
    ).toBe(
      '\n\n<skills>\n  <skill name="Plain English">\n    Write simply.\n  </skill>\n  <skill name="Citations">\n    Cite the page.\n  </skill>\n</skills>',
    );
  });

  it("renders nothing when no skill applies", () => {
    expect(renderSkillsBlock([])).toBe("");
  });
});
