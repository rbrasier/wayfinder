import {
  domainError,
  drawnSignatureProblem,
  drawnSignatureStoragePath,
  err,
  ok,
  type DrawnSignature,
  type IAuditLogger,
  type IDrawnSignatureRepository,
  type IObjectStorage,
  type Result,
} from "@wayfinder/domain";

export interface SaveDrawnSignatureInput {
  // Always the signed-in user. There is deliberately no way to name anyone
  // else: a drawing saved for another person is a forged signature.
  userId: string;
  impersonatorId: string | null;
  png: Buffer;
}

export class SaveDrawnSignature {
  constructor(
    private readonly objectStorage: IObjectStorage,
    private readonly drawnSignatures: IDrawnSignatureRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: SaveDrawnSignatureInput): Promise<Result<DrawnSignature>> {
    if (input.impersonatorId) {
      return err(domainError("FORBIDDEN", "A signature can't be drawn while viewing as another user."));
    }
    const problem = drawnSignatureProblem(input.png);
    if (problem) return err(domainError("VALIDATION_FAILED", problem));

    const updatedAt = this.now();
    const storagePath = drawnSignatureStoragePath(input.userId, updatedAt);
    const put = await this.objectStorage.put(storagePath, input.png, "image/png");
    if (put.error) return put;

    const signature: DrawnSignature = { userId: input.userId, storagePath, updatedAt };
    const saved = await this.drawnSignatures.save(signature);
    if (saved.error) return saved;

    await this.auditLogger.log({
      actorId: input.userId,
      action: "signature.drawn.saved",
      resourceType: "user",
      resourceId: input.userId,
      metadata: { storagePath },
    });
    return ok(signature);
  }
}
