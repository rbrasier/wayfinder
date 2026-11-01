import { describe, expect, it } from "vitest";
import type { FlowNode } from "./flow-node";
import type { FlowTestSeed } from "./flow-test-fixture";
import { nodesPrecedingNode, validateSeedAgainstNodes } from "./flow-test-seed";

const node = (id: string, fields: Record<string, unknown>[]): FlowNode => ({
  id,
  flowId: "flow-1",
  type: "conversational",
  name: `Step ${id}`,
  colour: null,
  positionX: 0,
  positionY: 0,
  config: { outputType: "structured", structuredFields: fields },
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const textField = (key: string, label: string) => ({
  key,
  label,
  type: "text",
  optional: false,
  raw: label,
});

const emailField = (key: string, label: string) => ({
  key,
  label,
  type: "email",
  optional: false,
  raw: `${label} (email)`,
});

const yesNoField = (key: string, label: string) => ({
  key,
  label,
  type: "yesno",
  optional: false,
  raw: `${label} (yesno)`,
});

const seedWith = (seed: Partial<FlowTestSeed>): FlowTestSeed => ({
  gatheredContext: [],
  stepOutputs: [],
  ...seed,
});

describe("validateSeedAgainstNodes", () => {
  it("accepts a seed whose values match each node's declared field types", () => {
    const nodes = [node("node-1", [textField("supplier", "Supplier"), emailField("contact", "Contact")])];
    const seed = seedWith({
      gatheredContext: [{ nodeId: "node-1", key: "budget", value: "50000" }],
      stepOutputs: [
        {
          nodeId: "node-1",
          fields: [
            { key: "supplier", label: "Supplier", type: "text", value: "Acme Ltd" },
            { key: "contact", label: "Contact", type: "email", value: "buyer@acme.example" },
          ],
        },
      ],
    });

    const result = validateSeedAgainstNodes(seed, nodes);

    expect(result.rejects).toEqual([]);
    expect(result.accepted.stepOutputs[0]?.fields).toHaveLength(2);
    expect(result.accepted.gatheredContext).toHaveLength(1);
  });

  it("returns a value that violates its field type as a reject, and does not keep it", () => {
    const nodes = [node("node-1", [emailField("contact", "Contact")])];
    const seed = seedWith({
      stepOutputs: [
        {
          nodeId: "node-1",
          fields: [{ key: "contact", label: "Contact", type: "email", value: "not-an-email" }],
        },
      ],
    });

    const result = validateSeedAgainstNodes(seed, nodes);

    expect(result.rejects).toHaveLength(1);
    expect(result.rejects[0]?.key).toBe("contact");
    expect(result.rejects[0]?.reason).toContain("valid email address");
    expect(result.accepted.stepOutputs).toEqual([]);
  });

  it("canonicalises an accepted value rather than passing it through verbatim", () => {
    const nodes = [node("node-1", [yesNoField("urgent", "Urgent")])];
    const seed = seedWith({
      stepOutputs: [
        {
          nodeId: "node-1",
          fields: [{ key: "urgent", label: "Urgent", type: "yesno", value: "yes" }],
        },
      ],
    });

    const result = validateSeedAgainstNodes(seed, nodes);

    expect(result.rejects).toEqual([]);
    expect(result.accepted.stepOutputs[0]?.fields[0]?.value).toBe("Yes");
  });

  it("rejects a step output for a node absent from the draft", () => {
    const nodes = [node("node-1", [textField("supplier", "Supplier")])];
    const seed = seedWith({
      stepOutputs: [
        {
          nodeId: "node-missing",
          fields: [{ key: "supplier", label: "Supplier", type: "text", value: "Acme Ltd" }],
        },
      ],
    });

    const result = validateSeedAgainstNodes(seed, nodes);

    expect(result.rejects).toHaveLength(1);
    expect(result.rejects[0]?.nodeId).toBe("node-missing");
    expect(result.rejects[0]?.reason).toContain("no longer in this flow");
    expect(result.accepted.stepOutputs).toEqual([]);
  });

  it("rejects a gathered-context item for a node absent from the draft", () => {
    const nodes = [node("node-1", [textField("supplier", "Supplier")])];
    const seed = seedWith({
      gatheredContext: [{ nodeId: "node-missing", key: "budget", value: "50000" }],
    });

    const result = validateSeedAgainstNodes(seed, nodes);

    expect(result.rejects).toHaveLength(1);
    expect(result.accepted.gatheredContext).toEqual([]);
  });

  it("rejects a field key the node does not declare", () => {
    const nodes = [node("node-1", [textField("supplier", "Supplier")])];
    const seed = seedWith({
      stepOutputs: [
        {
          nodeId: "node-1",
          fields: [
            { key: "supplier", label: "Supplier", type: "text", value: "Acme Ltd" },
            { key: "invented", label: "Invented", type: "text", value: "anything" },
          ],
        },
      ],
    });

    const result = validateSeedAgainstNodes(seed, nodes);

    expect(result.rejects).toHaveLength(1);
    expect(result.rejects[0]?.key).toBe("invented");
    expect(result.rejects[0]?.reason).toContain("does not declare");
    expect(result.accepted.stepOutputs[0]?.fields).toHaveLength(1);
  });

  it("keeps the valid fields of a node whose other fields were rejected", () => {
    const nodes = [node("node-1", [textField("supplier", "Supplier"), emailField("contact", "Contact")])];
    const seed = seedWith({
      stepOutputs: [
        {
          nodeId: "node-1",
          fields: [
            { key: "supplier", label: "Supplier", type: "text", value: "Acme Ltd" },
            { key: "contact", label: "Contact", type: "email", value: "nope" },
          ],
        },
      ],
    });

    const result = validateSeedAgainstNodes(seed, nodes);

    expect(result.rejects).toHaveLength(1);
    expect(result.accepted.stepOutputs[0]?.fields).toHaveLength(1);
    expect(result.accepted.stepOutputs[0]?.fields[0]?.key).toBe("supplier");
  });

  it("rejects a gathered-context item with a blank key", () => {
    const nodes = [node("node-1", [textField("supplier", "Supplier")])];
    const seed = seedWith({
      gatheredContext: [{ nodeId: "node-1", key: "   ", value: "50000" }],
    });

    const result = validateSeedAgainstNodes(seed, nodes);

    expect(result.rejects).toHaveLength(1);
    expect(result.rejects[0]?.reason).toContain("blank key");
    expect(result.accepted.gatheredContext).toEqual([]);
  });

  it("treats an empty seed as valid, which is how a whole-flow run starts", () => {
    const nodes = [node("node-1", [textField("supplier", "Supplier")])];

    const result = validateSeedAgainstNodes(seedWith({}), nodes);

    expect(result.rejects).toEqual([]);
    expect(result.accepted.gatheredContext).toEqual([]);
    expect(result.accepted.stepOutputs).toEqual([]);
  });

  it("drops a node whose every field was rejected rather than writing an empty step output", () => {
    const nodes = [node("node-1", [emailField("contact", "Contact")])];
    const seed = seedWith({
      stepOutputs: [
        {
          nodeId: "node-1",
          fields: [{ key: "contact", label: "Contact", type: "email", value: "nope" }],
        },
      ],
    });

    const result = validateSeedAgainstNodes(seed, nodes);

    expect(result.accepted.stepOutputs).toEqual([]);
  });
});

describe("nodesPrecedingNode", () => {
  const edge = (fromNodeId: string, toNodeId: string) => ({ fromNodeId, toNodeId });

  it("returns the whole chain leading to the target", () => {
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "d")];

    expect(nodesPrecedingNode(edges, "d").sort()).toEqual(["a", "b", "c"]);
  });

  it("excludes the target itself", () => {
    expect(nodesPrecedingNode([edge("a", "b")], "b")).not.toContain("b");
  });

  it("returns nothing for the root", () => {
    expect(nodesPrecedingNode([edge("a", "b")], "a")).toEqual([]);
  });

  it("excludes branches that do not reach the target", () => {
    // a splits to b and c; only b leads to d.
    const edges = [edge("a", "b"), edge("a", "c"), edge("b", "d")];

    expect(nodesPrecedingNode(edges, "d").sort()).toEqual(["a", "b"]);
  });

  it("gathers both arms of a join", () => {
    const edges = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")];

    expect(nodesPrecedingNode(edges, "d").sort()).toEqual(["a", "b", "c"]);
  });

  it("terminates on a flow that loops back on itself", () => {
    // An approval at "c" can send work back to "b" (ADR-044), so the graph
    // legitimately contains a cycle.
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "b"), edge("c", "d")];

    expect(nodesPrecedingNode(edges, "d").sort()).toEqual(["a", "b", "c"]);
  });

  it("returns nothing when the target is not in the graph", () => {
    expect(nodesPrecedingNode([edge("a", "b")], "elsewhere")).toEqual([]);
  });
});
