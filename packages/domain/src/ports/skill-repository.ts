import type { NewSkill, Skill, SkillStatus, SkillUpdate } from "../entities/skill";
import type { Result } from "../result";

export interface ListSkillsInput {
  readonly includeArchived?: boolean;
}

export interface ISkillRepository {
  create(skill: NewSkill): Promise<Result<Skill>>;
  update(id: string, patch: SkillUpdate): Promise<Result<Skill>>;
  findById(id: string): Promise<Result<Skill | null>>;
  // Returns only the active skills among the requested ids, in no guaranteed
  // order — callers that need author order re-sort against their id list.
  listActiveByIds(ids: string[]): Promise<Result<Skill[]>>;
  list(input?: ListSkillsInput): Promise<Result<Skill[]>>;
  setStatus(id: string, status: SkillStatus): Promise<Result<Skill>>;
}
