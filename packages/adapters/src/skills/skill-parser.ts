import { domainError, err, ok, type ISkillParser, type ParsedSkill, type Result } from "@rbrasier/domain";

// Dependency-free SKILL.md parser. Honours only what ADR-031 needs — frontmatter
// scalars, an `allowed-tools` list, and the markdown body. Bundled scripts/assets
// referenced by the skill are ignored entirely; a skill is text, not code.
export class SkillParser implements ISkillParser {
  parse(raw: string): Result<ParsedSkill> {
    if (raw.trim().length === 0) {
      return err(domainError("VALIDATION_FAILED", "Skill file is empty."));
    }

    const { frontmatter, body } = splitFrontmatter(raw);

    const name = (frontmatter.name ?? firstHeading(body) ?? "").trim();
    if (name.length === 0) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          "Skill must declare a name in its frontmatter or a top-level heading.",
        ),
      );
    }

    const trimmedBody = body.trim();
    if (trimmedBody.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Skill body is empty."));
    }

    const description = frontmatter.description?.trim() ? frontmatter.description.trim() : null;

    return ok({
      name,
      description,
      body: trimmedBody,
      allowedTools: parseAllowedTools(frontmatter["allowed-tools"]),
      frontmatter,
    });
  }
}

function splitFrontmatter(raw: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: {}, body: raw.replace(/\r\n/g, "\n") };
  }

  let closeIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      closeIndex = index;
      break;
    }
  }
  if (closeIndex === -1) {
    return { frontmatter: {}, body: raw.replace(/\r\n/g, "\n") };
  }

  return {
    frontmatter: parseFrontmatterLines(lines.slice(1, closeIndex)),
    body: lines.slice(closeIndex + 1).join("\n"),
  };
}

function parseFrontmatterLines(lines: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  let listKey: string | null = null;
  let listItems: string[] = [];

  const flushList = () => {
    if (listKey) {
      result[listKey] = listItems.join(", ");
      listKey = null;
      listItems = [];
    }
  };

  for (const line of lines) {
    if (listKey && /^\s*-\s+/.test(line)) {
      listItems.push(stripQuotes(line.replace(/^\s*-\s+/, "").trim()));
      continue;
    }

    flushList();

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    const key = match?.[1];
    if (!key) continue;

    const value = (match?.[2] ?? "").trim();
    if (value.length === 0) {
      listKey = key;
      result[key] = "";
      continue;
    }
    result[key] = stripQuotes(value);
  }

  flushList();
  return result;
}

function parseAllowedTools(value: string | undefined): string[] {
  if (!value) return [];
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map((entry) => stripQuotes(entry.trim()))
    .filter((entry) => entry.length > 0);
}

function firstHeading(body: string): string | null {
  const match = body.match(/^#{1,6}\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
