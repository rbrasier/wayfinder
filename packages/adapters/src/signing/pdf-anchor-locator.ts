import { domainError, err, ok, type IPdfAnchorLocator, type PdfRectangle, type Result } from "@wayfinder/domain";

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

// Reads the text layer of a converted PDF to find where each slot marker
// landed (ADR-068 §1). pdf.js reports positions bottom-up from the baseline;
// the signature engine places fields top-down, so the y axis is flipped here.
export class PdfJsAnchorLocator implements IPdfAnchorLocator {
  async locate(pdf: Buffer, markers: string[]): Promise<Result<Record<string, PdfRectangle>>> {
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const document = await pdfjs.getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, verbosity: 0 })
        .promise;
      const found: Record<string, PdfRectangle> = {};

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const pageHeight = page.view[3]! - page.view[1]!;
        const content = await page.getTextContent();
        for (const item of content.items as TextItem[]) {
          const marker = markers.find((candidate) => !found[candidate] && item.str?.includes(candidate));
          if (!marker) continue;
          const fontHeight = item.height || Math.abs(item.transform[3] ?? 12);
          found[marker] = {
            page: pageNumber,
            x: item.transform[4]!,
            y: pageHeight - item.transform[5]! - fontHeight,
            width: item.width,
            height: fontHeight,
          };
        }
      }
      await document.destroy();
      return ok(found);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Could not read the PDF to place signatures.", cause));
    }
  }
}
