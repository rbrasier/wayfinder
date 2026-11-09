import { describe, expect, it } from "vitest";
import { ok, type EngineChoice, type IPdfConverter } from "@wayfinder/domain";
import { RoutingPdfConverter, createBuiltInEngines } from "./built-in-engines";

const converterNamed = (name: string, calls: string[]): IPdfConverter => ({
  convertDocxToPdfA: async () => {
    calls.push(name);
    return ok(Buffer.from(`%PDF-${name}`));
  },
});

describe("RoutingPdfConverter", () => {
  it("converts on the external service when the admin chose one, reading the choice per call", async () => {
    const calls: string[] = [];
    let choice: EngineChoice = { source: "external", url: "http://gotenberg:3000" };
    const externalUrls: string[] = [];
    const router = new RoutingPdfConverter(
      async () => choice,
      converterNamed("built-in", calls),
      (url) => {
        externalUrls.push(url);
        return converterNamed("external", calls);
      },
    );

    await router.convertDocxToPdfA(Buffer.from("docx"));
    choice = { source: "built-in" };
    await router.convertDocxToPdfA(Buffer.from("docx"));

    expect(calls).toEqual(["external", "built-in"]);
    expect(externalUrls).toEqual(["http://gotenberg:3000"]);
  });

  it("fails closed for a built-in choice where no built-in converter is wired", async () => {
    const router = new RoutingPdfConverter(async () => ({ source: "built-in" }), null);

    const result = await router.convertDocxToPdfA(Buffer.from("docx"));

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});

describe("createBuiltInEngines", () => {
  it("reports both engines unavailable in an image that carries neither", () => {
    const engines = createBuiltInEngines({
      PDF_CONVERTER_SOFFICE: "/nowhere/soffice",
      SIGNING_ENGINE_JAVA: "/nowhere/java",
      SIGNING_ENGINE_JAR: "/nowhere/wayfinder-dss.jar",
    });

    expect(engines.status()).toEqual({ pdfConverter: "unavailable", signatureEngine: "unavailable" });
  });
});
