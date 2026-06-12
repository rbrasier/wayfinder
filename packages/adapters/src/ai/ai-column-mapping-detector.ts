import {
  ok,
  type HrColumnMapping,
  type HrFieldKind,
  type IColumnMappingDetector,
  type ILanguageModel,
  type Result,
} from "@rbrasier/domain";
import { z } from "zod";

const FIELD_KINDS = ["email", "name", "manager", "position", "band", "unit"] as const;

const mappingSchema = z.record(z.enum(FIELD_KINDS));

const SYSTEM_PROMPT = [
  "You map the column headers of an uploaded HR spreadsheet to canonical field kinds.",
  "The kinds are: email, name, manager, position, band, unit.",
  "Map each header to exactly one kind. Omit any header that does not clearly belong",
  "to a kind (for example an employee id, a start date, or salary).",
  "Return a JSON object keyed by the original header string, valued by the kind.",
].join(" ");

// Single bounded generateObject call — given the headers (and up to 3 sample rows
// for disambiguation) the model returns a header→kind record. Any header the
// model invents that is not in the input, or any non-kind value, is dropped so
// the stored mapping is always well-formed.
export class AiColumnMappingDetector implements IColumnMappingDetector {
  constructor(private readonly languageModel: ILanguageModel) {}

  async detect(input: {
    headers: string[];
    sampleRows: Record<string, string>[];
  }): Promise<Result<HrColumnMapping>> {
    const samples = input.sampleRows.slice(0, 3);
    const prompt = [
      `Column headers: ${JSON.stringify(input.headers)}.`,
      samples.length > 0 ? `Sample rows: ${JSON.stringify(samples)}.` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await this.languageModel.generateObject<Record<string, string>>({
      purpose: "column-mapping",
      system: SYSTEM_PROMPT,
      prompt,
      schema: mappingSchema,
      temperature: 0,
    });
    if (result.error) return result;

    return ok(this.sanitise(input.headers, result.data.object));
  }

  private sanitise(headers: string[], raw: Record<string, string>): HrColumnMapping {
    const known = new Set<string>(FIELD_KINDS);
    const headerSet = new Set(headers);
    const mapping: HrColumnMapping = {};
    for (const [header, kind] of Object.entries(raw)) {
      if (headerSet.has(header) && known.has(kind)) {
        mapping[header] = kind as HrFieldKind;
      }
    }
    return mapping;
  }
}
