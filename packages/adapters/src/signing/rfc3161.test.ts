import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildTimeStampRequest, readTimeStampResponseStatus } from "./rfc3161";

describe("buildTimeStampRequest", () => {
  it("encodes a v1 SHA-256 request with certReq set", () => {
    const digest = createHash("sha256").update("probe").digest();

    const request = buildTimeStampRequest(digest);

    expect(request[0]).toBe(0x30);
    expect(request.length).toBe(request[1]! + 2);
    expect(request.subarray(2, 5)).toEqual(Buffer.from([0x02, 0x01, 0x01]));
    expect(request.includes(Buffer.from("608648016503040201", "hex"))).toBe(true);
    expect(request.includes(digest)).toBe(true);
    expect(request.subarray(-3)).toEqual(Buffer.from([0x01, 0x01, 0xff]));
  });

  it("refuses a digest that is not 32 bytes", () => {
    expect(() => buildTimeStampRequest(Buffer.alloc(20))).toThrow("SHA-256");
  });
});

describe("readTimeStampResponseStatus", () => {
  it("reads a granted status", () => {
    const response = Buffer.from([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x00]);

    expect(readTimeStampResponseStatus(response)).toBe(0);
  });

  it("reads a rejection", () => {
    const response = Buffer.from([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x02]);

    expect(readTimeStampResponseStatus(response)).toBe(2);
  });

  it("returns null for bytes that are not a timestamp response", () => {
    expect(readTimeStampResponseStatus(Buffer.from("<html>"))).toBeNull();
  });
});
