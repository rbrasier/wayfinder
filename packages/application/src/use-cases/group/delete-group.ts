import type { IGroupRepository, Result } from "@wayfinder/domain";

export class DeleteGroup {
  constructor(private readonly groups: IGroupRepository) {}

  async execute(id: string): Promise<Result<void>> {
    return this.groups.delete(id);
  }
}
