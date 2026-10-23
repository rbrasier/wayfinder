import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import { followRenameOnCanvas } from "./follow-rename";

const node = (id: string, type: string, name: string, config: Record<string, unknown> = {}): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { name, config },
});

describe("followRenameOnCanvas", () => {
  it("rewrites the tags of an Email step on the canvas when a step it uses is renamed", () => {
    const nodes = [
      node("a", "aiTaskNode", "Summarise the hearing"),
      node("e", "emailNode", "Email the digest", {
        subjectTemplate: "Hearing summary",
        bodyTemplate: "{{ summarise_the_hearing.summary }}",
      }),
    ];

    const followed = followRenameOnCanvas(nodes, "a", "Review the hearing");

    expect((followed[1]!.data as { config: Record<string, unknown> }).config.bodyTemplate).toBe(
      "{{ review_the_hearing.summary }}",
    );
    expect(followed[0]).toBe(nodes[0]);
  });

  it("returns the canvas unchanged when no Email step uses the renamed step", () => {
    const nodes = [node("a", "conversationalNode", "Intake"), node("e", "emailNode", "Email", { bodyTemplate: "Hi" })];

    expect(followRenameOnCanvas(nodes, "a", "Triage")).toBe(nodes);
  });
});
