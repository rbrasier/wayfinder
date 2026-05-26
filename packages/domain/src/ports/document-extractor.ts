import type { Result } from "../result";

export interface IDocumentExtractor {
  extract(params: { buffer: Buffer; mimeType: string }): Promise<Result<string>>;
}
