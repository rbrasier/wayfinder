import { describe, expect, it } from "vitest";
import { sumSessionUploadChars, type SessionUpload } from "./session-upload";

const makeUpload = (extractedText: string | null): SessionUpload => ({
  id: "upload-1",
  sessionId: "session-1",
  messageId: null,
  filename: "doc.pdf",
  mimeType: "application/pdf",
  sizeBytes: 100,
  storagePath: "session/session-1/doc.pdf",
  extractedText,
  extractionStatus: extractedText ? "complete" : "failed",
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("sumSessionUploadChars", () => {
  it("returns 0 for no uploads", () => {
    expect(sumSessionUploadChars([])).toBe(0);
  });

  it("sums the extracted text length across uploads", () => {
    const uploads = [makeUpload("abcde"), makeUpload("xy")];
    expect(sumSessionUploadChars(uploads)).toBe(7);
  });

  it("treats null extracted text as zero characters", () => {
    const uploads = [makeUpload("abc"), makeUpload(null)];
    expect(sumSessionUploadChars(uploads)).toBe(3);
  });
});
