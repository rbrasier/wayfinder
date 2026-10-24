// Shared tool definitions for the mock MCP server. Both transport handlers
// (streamable-http.mjs and sse.mjs) register the same tools against their own
// McpServer instance so behaviour is identical no matter which transport a
// caller picks.
//
// Tools mirror the "self-contained utilities such as spellcheck and calculation"
// example from docs/development/implemented/alpha-2/v2.5.0/enhance-mcp-internal-
// external-governance.md — the internal-server class this mock stands in for.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const MISSPELLINGS = new Map([
  ["teh", "the"],
  ["recieve", "receive"],
  ["recieved", "received"],
  ["seperate", "separate"],
  ["seperated", "separated"],
  ["occured", "occurred"],
  ["occuring", "occurring"],
  ["definately", "definitely"],
]);

// Arithmetic expression: digits, decimal points, whitespace, + - * / ( ). No
// identifiers, no function calls — reject anything else before evaluating so
// `Function` cannot pull in globals.
const ARITHMETIC_ONLY = /^[\d+\-*/(). \t]+$/;

export function createMockMcpServer() {
  const mcp = new McpServer({ name: "wayfinder-mock-mcp-tools", version: "0.1.0" });

  mcp.registerTool(
    "echo",
    {
      description: "Returns the input message unchanged. Useful for smoke-testing an MCP wiring.",
      inputSchema: { message: z.string() },
    },
    ({ message }) => ({
      content: [{ type: "text", text: message }],
    }),
  );

  mcp.registerTool(
    "spellcheck",
    {
      description:
        "Corrects a small fixed dictionary of common misspellings (teh, recieve/d, seperate/d, occured, occuring, definately). Case-preserving on the first letter.",
      inputSchema: { text: z.string() },
    },
    ({ text }) => ({
      content: [{ type: "text", text: correctSpelling(text) }],
    }),
  );

  mcp.registerTool(
    "calculate",
    {
      description:
        "Evaluates a simple arithmetic expression (digits, + - * / and parentheses) and returns the numeric result as text. Rejects anything else.",
      inputSchema: { expression: z.string() },
    },
    ({ expression }) => {
      const result = evaluateArithmetic(expression);
      if (result === null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Refusing to evaluate "${expression}" — only digits, whitespace, + - * / and parentheses are allowed.`,
            },
          ],
        };
      }
      return { content: [{ type: "text", text: String(result) }] };
    },
  );

  return mcp;
}

function correctSpelling(text) {
  return text.replace(/[A-Za-z]+/g, (word) => {
    const lower = word.toLowerCase();
    const replacement = MISSPELLINGS.get(lower);
    if (!replacement) return word;
    return word[0] === word[0].toUpperCase()
      ? replacement[0].toUpperCase() + replacement.slice(1)
      : replacement;
  });
}

function evaluateArithmetic(expression) {
  if (!ARITHMETIC_ONLY.test(expression)) return null;
  try {
    const value = Function(`"use strict"; return (${expression});`)();
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
