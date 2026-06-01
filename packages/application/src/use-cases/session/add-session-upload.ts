import type {
  ISessionUploadRepository,
  NewSessionUpload,
  Result,
  SessionUpload,
} from "@rbrasier/domain";

export class AddSessionUpload {
  constructor(private readonly sessionUploads: ISessionUploadRepository) {}

  async execute(upload: NewSessionUpload): Promise<Result<SessionUpload>> {
    return this.sessionUploads.create(upload);
  }
}
