import { describe, expect, it } from "vitest";
import { GotenbergPdfConverter } from "./gotenberg-pdf-converter";

interface Captured {
  url: string;
  form: FormData;
}

const fakeFetch = (respond: () => Response) => {
  const calls: Captured[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, form: init.body as FormData });
    return respond();
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
};

describe("GotenbergPdfConverter", () => {
  it("posts the docx to the LibreOffice route asking for PDF/A-2b", async () => {
    const { fetchFn, calls } = fakeFetch(() => new Response(Buffer.from("%PDF-1.7 converted")));
    const converter = new GotenbergPdfConverter(async () => "http://gotenberg:3000/", fetchFn);

    const result = await converter.convertDocxToPdfA(Buffer.from("docx-bytes"));

    expect(result.data?.toString()).toBe("%PDF-1.7 converted");
    expect(calls[0]?.url).toBe("http://gotenberg:3000/forms/libreoffice/convert");
    expect(calls[0]?.form.get("pdfa")).toBe("PDF/A-2b");
    expect((calls[0]?.form.get("files") as File).name).toBe("document.docx");
  });

  it("fails with a readable reason when no converter is configured", async () => {
    const { fetchFn } = fakeFetch(() => new Response(""));
    const converter = new GotenbergPdfConverter(async () => null, fetchFn);

    const result = await converter.convertDocxToPdfA(Buffer.from("docx"));

    expect(result.error?.message).toBe("No PDF converter is configured.");
  });

  it("reports the converter's status on a non-2xx response", async () => {
    const { fetchFn } = fakeFetch(() => new Response("boom", { status: 503 }));
    const converter = new GotenbergPdfConverter(async () => "http://gotenberg:3000", fetchFn);

    const result = await converter.convertDocxToPdfA(Buffer.from("docx"));

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(result.error?.message).toBe("The PDF converter returned 503.");
  });

  it("rejects a response that is not a PDF", async () => {
    const { fetchFn } = fakeFetch(() => new Response("<html>proxy error</html>"));
    const converter = new GotenbergPdfConverter(async () => "http://gotenberg:3000", fetchFn);

    const result = await converter.convertDocxToPdfA(Buffer.from("docx"));

    expect(result.error?.message).toBe("The PDF converter returned something that is not a PDF.");
  });

  it("maps a network failure to an unreachable error", async () => {
    const fetchFn = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const converter = new GotenbergPdfConverter(async () => "http://gotenberg:3000", fetchFn);

    const result = await converter.convertDocxToPdfA(Buffer.from("docx"));

    expect(result.error?.message).toBe("The PDF converter is unreachable.");
  });
});
