import type { Result } from "../result";

export interface PdfRectangle {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Finds where each slot marker landed in a converted PDF (ADR-068 §1), in the
// engine's top-left coordinates. A marker that cannot be found is absent from
// the result rather than an error: signing falls back to an appended page.
export interface IPdfAnchorLocator {
  locate(pdf: Buffer, markers: string[]): Promise<Result<Record<string, PdfRectangle>>>;
}
