// Turns a tool's JSON input schema into the MCP node's request fields, so an
// author starts from the tool's real arguments instead of a blank list
// (ADR-062 §5). A field's key is its label snake-cased, so the label is the
// property name — a snake_case argument round-trips exactly.

interface SchemaProperty {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  description?: string;
}

const propertiesOf = (schema: Record<string, unknown> | null): [string, SchemaProperty][] => {
  const properties = schema?.["properties"];
  if (typeof properties !== "object" || properties === null) return [];
  return Object.entries(properties as Record<string, SchemaProperty>);
};

const requiredOf = (schema: Record<string, unknown> | null): Set<string> => {
  const required = schema?.["required"];
  return new Set(Array.isArray(required) ? required.filter((name): name is string => typeof name === "string") : []);
};

const primaryType = (property: SchemaProperty): string | undefined =>
  Array.isArray(property.type) ? property.type.find((type) => type !== "null") : property.type;

const annotationFor = (property: SchemaProperty): string => {
  const options = (property.enum ?? []).filter((value): value is string => typeof value === "string");
  if (options.length > 0) return `options: ${options.join(", ")}`;
  const type = primaryType(property);
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "yesno";
  if (type === "string" && (property.format === "date" || property.format === "date-time")) return "date";
  if (type === "string" && property.format === "email") return "email";
  return "text";
};

export const requestFieldLinesFromInputSchema = (schema: Record<string, unknown> | null): string[] => {
  const required = requiredOf(schema);
  return propertiesOf(schema).map(([name, property]) => {
    const optional = required.has(name) ? "" : " (optional)";
    return `${name} (${annotationFor(property)})${optional}`;
  });
};

export interface InputSchemaParameter {
  name: string;
  type: string;
  required: boolean;
  description: string | null;
}

export const describeInputSchemaParameters = (schema: Record<string, unknown> | null): InputSchemaParameter[] => {
  const required = requiredOf(schema);
  return propertiesOf(schema).map(([name, property]) => {
    const type = primaryType(property) ?? "any";
    return {
      name,
      type: property.format ? `${type} (${property.format})` : type,
      required: required.has(name),
      description: property.description ?? null,
    };
  });
};
