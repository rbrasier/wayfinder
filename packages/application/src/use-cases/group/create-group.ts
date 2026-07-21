import {
  domainError,
  err,
  type Group,
  type IGroupRepository,
  type Result,
} from "@rbrasier/domain";

export class CreateGroup {
  constructor(private readonly groups: IGroupRepository) {}

  async execute(input: {
    name: string;
    description?: string | null;
    organisationId?: string | null;
  }): Promise<Result<Group>> {
    const name = input.name.trim();
    if (name.length === 0) return err(domainError("VALIDATION_FAILED", "Group name is required."));

    return this.groups.create({
      name,
      description: input.description?.trim() || null,
      organisationId: input.organisationId ?? null,
    });
  }
}
