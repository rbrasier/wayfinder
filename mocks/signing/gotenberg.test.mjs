import { describe, expect, it } from "vitest";
import { json, request, response } from "../test-support/http.mjs";
import { mock } from "./gotenberg.mjs";

const call = async (method, url, body = null, headers = {}) => {
  const res = response();
  await mock.handle(request(method, url, body, headers), res);
  return res.recorded;
};

describe("mock Gotenberg", () => {
  it("reports itself up on the health route", async () => {
    const recorded = await call("GET", "/gotenberg/health");

    expect(recorded.statusCode).toBe(200);
    expect(json(recorded).status).toBe("up");
  });

  it("returns a PDF for a LibreOffice conversion", async () => {
    const recorded = await call("POST", "/gotenberg/forms/libreoffice/convert", "multipart-body", {
      "Content-Type": "multipart/form-data; boundary=x",
    });

    expect(recorded.statusCode).toBe(200);
    expect(recorded.headers["Content-Type"]).toBe("application/pdf");
    expect(String(recorded.body).startsWith("%PDF-1.7")).toBe(true);
  });

  it("rejects a conversion with no upload", async () => {
    const recorded = await call("POST", "/gotenberg/forms/libreoffice/convert");

    expect(recorded.statusCode).toBe(400);
  });

  it("does not know other routes", async () => {
    const recorded = await call("GET", "/gotenberg/forms/chromium/convert/url");

    expect(recorded.statusCode).toBe(404);
  });
});
