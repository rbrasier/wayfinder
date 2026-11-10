import { describe, expect, it } from "vitest";
import { ok, type DrawnSignature, type IDrawnSignatureRepository, type Result } from "@wayfinder/domain";
import { InMemoryAuditLog, InMemoryObjectStorage } from "../__fixtures__/presentation-doubles";
import { GetDrawnSignature } from "./get-drawn-signature";
import { SaveDrawnSignature } from "./save-drawn-signature";

class InMemoryDrawnSignatures implements IDrawnSignatureRepository {
  readonly rows = new Map<string, DrawnSignature>();

  async findByUserId(userId: string): Promise<Result<DrawnSignature | null>> {
    return ok(this.rows.get(userId) ?? null);
  }

  async save(signature: DrawnSignature): Promise<Result<void>> {
    this.rows.set(signature.userId, signature);
    return ok(undefined);
  }
}

const png = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

const NOW = new Date("2026-11-08T10:00:00Z");

const build = () => {
  const storage = new InMemoryObjectStorage();
  const repository = new InMemoryDrawnSignatures();
  const audit = new InMemoryAuditLog();
  return {
    storage,
    repository,
    audit,
    save: new SaveDrawnSignature(storage, repository, audit, () => NOW),
    get: new GetDrawnSignature(storage, repository),
  };
};

describe("SaveDrawnSignature", () => {
  it("stores the drawing and remembers it for the user", async () => {
    const { save, storage, repository, audit } = build();

    const result = await save.execute({ userId: "user-1", impersonatorId: null, png: png(600, 200) });

    expect(result.error).toBeUndefined();
    const remembered = repository.rows.get("user-1");
    expect(remembered?.storagePath).toBe(`signatures/drawn/user-1/${NOW.getTime()}.png`);
    expect(storage.objects.get(remembered!.storagePath)?.mimeType).toBe("image/png");
    expect(audit.rows.map((row) => row.action)).toEqual(["signature.drawn.saved"]);
  });

  it("refuses while an admin is viewing as the user, and stores nothing", async () => {
    const { save, storage, repository } = build();

    const result = await save.execute({ userId: "user-1", impersonatorId: "admin-1", png: png(600, 200) });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(storage.objects.size).toBe(0);
    expect(repository.rows.size).toBe(0);
  });

  it("refuses an image that is not a usable PNG, with the reason", async () => {
    const { save } = build();

    const result = await save.execute({ userId: "user-1", impersonatorId: null, png: Buffer.from("gif") });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toBe("A drawn signature must be a PNG image.");
  });

  it("writes a new object on redraw so earlier decisions keep the drawing they froze", async () => {
    const { storage, repository, audit } = build();
    const first = new SaveDrawnSignature(storage, repository, audit, () => NOW);
    const later = new SaveDrawnSignature(storage, repository, audit, () => new Date("2026-11-09T10:00:00Z"));

    await first.execute({ userId: "user-1", impersonatorId: null, png: png(600, 200) });
    await later.execute({ userId: "user-1", impersonatorId: null, png: png(500, 150) });

    expect(storage.objects.size).toBe(2);
  });
});

describe("GetDrawnSignature", () => {
  it("returns null for a user who has never drawn one", async () => {
    const { get } = build();

    const result = await get.execute("user-1");

    expect(result.data).toBeNull();
  });

  it("returns the image as a data URL for the preview", async () => {
    const { save, get } = build();
    await save.execute({ userId: "user-1", impersonatorId: null, png: png(600, 200) });

    const result = await get.execute("user-1");

    expect(result.data?.updatedAt).toEqual(NOW);
    expect(result.data?.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });
});
