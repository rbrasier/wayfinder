import { describe, expect, it } from "vitest";
import { parseTemplateField } from "@wayfinder/domain";
import { describeInputSchemaParameters, requestFieldLinesFromInputSchema } from "./request-fields-from-input-schema";

const schema = {
  type: "object",
  properties: {
    query: { type: "string", description: "Words to search for" },
    published_after: { type: "string", format: "date" },
    max_results: { type: "integer" },
    include_repealed: { type: "boolean" },
    jurisdiction: { type: "string", enum: ["federal", "state"] },
  },
  required: ["query"],
};

describe("requestFieldLinesFromInputSchema", () => {
  it("writes one request field per schema property, typed and optional as the schema says", () => {
    expect(requestFieldLinesFromInputSchema(schema)).toEqual([
      "query (text)",
      "published_after (date) (optional)",
      "max_results (number) (optional)",
      "include_repealed (yesno) (optional)",
      "jurisdiction (options: federal, state) (optional)",
    ]);
  });

  it("produces lines whose field keys are the tool's argument names", () => {
    const keys = requestFieldLinesFromInputSchema(schema).map((line) => parseTemplateField(line).data?.key);

    expect(keys).toEqual(["query", "published_after", "max_results", "include_repealed", "jurisdiction"]);
  });

  it("returns nothing for a missing or property-less schema", () => {
    expect(requestFieldLinesFromInputSchema(null)).toEqual([]);
    expect(requestFieldLinesFromInputSchema({ type: "object" })).toEqual([]);
  });
});

describe("describeInputSchemaParameters", () => {
  it("lists each parameter's name, type, whether it is required and its description", () => {
    expect(describeInputSchemaParameters(schema).slice(0, 2)).toEqual([
      { name: "query", type: "string", required: true, description: "Words to search for" },
      { name: "published_after", type: "string (date)", required: false, description: null },
    ]);
  });
});
