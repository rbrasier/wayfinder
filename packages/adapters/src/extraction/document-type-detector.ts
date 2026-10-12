import { ok } from "@rbrasier/domain";
import type { IDocumentTypeDetector, Result } from "@rbrasier/domain";
import { sniffMimeType } from "./mime-sniff";

// Types a loose upload the same way a zip entry is typed, so a file is handled
// identically whichever way it arrived and whatever the browser reported.
export class SniffingDocumentTypeDetector implements IDocumentTypeDetector {
  detect(buffer: Buffer, filename: string): Result<string | null> {
    return ok(sniffMimeType(buffer, filename));
  }
}
