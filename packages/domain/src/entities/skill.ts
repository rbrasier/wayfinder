export type SkillStatus = "active" | "archived";

// A reusable skill stored in the library. Authored from an uploaded SKILL.md:
// `frontmatter` keeps the raw parsed key/value pairs; `allowedTools` is the
// normalised `allowed-tools` declaration (the bridge to MCP in Phase 2). Editing
// a skill bumps `version` (ADR-031).
export interface Skill {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly body: string;
  readonly allowedTools: string[];
  readonly frontmatter: Record<string, string>;
  readonly version: number;
  readonly status: SkillStatus;
  readonly createdByUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewSkill {
  readonly name: string;
  readonly description?: string | null;
  readonly body: string;
  readonly allowedTools?: string[];
  readonly frontmatter?: Record<string, string>;
  readonly createdByUserId?: string | null;
}

export interface SkillUpdate {
  readonly name?: string;
  readonly description?: string | null;
  readonly body?: string;
  readonly allowedTools?: string[];
  readonly frontmatter?: Record<string, string>;
}

// The result of parsing a raw SKILL.md, before it becomes a stored Skill or an
// inline skill on a node.
export interface ParsedSkill {
  readonly name: string;
  readonly description: string | null;
  readonly body: string;
  readonly allowedTools: string[];
  readonly frontmatter: Record<string, string>;
}

// A skill resolved for injection into a step's system prompt — only the parts the
// prompt needs.
export interface ResolvedSkill {
  readonly name: string;
  readonly body: string;
}
