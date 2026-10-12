import type { Result } from "../result";

// Decides a staged file's type from its bytes and name rather than the type a
// browser reported, so a file's handling never depends on the browser or OS it
// was uploaded from. Returns null for a type extraction cannot read.
export interface IDocumentTypeDetector {
  detect(buffer: Buffer, filename: string): Result<string | null>;
}
