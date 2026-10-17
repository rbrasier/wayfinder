import { describe, expect, it } from "vitest";
import {
  DEFAULT_MCP_CALL_TIMEOUT_MS,
  MCP_DATA_CLASSIFICATIONS,
  isFlowUsableClassification,
  isValidMcpCallTimeout,
  validateMcpCustomHeaders,
} from "./mcp-server";

describe("isFlowUsableClassification", () => {
  it("offers internal and public-read servers to flows", () => {
    expect(isFlowUsableClassification("internal")).toBe(true);
    expect(isFlowUsableClassification("public-read")).toBe(true);
  });

  it("keeps servers that send records out of flows", () => {
    expect(isFlowUsableClassification("external-write")).toBe(false);
  });

  it("lists every classification once", () => {
    expect(MCP_DATA_CLASSIFICATIONS).toEqual(["internal", "public-read", "external-write"]);
  });
});

describe("isValidMcpCallTimeout", () => {
  it("accepts the default and the bounds", () => {
    expect(isValidMcpCallTimeout(DEFAULT_MCP_CALL_TIMEOUT_MS)).toBe(true);
    expect(isValidMcpCallTimeout(1_000)).toBe(true);
    expect(isValidMcpCallTimeout(120_000)).toBe(true);
  });

  it("rejects values outside the bounds or not whole milliseconds", () => {
    expect(isValidMcpCallTimeout(999)).toBe(false);
    expect(isValidMcpCallTimeout(120_001)).toBe(false);
    expect(isValidMcpCallTimeout(1_500.5)).toBe(false);
  });
});

describe("validateMcpCustomHeaders", () => {
  it("accepts ordinary headers and trims names", () => {
    const result = validateMcpCustomHeaders({ " X-Api-Key ": "abc", "X-Tenant": "gov" }, false);

    expect(result.data).toEqual({ "X-Api-Key": "abc", "X-Tenant": "gov" });
  });

  it("refuses a header name with characters outside an HTTP token", () => {
    expect(validateMcpCustomHeaders({ "Bad Header": "x" }, false).error?.code).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("refuses headers that would break the transport, whatever their case", () => {
    for (const name of ["Host", "content-length", "Content-Type", "ACCEPT", "Mcp-Session-Id", "mcp-protocol-version", "Last-Event-ID"]) {
      expect(validateMcpCustomHeaders({ [name]: "x" }, false).error?.message).toContain(name);
    }
  });

  it("refuses Authorization only when a bearer token is also set", () => {
    expect(validateMcpCustomHeaders({ Authorization: "Basic abc" }, false).data).toEqual({
      Authorization: "Basic abc",
    });
    expect(validateMcpCustomHeaders({ authorization: "Basic abc" }, true).error?.code).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("refuses an empty name or a value carrying a line break", () => {
    expect(validateMcpCustomHeaders({ " ": "x" }, false).error).toBeDefined();
    expect(validateMcpCustomHeaders({ "X-Key": "a\r\nInjected: 1" }, false).error).toBeDefined();
  });
});
