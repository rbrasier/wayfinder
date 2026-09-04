import { describe, it, expect } from "vitest";
import {
  EXPLAINER_CARDS,
  isLastCard,
  nextCardIndex,
  previousCardIndex,
} from "./flow-explainer-cards";

describe("EXPLAINER_CARDS", () => {
  it("tells the story in the agreed order: conversation, steps, done-when, template, rules, publish", () => {
    expect(EXPLAINER_CARDS.map((card) => card.id)).toEqual([
      "conversation",
      "steps",
      "done-when",
      "template",
      "rules",
      "publish",
    ]);
  });

  it("gives every card a title and a body a non-technical reader can act on", () => {
    for (const card of EXPLAINER_CARDS) {
      expect(card.title.length).toBeGreaterThan(8);
      expect(card.body.length).toBeGreaterThan(40);
    }
  });

  it("shows the template placeholder syntax exactly as the annotator accepts it", () => {
    const template = EXPLAINER_CARDS.find((card) => card.id === "template");
    expect(template?.body).toContain("{{ Field Name (annotation) }}");
  });
});

describe("carousel navigation", () => {
  const last = EXPLAINER_CARDS.length - 1;

  it("steps forward one card at a time and stops at the last card", () => {
    expect(nextCardIndex(0)).toBe(1);
    expect(nextCardIndex(last)).toBe(last);
  });

  it("steps back one card at a time and stops at the first card", () => {
    expect(previousCardIndex(3)).toBe(2);
    expect(previousCardIndex(0)).toBe(0);
  });

  it("knows which card carries the hand-off call to action", () => {
    expect(isLastCard(last)).toBe(true);
    expect(isLastCard(0)).toBe(false);
  });
});
