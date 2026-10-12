import type { Result } from "../result";

export interface IDocumentExtractor {
  // `filename` lets the extractor recover a supported type when `mimeType` is
  // only what a browser reported (an empty or vendor-specific type for a .md or
  // .csv), so the same file reads the same however it was uploaded.
  extract(params: { buffer: Buffer; mimeType: string; filename?: string }): Promise<Result<string>>;
}
