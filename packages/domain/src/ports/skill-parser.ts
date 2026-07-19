import type { ParsedSkill } from "../entities/skill";
import type { Result } from "../result";

// Parses a raw SKILL.md (YAML frontmatter + markdown body) into a ParsedSkill.
// A malformed file returns a VALIDATION_FAILED DomainError — never a throw.
export interface ISkillParser {
  parse(raw: string): Result<ParsedSkill>;
}
