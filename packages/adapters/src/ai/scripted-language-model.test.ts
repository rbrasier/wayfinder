import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ScriptedLanguageModel, defaultForSchema } from "./scripted-language-model";

const turnSchema = z.object({
  response: z.string(),
  rationale: z.string(),
  stepCompleteConfidence: z.number().int().min(0).max(100),
  contextGathered: z.array(z.object({ key: z.string(), value: z.string() })),
});

const collect = async <T>(stream: AsyncIterable<T>): Promise<T[]> => {
  const seen: T[] = [];
  for await (const chunk of stream) seen.push(chunk);
  return seen;
};

describe("defaultForSchema", () => {
  it("builds a value the schema accepts, without being told the shape", () => {
    const value = defaultForSchema(turnSchema);

    expect(() => turnSchema.parse(value)).not.toThrow();
  });

  it("puts a number inside its declared range rather than at zero", () => {
    // The doc-gen and fork gates compare confidences against thresholds, so a
    // default pinned to the floor would silently park every gated session.
    const schema = z.object({ confidence: z.number().int().min(40).max(100) });

    const value = defaultForSchema(schema) as { confidence: number };

    expect(value.confidence).toBeGreaterThanOrEqual(40);
    expect(value.confidence).toBeLessThanOrEqual(100);
  });

  it("picks a declared member for an enum", () => {
    const schema = z.object({ verdict: z.enum(["pass", "fail"]) });

    const value = defaultForSchema(schema) as { verdict: string };

    expect(["pass", "fail"]).toContain(value.verdict);
  });

  it("omits optionals and nulls nullables, so nothing is invented", () => {
    const schema = z.object({
      required: z.string(),
      maybe: z.string().optional(),
      nullable: z.string().nullable(),
    });

    const value = defaultForSchema(schema) as Record<string, unknown>;

    expect(value).not.toHaveProperty("maybe");
    expect(value.nullable).toBeNull();
    expect(() => schema.parse(value)).not.toThrow();
  });

  it("returns an empty array rather than inventing elements", () => {
    const value = defaultForSchema(z.object({ items: z.array(z.string()) })) as {
      items: unknown[];
    };

    expect(value.items).toEqual([]);
  });
});

describe("defaultForSchema with transforms", () => {
  it("defaults the schema underneath a transform, not the transform itself", () => {
    const schema = z.object({ confidence: z.number().min(0).max(100).transform((value) => Math.round(value)) });

    expect(defaultForSchema(schema)).toEqual({ confidence: 75 });
  });
});

describe("ScriptedLanguageModel", () => {
  it("runs an unscripted default through the schema, as a provider's answer would be", async () => {
    const model = new ScriptedLanguageModel();
    const schema = z.object({ confidence: z.number().transform((value) => value * 2) });

    const result = await model.generateObject({ purpose: "aiTask", sessionId: "session-1", schema });

    expect(result.data?.object).toEqual({ confidence: 2 });
  });

  const baseCall = {
    purpose: "chat",
    sessionId: "session-1",
    schema: turnSchema,
  };

  it("returns a schema-shaped default when nothing is scripted", async () => {
    const model = new ScriptedLanguageModel();

    const result = await model.generateObject(baseCall);

    expect(result.error).toBeUndefined();
    expect(() => turnSchema.parse(result.data?.object)).not.toThrow();
  });

  it("returns the scripted object for the session it was scripted against", async () => {
    const model = new ScriptedLanguageModel();
    model.script("session-1", [
      {
        object: {
          response: "Scripted reply",
          rationale: "because the spec says so",
          stepCompleteConfidence: 91,
          contextGathered: [],
        },
      },
    ]);

    const result = await model.generateObject(baseCall);

    expect(result.data?.object).toMatchObject({
      response: "Scripted reply",
      stepCompleteConfidence: 91,
    });
  });

  it("leaves other sessions on the default, so specs do not leak into each other", async () => {
    const model = new ScriptedLanguageModel();
    model.script("session-1", [{ object: { response: "Only for session 1" } }]);

    const result = await model.generateObject({ ...baseCall, sessionId: "session-2" });

    expect(result.data?.object).not.toMatchObject({ response: "Only for session 1" });
  });

  it("consumes entries in order and repeats the last one", async () => {
    const model = new ScriptedLanguageModel();
    model.script("session-1", [
      { object: { response: "first", rationale: "", stepCompleteConfidence: 10, contextGathered: [] } },
      { object: { response: "second", rationale: "", stepCompleteConfidence: 90, contextGathered: [] } },
    ]);

    const first = await model.generateObject(baseCall);
    const second = await model.generateObject(baseCall);
    const third = await model.generateObject(baseCall);

    expect(first.data?.object).toMatchObject({ response: "first" });
    expect(second.data?.object).toMatchObject({ response: "second" });
    // Repeating beats running dry: a spec that scripts two turns should not
    // have a third, incidental call fall back to a default that contradicts them.
    expect(third.data?.object).toMatchObject({ response: "second" });
  });

  it("only matches a purpose-scoped entry against that purpose", async () => {
    const model = new ScriptedLanguageModel();
    model.script("session-1", [
      { purpose: "branching", object: { rationale: "chosen", branchChoice: "node-b" } },
    ]);

    const branching = await model.generateObject({
      purpose: "branching",
      sessionId: "session-1",
      schema: z.object({ rationale: z.string(), branchChoice: z.string() }),
    });
    const chat = await model.generateObject(baseCall);

    expect(branching.data?.object).toMatchObject({ branchChoice: "node-b" });
    expect(chat.data?.object).not.toMatchObject({ branchChoice: "node-b" });
  });

  it("fails as a Result rather than throwing when the script asks it to", async () => {
    const model = new ScriptedLanguageModel();
    model.script("session-1", [{ failWith: "provider exploded" }]);

    const result = await model.generateObject(baseCall);

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
    expect(result.error?.message).toContain("provider exploded");
  });

  it("rejects a scripted object the schema will not accept, naming the purpose", async () => {
    const model = new ScriptedLanguageModel();
    // stepCompleteConfidence is capped at 100 — a script that misses this would
    // otherwise surface as an opaque failure deep in the turn pipeline.
    model.script("session-1", [
      {
        object: {
          response: "over the cap",
          rationale: "",
          stepCompleteConfidence: 250,
          contextGathered: [],
        },
      },
    ]);

    const result = await model.generateObject(baseCall);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("chat");
  });

  it("forgets a session's script when it is cleared", async () => {
    const model = new ScriptedLanguageModel();
    model.script("session-1", [{ object: { response: "scripted" } }]);
    model.clear("session-1");

    const result = await model.generateObject(baseCall);

    expect(result.data?.object).not.toMatchObject({ response: "scripted" });
  });

  describe("streamObject", () => {
    it("streams the response in growing prefixes and resolves the whole object", async () => {
      const model = new ScriptedLanguageModel();
      model.script("session-1", [
        {
          object: {
            response: "A reply long enough to arrive in several chunks.",
            rationale: "streamed",
            stepCompleteConfidence: 55,
            contextGathered: [],
          },
        },
      ]);

      const result = await model.streamObject<z.infer<typeof turnSchema>>(baseCall);
      expect(result.error).toBeUndefined();

      const partials = await collect(result.data!.partialObjectStream);
      const responses = partials.map((p) => (p as { response?: string }).response ?? "");

      expect(responses.length).toBeGreaterThan(1);
      // stream-turn.ts writes only the characters beyond the previous partial,
      // so each partial must extend the one before it.
      for (let index = 1; index < responses.length; index += 1) {
        expect(responses[index].startsWith(responses[index - 1])).toBe(true);
      }
      expect(responses.at(-1)).toBe("A reply long enough to arrive in several chunks.");
      await expect(result.data!.object).resolves.toMatchObject({ stepCompleteConfidence: 55 });
    });

    it("reports a scripted failure through onError, the way a real stream does", async () => {
      const model = new ScriptedLanguageModel();
      model.script("session-1", [{ failWith: "stream died" }]);
      let reported: unknown = null;

      const result = await model.streamObject({
        ...baseCall,
        onError: ({ error }) => {
          reported = error;
        },
      });

      expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
      expect(reported).not.toBeNull();
    });
  });

  it("streams and generates text for callers that do not pass a schema", async () => {
    const model = new ScriptedLanguageModel();
    model.script("session-1", [{ purpose: "chat-title", text: "A Scripted Title" }]);

    const generated = await model.generateText({ purpose: "chat-title", sessionId: "session-1" });
    const streamed = await model.streamText({ purpose: "chat-title", sessionId: "session-1" });

    expect(generated.data?.text).toBe("A Scripted Title");
    expect((await collect(streamed.data!.textStream)).join("")).toBe("A Scripted Title");
  });

  it("reports token usage so quota and usage specs see a real number", async () => {
    const model = new ScriptedLanguageModel();

    const result = await model.generateObject(baseCall);

    expect(result.data?.usage.promptTokens).toBeGreaterThan(0);
    expect(result.data?.usage.completionTokens).toBeGreaterThan(0);
  });
});
