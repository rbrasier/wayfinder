import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNATURE_CONFIG, DEFAULT_TSA_URL, domainError, err, ok, type SignatureConfig } from "@wayfinder/domain";
import { HttpSignatureServicesProbe } from "./signature-services-probe";

const config: SignatureConfig = {
  method: "certificate",
  pdfConverter: { source: "external", url: "http://gotenberg:3000" },
  signatureEngine: { source: "external", url: "http://dss:8080/" },
  tsaUrl: "http://tsa.test/tsr",
  csc: { baseUrl: "http://csc.test/csc/v2", clientId: "wayfinder", clientSecret: "secret" },
};

const granted = Buffer.from([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x00]);

const fetchReturning = (respond: (url: string, init?: RequestInit) => Response) => {
  const urls: string[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { fetchFn, urls };
};

describe("HttpSignatureServicesProbe", () => {
  it("checks Gotenberg's health endpoint", async () => {
    const { fetchFn, urls } = fetchReturning(() => new Response('{"status":"up"}'));

    const result = await new HttpSignatureServicesProbe(fetchFn).probe("pdf-converter", config);

    expect(result).toMatchObject({ target: "pdf-converter", ok: true });
    expect(urls).toEqual(["http://gotenberg:3000/health"]);
  });

  it("checks the DSS sidecar's health endpoint", async () => {
    const { fetchFn, urls } = fetchReturning(() => new Response("ok"));

    const result = await new HttpSignatureServicesProbe(fetchFn).probe("signature-engine", config);

    expect(result.ok).toBe(true);
    expect(urls).toEqual(["http://dss:8080/health"]);
  });

  it("asks the TSA for a real timestamp and accepts a granted reply", async () => {
    const { fetchFn } = fetchReturning((_url, init) => {
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/timestamp-query");
      return new Response(granted, { headers: { "Content-Type": "application/timestamp-reply" } });
    });

    const result = await new HttpSignatureServicesProbe(fetchFn).probe("timestamp-authority", config);

    expect(result.ok).toBe(true);
  });

  it("fails a TSA that refuses the request, saying so", async () => {
    const refused = Buffer.from([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x02]);
    const { fetchFn } = fetchReturning(() => new Response(refused));

    const result = await new HttpSignatureServicesProbe(fetchFn).probe("timestamp-authority", config);

    expect(result).toMatchObject({ ok: false, message: "The timestamp authority refused the request (status 2)." });
  });

  it("calls the CSC provider's info endpoint", async () => {
    const { fetchFn, urls } = fetchReturning(() => Response.json({ specs: "2.0.0.2", name: "Mock CSC" }));

    const result = await new HttpSignatureServicesProbe(fetchFn).probe("signing-provider", config);

    expect(result).toMatchObject({ ok: true, message: "Mock CSC" });
    expect(urls).toEqual(["http://csc.test/csc/v2/info"]);
  });

  it("skips a service the config does not set", async () => {
    const { fetchFn, urls } = fetchReturning(() => new Response("ok"));

    const result = await new HttpSignatureServicesProbe(fetchFn).probe("signing-provider", DEFAULT_SIGNATURE_CONFIG);

    expect(result).toMatchObject({ ok: false, skipped: true });
    expect(urls).toEqual([]);
  });

  it("reports an unreachable service without throwing", async () => {
    const fetchFn = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const result = await new HttpSignatureServicesProbe(fetchFn).probe("pdf-converter", config);

    expect(result).toMatchObject({ ok: false, message: "Unreachable: fetch failed" });
  });

  it("reports a non-2xx status", async () => {
    const { fetchFn } = fetchReturning(() => new Response("", { status: 502 }));

    const result = await new HttpSignatureServicesProbe(fetchFn).probe("pdf-converter", config);

    expect(result).toMatchObject({ ok: false, message: "HTTP 502" });
  });

  it("probes DigiCert's timestamp authority when none is set", async () => {
    const { fetchFn, urls } = fetchReturning(() => new Response(granted));

    const result = await new HttpSignatureServicesProbe(fetchFn).probe("timestamp-authority", { ...config, tsaUrl: null });

    expect(result.ok).toBe(true);
    expect(urls).toEqual([DEFAULT_TSA_URL]);
  });

  describe("built-in engines", () => {
    const builtInConfig: SignatureConfig = {
      ...config,
      pdfConverter: { source: "built-in" },
      signatureEngine: { source: "built-in" },
    };

    it("checks the built-in converter by converting a small document", async () => {
      const converted: Buffer[] = [];
      const builtIn = {
        pdfConverter: {
          convertDocxToPdfA: async (docx: Buffer) => {
            converted.push(docx);
            return ok(Buffer.from("%PDF-1.7"));
          },
        },
        signatureEngine: { ensureRunning: async () => ok("http://127.0.0.1:40000") },
      };
      const { fetchFn, urls } = fetchReturning(() => new Response("ok"));

      const result = await new HttpSignatureServicesProbe(fetchFn, 1_000, builtIn).probe("pdf-converter", builtInConfig);

      expect(result.ok).toBe(true);
      expect(converted).toHaveLength(1);
      expect(urls).toEqual([]);
    });

    it("passes on why the built-in converter cannot run", async () => {
      const builtIn = {
        pdfConverter: {
          convertDocxToPdfA: async () => err(domainError("INFRA_FAILURE", "This image doesn't include the built-in engine.")),
        },
        signatureEngine: { ensureRunning: async () => ok("http://127.0.0.1:40000") },
      };

      const result = await new HttpSignatureServicesProbe(undefined, 1_000, builtIn).probe("pdf-converter", builtInConfig);

      expect(result).toMatchObject({ ok: false, message: "This image doesn't include the built-in engine." });
    });

    it("starts the built-in signature engine and checks its health", async () => {
      const builtIn = {
        pdfConverter: { convertDocxToPdfA: async () => ok(Buffer.from("%PDF")) },
        signatureEngine: { ensureRunning: async () => ok("http://127.0.0.1:40000") },
      };
      const { fetchFn, urls } = fetchReturning(() => new Response("ok"));

      const result = await new HttpSignatureServicesProbe(fetchFn, 1_000, builtIn).probe("signature-engine", builtInConfig);

      expect(result.ok).toBe(true);
      expect(urls).toEqual(["http://127.0.0.1:40000/health"]);
    });

    it("fails a built-in engine where none is wired, as on the Lambda topology", async () => {
      const result = await new HttpSignatureServicesProbe().probe("signature-engine", builtInConfig);

      expect(result).toMatchObject({ ok: false, message: "There is no built-in engine here." });
    });
  });
});
