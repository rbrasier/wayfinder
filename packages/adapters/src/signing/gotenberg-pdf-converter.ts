import { domainError, err, ok, type IPdfConverter, type Result } from "@wayfinder/domain";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MAGIC = "%PDF-";
const DEFAULT_TIMEOUT_MS = 60_000;

// Converts through Gotenberg's LibreOffice route (ADR-067 §3). PDF/A-2b because
// a signed record must carry its own fonts and colour profile to stay readable
// and verifiable for years. The URL is read per call so an admin change takes
// effect without a restart.
export class GotenbergPdfConverter implements IPdfConverter {
  constructor(
    private readonly loadBaseUrl: () => Promise<string | null>,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async convertDocxToPdfA(docxBytes: Buffer): Promise<Result<Buffer>> {
    const baseUrl = await this.loadBaseUrl();
    if (!baseUrl) return err(domainError("INFRA_FAILURE", "No PDF converter is configured."));

    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(docxBytes)], { type: DOCX_MIME }), "document.docx");
    form.append("pdfa", "PDF/A-2b");

    let response: Response;
    try {
      response = await this.fetchFn(`${baseUrl.replace(/\/+$/, "")}/forms/libreoffice/convert`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "The PDF converter is unreachable.", cause));
    }
    if (!response.ok) {
      return err(domainError("INFRA_FAILURE", `The PDF converter returned ${response.status}.`));
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.subarray(0, PDF_MAGIC.length).toString("latin1") !== PDF_MAGIC) {
      return err(domainError("INFRA_FAILURE", "The PDF converter returned something that is not a PDF."));
    }
    return ok(bytes);
  }
}
