import { domainError, err, ok } from "@rbrasier/domain";
import type {
  ConversationalNodeConfig,
  ISkillParser,
  ISkillRepository,
  ListSkillsInput,
  ResolvedSkill,
  Result,
  Skill,
} from "@rbrasier/domain";

export class CreateSkill {
  constructor(
    private readonly skills: ISkillRepository,
    private readonly parser: ISkillParser,
  ) {}

  async execute(input: { raw: string; createdByUserId?: string | null }): Promise<Result<Skill>> {
    const parsed = this.parser.parse(input.raw);
    if (parsed.error) return err(parsed.error);

    return this.skills.create({
      name: parsed.data.name,
      description: parsed.data.description,
      body: parsed.data.body,
      allowedTools: parsed.data.allowedTools,
      frontmatter: parsed.data.frontmatter,
      createdByUserId: input.createdByUserId ?? null,
    });
  }
}

export class UpdateSkill {
  constructor(
    private readonly skills: ISkillRepository,
    private readonly parser: ISkillParser,
  ) {}

  async execute(input: { id: string; raw: string }): Promise<Result<Skill>> {
    const parsed = this.parser.parse(input.raw);
    if (parsed.error) return err(parsed.error);

    return this.skills.update(input.id, {
      name: parsed.data.name,
      description: parsed.data.description,
      body: parsed.data.body,
      allowedTools: parsed.data.allowedTools,
      frontmatter: parsed.data.frontmatter,
    });
  }
}

export class ListSkills {
  constructor(private readonly skills: ISkillRepository) {}

  async execute(input?: ListSkillsInput): Promise<Result<Skill[]>> {
    return this.skills.list(input);
  }
}

export class GetSkill {
  constructor(private readonly skills: ISkillRepository) {}

  async execute(id: string): Promise<Result<Skill>> {
    const result = await this.skills.findById(id);
    if (result.error) return err(result.error);
    if (!result.data) return err(domainError("NOT_FOUND", "Skill not found."));
    return ok(result.data);
  }
}

export class ArchiveSkill {
  constructor(private readonly skills: ISkillRepository) {}

  async execute(id: string): Promise<Result<Skill>> {
    return this.skills.setStatus(id, "archived");
  }
}

export class RestoreSkill {
  constructor(private readonly skills: ISkillRepository) {}

  async execute(id: string): Promise<Result<Skill>> {
    return this.skills.setStatus(id, "active");
  }
}

// Resolves a conversational step's skill references plus any inline skill into the
// ordered list injected at prompt-build time (ADR-031). Referenced (library)
// skills render first in author order; the inline skill renders last. Archived or
// deleted references are silently dropped — a missing skill never fails a turn.
export class ResolveStepSkills {
  constructor(private readonly skills: ISkillRepository) {}

  async execute(config: ConversationalNodeConfig): Promise<Result<ResolvedSkill[]>> {
    const referenceIds = config.skillRefs ?? [];
    const resolved: ResolvedSkill[] = [];

    if (referenceIds.length > 0) {
      const found = await this.skills.listActiveByIds(referenceIds);
      if (found.error) return err(found.error);

      const byId = new Map(found.data.map((skill) => [skill.id, skill]));
      for (const id of referenceIds) {
        const skill = byId.get(id);
        if (skill) resolved.push({ name: skill.name, body: skill.body });
      }
    }

    if (config.inlineSkill) {
      resolved.push({ name: config.inlineSkill.name, body: config.inlineSkill.body });
    }

    return ok(resolved);
  }
}
