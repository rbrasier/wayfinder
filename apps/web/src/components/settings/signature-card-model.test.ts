import { describe, expect, it } from "vitest";
import {
  EMPTY_FORM,
  engineStatusLabel,
  formFromConfig,
  inputFromForm,
  testTargetLabel,
} from "./signature-card-model";

describe("formFromConfig", () => {
  it("shows a built-in engine as Built-in with an empty url field", () => {
    const form = formFromConfig({
      method: "drawn",
      pdfConverter: { source: "built-in" },
      signatureEngine: { source: "external", url: "http://dss:8080" },
      tsaUrl: null,
      csc: null,
    });

    expect(form).toMatchObject({
      method: "drawn",
      pdfConverterSource: "built-in",
      pdfConverterUrl: "",
      signatureEngineSource: "external",
      signatureEngineUrl: "http://dss:8080",
      tsaUrl: "",
    });
  });

  it("keeps the client secret out of the form, noting only that one is saved", () => {
    const form = formFromConfig({
      method: "certificate",
      pdfConverter: { source: "built-in" },
      signatureEngine: { source: "built-in" },
      tsaUrl: "http://tsa",
      csc: { baseUrl: "http://csc", clientId: "wayfinder", hasClientSecret: true },
    });

    expect(form).toMatchObject({ cscClientSecret: "", hasClientSecret: true, cscBaseUrl: "http://csc" });
  });
});

describe("inputFromForm", () => {
  it("sends Built-in without a url, and External with the url typed", () => {
    const input = inputFromForm({
      ...EMPTY_FORM,
      method: "drawn",
      pdfConverterSource: "external",
      pdfConverterUrl: "http://gotenberg:3000",
      signatureEngineUrl: "http://left-over",
    });

    expect(input.pdfConverter).toEqual({ source: "external", url: "http://gotenberg:3000" });
    expect(input.signatureEngine).toEqual({ source: "built-in" });
  });

  it("sends no signing provider until both its url and client id are filled in", () => {
    expect(inputFromForm({ ...EMPTY_FORM, cscBaseUrl: "http://csc" }).csc).toBeNull();
    expect(inputFromForm({ ...EMPTY_FORM, cscBaseUrl: "http://csc", cscClientId: "id" }).csc).toEqual({
      baseUrl: "http://csc",
      clientId: "id",
      clientSecret: "",
    });
  });

  it("defaults to built-in engines", () => {
    expect(inputFromForm(EMPTY_FORM)).toMatchObject({
      pdfConverter: { source: "built-in" },
      signatureEngine: { source: "built-in" },
    });
  });
});

describe("engineStatusLabel", () => {
  it("says what a built-in engine is doing", () => {
    expect(engineStatusLabel({ source: "built-in" }, "running")).toBe("Built-in · running");
    expect(engineStatusLabel({ source: "built-in" }, "idle")).toBe("Built-in · idle");
  });

  it("says plainly when this image has no built-in engine", () => {
    expect(engineStatusLabel({ source: "built-in" }, "unavailable")).toBe("Not included in this image");
  });

  it("shows the address of an external engine", () => {
    expect(engineStatusLabel({ source: "external", url: "http://gotenberg:3000" }, "idle")).toBe(
      "External · http://gotenberg:3000",
    );
  });
});

describe("testTargetLabel", () => {
  it("names built-in engines as built-in in the Test results", () => {
    const form = { ...EMPTY_FORM, pdfConverterSource: "built-in" as const, signatureEngineSource: "external" as const };

    expect(testTargetLabel("pdf-converter", form)).toBe("Built-in PDF converter");
    expect(testTargetLabel("signature-engine", form)).toBe("Signature engine");
    expect(testTargetLabel("timestamp-authority", form)).toBe("Timestamp authority");
    expect(testTargetLabel("signature-engine", { ...form, signatureEngineSource: "built-in" })).toBe(
      "Built-in signature engine",
    );
  });
});
