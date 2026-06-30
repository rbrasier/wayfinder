import { domainError, err, ok } from "@rbrasier/domain";
import type {
  ConversationalNodeConfig,
  ISkillParser,
  ISkillRepository,
  ListSkillsInput,
  NewSkill,
  ParsedSkill,
  Result,
  Skill,
  SkillStatus,
  SkillUpdate,
} from "@rbrasier/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ArchiveSkill,
  CreateSkill,
  GetSkill,
  ListSkills,
  ResolveStepSkills,
  RestoreSkill,
  UpdateSkill,
} from "./skill";

class InMemorySkillRepository implements ISkillRepository {
  private rows: Skill[] = [];
  private sequence = 0;

  async create(input: NewSkill): Promise<Result<Skill>> {
    this.sequence += 1;
    const now = new Date();
    const skill: Skill = {
      id: `skill-${this.sequence}`,
      name: input.name,
      description: input.description ?? null,
      body: input.body,
      allowedTools: input.allowedTools ?? [],
      frontmatter: input.frontmatter ?? {},
      version: 1,
      status: "active",
      createdByUserId: input.createdByUserId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(skill);
    return ok(skill);
  }

  async update(id: string, patch: SkillUpdate): Promise<Result<Skill>> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return err(domainError("NOT_FOUND", "Skill not found."));
    const current = this.rows[index]!;
    const updated: Skill = {
      ...current,
      name: patch.name ?? current.name,
      description: patch.description === undefined ? current.description : patch.description,
      body: patch.body ?? current.body,
      allowedTools: patch.allowedTools ?? current.allowedTools,
      frontmatter: patch.frontmatter ?? current.frontmatter,
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.rows[index] = updated;
    return ok(updated);
  }

  async findById(id: string): Promise<Result<Skill | null>> {
    return ok(this.rows.find((row) => row.id === id) ?? null);
  }

  async listActiveByIds(ids: string[]): Promise<Result<Skill[]>> {
    return ok(this.rows.filter((row) => ids.includes(row.id) && row.status === "active"));
  }

  async list(input?: ListSkillsInput): Promise<Result<Skill[]>> {
    return ok(input?.includeArchived ? this.rows : this.rows.filter((row) => row.status === "active"));
  }

  async setStatus(id: string, status: SkillStatus): Promise<Result<Skill>> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return err(domainError("NOT_FOUND", "Skill not found."));
    this.rows[index] = { ...this.rows[index]!, status };
    return ok(this.rows[index]!);
  }
}

// A parser fake: succeeds with a fixed shape unless the raw is the magic
// "INVALID" string, so the use-case's error propagation can be exercised.
const fakeParser: ISkillParser = {
  parse(raw: string): Result<ParsedSkill> {
    if (raw.trim() === "INVALID") {
      return err(domainError("VALIDATION_FAILED", "bad skill"));
    }
    return ok({
      name: "Parsed Name",
      description: "Parsed description",
      body: raw.trim(),
      allowedTools: ["search"],
      frontmatter: { name: "Parsed Name" },
    });
  },
};

const conversationalConfig = (overrides: Partial<ConversationalNodeConfig>): ConversationalNodeConfig => ({
  aiInstruction: "instruction",
  doneWhen: "done",
  outputType: "conversation_only",
  ...overrides,
});

describe("CreateSkill", () => {
  let repository: InMemorySkillRepository;

  beforeEach(() => {
    repository = new InMemorySkillRepository();
  });

  it("parses the raw SKILL.md and stores the result", async () => {
    const result = await new CreateSkill(repository, fakeParser).execute({
      raw: "Do the thing.",
      createdByUserId: "user-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.name).toBe("Parsed Name");
    expect(result.data?.allowedTools).toEqual(["search"]);
    expect(result.data?.createdByUserId).toBe("user-1");
  });

  it("propagates a parser error and stores nothing", async () => {
    const result = await new CreateSkill(repository, fakeParser).execute({ raw: "INVALID" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    const listed = await repository.list();
    expect(listed.data).toHaveLength(0);
  });
});

describe("GetSkill", () => {
  it("returns NOT_FOUND for an unknown id", async () => {
    const repository = new InMemorySkillRepository();
    const result = await new GetSkill(repository).execute("missing");
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("propagates a repository error", async () => {
    const repository = {
      findById: async () => err(domainError("INFRA_FAILURE", "db down")),
    } as unknown as ISkillRepository;
    const result = await new GetSkill(repository).execute("any");
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});

describe("UpdateSkill", () => {
  let repository: InMemorySkillRepository;

  beforeEach(() => {
    repository = new InMemorySkillRepository();
  });

  it("re-parses the raw SKILL.md and bumps the version", async () => {
    const created = await new CreateSkill(repository, fakeParser).execute({ raw: "first" });
    const result = await new UpdateSkill(repository, fakeParser).execute({
      id: created.data!.id,
      raw: "second",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.version).toBe(2);
    expect(result.data?.body).toBe("second");
  });

  it("propagates a parser error and does not update", async () => {
    const created = await new CreateSkill(repository, fakeParser).execute({ raw: "first" });
    const result = await new UpdateSkill(repository, fakeParser).execute({
      id: created.data!.id,
      raw: "INVALID",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    const reread = await repository.findById(created.data!.id);
    expect(reread.data?.version).toBe(1);
  });
});

describe("RestoreSkill", () => {
  it("returns an archived skill to active", async () => {
    const repository = new InMemorySkillRepository();
    const created = await new CreateSkill(repository, fakeParser).execute({ raw: "x" });
    await new ArchiveSkill(repository).execute(created.data!.id);

    const restored = await new RestoreSkill(repository).execute(created.data!.id);
    expect(restored.data?.status).toBe("active");

    const active = await new ListSkills(repository).execute();
    expect(active.data).toHaveLength(1);
  });
});

describe("ListSkills / ArchiveSkill", () => {
  it("excludes archived skills by default and includes them when asked", async () => {
    const repository = new InMemorySkillRepository();
    const create = new CreateSkill(repository, fakeParser);
    const first = await create.execute({ raw: "one" });
    await create.execute({ raw: "two" });

    await new ArchiveSkill(repository).execute(first.data!.id);

    const active = await new ListSkills(repository).execute();
    expect(active.data).toHaveLength(1);

    const all = await new ListSkills(repository).execute({ includeArchived: true });
    expect(all.data).toHaveLength(2);
  });
});

describe("ResolveStepSkills", () => {
  let repository: InMemorySkillRepository;

  beforeEach(() => {
    repository = new InMemorySkillRepository();
  });

  it("resolves references in author order, then appends the inline skill", async () => {
    const create = new CreateSkill(repository, fakeParser);
    const a = await create.execute({ raw: "alpha body" });
    const b = await create.execute({ raw: "beta body" });

    const config = conversationalConfig({
      skillRefs: [b.data!.id, a.data!.id],
      inlineSkill: {
        name: "Inline",
        description: null,
        body: "inline body",
        allowedTools: [],
        frontmatter: {},
      },
    });

    const result = await new ResolveStepSkills(repository).execute(config);

    expect(result.data?.map((skill) => skill.name)).toEqual([
      "Parsed Name",
      "Parsed Name",
      "Inline",
    ]);
    expect(result.data?.[2]?.body).toBe("inline body");
  });

  it("drops archived references silently", async () => {
    const create = new CreateSkill(repository, fakeParser);
    const a = await create.execute({ raw: "alpha" });
    await new ArchiveSkill(repository).execute(a.data!.id);

    const result = await new ResolveStepSkills(repository).execute(
      conversationalConfig({ skillRefs: [a.data!.id] }),
    );

    expect(result.data).toEqual([]);
  });

  it("returns an empty list when the step has no skills", async () => {
    const result = await new ResolveStepSkills(repository).execute(conversationalConfig({}));
    expect(result.data).toEqual([]);
  });
});
