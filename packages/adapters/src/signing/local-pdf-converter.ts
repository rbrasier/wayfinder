import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  domainError,
  err,
  ok,
  type BuiltInEngineStatus,
  type IPdfConverter,
  type Result,
} from "@wayfinder/domain";
import { findOutsideContent } from "./docx-outside-content";
import { NOT_INCLUDED_MESSAGE } from "./engine-supervisor";

const PDF_MAGIC = "%PDF-";
// PDF/A-2b, the same level the Gotenberg route asks for (ADR-067 §3).
const PDFA_FILTER = 'pdf:writer_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"2"}}';

export type ConverterRun = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<{ exitCode: number | null; timedOut: boolean }>;

export interface LocalPdfConverterOptions {
  sofficePath: string;
  isInstalled: () => boolean;
  run: ConverterRun;
  tempRoot?: string;
  concurrency: number;
  timeoutMs: number;
}

// Converts with the LibreOffice inside the Wayfinder image (ADR-069 §1) — the
// same engine Gotenberg wraps, so the PDF is the same. LibreOffice will not run
// two conversions on one profile, so each job gets its own, and a small queue
// keeps a burst of approvals from starting a LibreOffice per request.
//
// LibreOffice fetches whatever a document links to, and here it would do so
// from inside the web container, so a document that links to outside content
// is refused before LibreOffice sees it (ADR-069 §6).
export class LocalPdfConverter implements IPdfConverter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly options: LocalPdfConverterOptions) {}

  status(): BuiltInEngineStatus {
    if (!this.options.isInstalled()) return "unavailable";
    return this.active > 0 ? "running" : "idle";
  }

  async convertDocxToPdfA(docxBytes: Buffer): Promise<Result<Buffer>> {
    if (!this.options.isInstalled()) return err(domainError("INFRA_FAILURE", NOT_INCLUDED_MESSAGE));
    const outside = findOutsideContent(docxBytes);
    if (outside.error) return outside;
    if (outside.data.length > 0) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `This document links to content outside itself (${outside.data.join(", ")}), which the built-in PDF converter will not fetch. Embed it in the template instead.`,
        ),
      );
    }
    await this.acquire();
    try {
      return await this.convert(docxBytes);
    } finally {
      this.release();
    }
  }

  private async convert(docxBytes: Buffer): Promise<Result<Buffer>> {
    const workDirectory = await mkdtemp(join(this.options.tempRoot ?? tmpdir(), "wayfinder-pdf-"));
    try {
      const input = join(workDirectory, "document.docx");
      await writeFile(input, docxBytes);
      const outcome = await this.options.run(
        this.options.sofficePath,
        [
          "--headless",
          "--norestore",
          `-env:UserInstallation=${pathToFileURL(join(workDirectory, "profile")).href}`,
          "--convert-to",
          PDFA_FILTER,
          "--outdir",
          workDirectory,
          input,
        ],
        this.options.timeoutMs,
      );
      if (outcome.timedOut) return err(domainError("INFRA_FAILURE", "The built-in PDF converter took too long."));

      const pdf = await readFile(join(workDirectory, "document.pdf")).catch(() => null);
      if (!pdf) return err(domainError("INFRA_FAILURE", "The built-in PDF converter produced no PDF."));
      if (pdf.subarray(0, PDF_MAGIC.length).toString("latin1") !== PDF_MAGIC) {
        return err(domainError("INFRA_FAILURE", "The built-in PDF converter produced something that is not a PDF."));
      }
      return ok(pdf);
    } finally {
      await rm(workDirectory, { recursive: true, force: true });
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.options.concurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  // Hands the slot straight to the next waiter, so `active` never dips and a
  // newcomer cannot jump the queue.
  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }
    this.active -= 1;
  }
}
