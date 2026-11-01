import type { ISessionUploadRepository, Result } from "@wayfinder/domain";

export class RemoveSessionUpload {
  constructor(private readonly sessionUploads: ISessionUploadRepository) {}

  async execute(uploadId: string): Promise<Result<void>> {
    return this.sessionUploads.delete(uploadId);
  }
}
