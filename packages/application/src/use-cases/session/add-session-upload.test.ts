import { ok, type ISessionUploadRepository, type NewSessionUpload, type SessionUpload } from "@rbrasier/domain";
import { describe, expect, it, vi } from "vitest";
import { AddSessionUpload } from "./add-session-upload";
import { RemoveSessionUpload } from "./remove-session-upload";

const newUpload: NewSessionUpload = {
  sessionId: "session-1",
  messageId: null,
  filename: "spec.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  storagePath: "session/session-1/spec.pdf",
  extractedText: "The widget must be blue.",
  extractionStatus: "complete",
};

const stored: SessionUpload = {
  id: "upload-1",
  ...newUpload,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("AddSessionUpload", () => {
  it("persists the upload through the repository", async () => {
    const create = vi.fn().mockResolvedValue(ok(stored));
    const repository = { create, listBySession: vi.fn() } as unknown as ISessionUploadRepository;

    const result = await new AddSessionUpload(repository).execute(newUpload);

    expect(create).toHaveBeenCalledWith(newUpload);
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(stored);
  });
});

describe("RemoveSessionUpload", () => {
  it("deletes the upload through the repository", async () => {
    const deleteFn = vi.fn().mockResolvedValue(ok(undefined));
    const repository = {
      create: vi.fn(),
      listBySession: vi.fn(),
      delete: deleteFn,
    } as unknown as ISessionUploadRepository;

    const result = await new RemoveSessionUpload(repository).execute("upload-1");

    expect(deleteFn).toHaveBeenCalledWith("upload-1");
    expect(result.error).toBeUndefined();
  });
});
