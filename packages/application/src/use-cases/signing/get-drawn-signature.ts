import {
  ok,
  type IDrawnSignatureRepository,
  type IObjectStorage,
  type Result,
} from "@wayfinder/domain";

export interface DrawnSignatureView {
  updatedAt: Date;
  dataUrl: string;
}

export class GetDrawnSignature {
  constructor(
    private readonly objectStorage: IObjectStorage,
    private readonly drawnSignatures: IDrawnSignatureRepository,
  ) {}

  async execute(userId: string): Promise<Result<DrawnSignatureView | null>> {
    const found = await this.drawnSignatures.findByUserId(userId);
    if (found.error) return found;
    if (!found.data) return ok(null);

    const image = await this.objectStorage.get(found.data.storagePath);
    if (image.error) return image;
    return ok({
      updatedAt: found.data.updatedAt,
      dataUrl: `data:image/png;base64,${image.data.toString("base64")}`,
    });
  }
}
