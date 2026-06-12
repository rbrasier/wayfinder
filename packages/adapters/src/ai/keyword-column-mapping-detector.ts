import { ok, type HrColumnMapping, type HrFieldKind, type IColumnMappingDetector, type Result } from "@rbrasier/domain";

// Ordered so the first matching rule wins — manager is tested before name so a
// "Manager Name" column resolves to `manager` rather than `name`.
const RULES: { kind: HrFieldKind; pattern: RegExp }[] = [
  { kind: "email", pattern: /e-?mail/ },
  { kind: "manager", pattern: /manager|supervisor|reports?\s*to/ },
  { kind: "position", pattern: /position|\btitle\b|\brole\b/ },
  { kind: "band", pattern: /\bband\b|\bgrade\b|\blevel\b/ },
  { kind: "unit", pattern: /\bunit\b|department|division|\bteam\b|\bbranch\b/ },
  { kind: "name", pattern: /name/ },
];

// Keyword-heuristic detector used in tests so no unit test ever hits a real LLM.
// Production wiring uses AiColumnMappingDetector instead.
export class KeywordColumnMappingDetector implements IColumnMappingDetector {
  async detect(input: { headers: string[] }): Promise<Result<HrColumnMapping>> {
    const mapping: HrColumnMapping = {};
    for (const header of input.headers) {
      const normalised = header.toLowerCase();
      const rule = RULES.find((candidate) => candidate.pattern.test(normalised));
      if (rule) mapping[header] = rule.kind;
    }
    return ok(mapping);
  }
}
