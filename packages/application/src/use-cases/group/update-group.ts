import {
  domainError,
  err,
  type Group,
  type GroupUpdate,
  type IGroupRepository,
  type Result,
} from "@rbrasier/domain";

export class UpdateGroup {
  constructor(private readonly groups: IGroupRepository) {}

  async execute(id: string, patch: GroupUpdate): Promise<Result<Group>> {
    let name: string | undefined;
    if (patch.name !== undefined) {
      name = patch.name.trim();
      if (name.length === 0) return err(domainError("VALIDATION_FAILED", "Group name is required."));
    }
    const description =
      patch.description === undefined ? undefined : patch.description?.trim() || null;
    return this.groups.update(id, {
      name,
      description,
      ...(patch.organisationId !== undefined ? { organisationId: patch.organisationId } : {}),
    });
  }
}
