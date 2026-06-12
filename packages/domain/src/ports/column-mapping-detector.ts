import type { HrColumnMapping } from "../entities/hr-dataset";
import type { Result } from "../result";

// Maps uploaded HR spreadsheet headers to canonical field kinds so the
// column-mapping UI arrives pre-filled for confirmation. Implementations may use
// an LLM (any naming convention) or keyword heuristics (tests). Returning a
// partial mapping is expected — headers with no clear kind are simply omitted.
export interface IColumnMappingDetector {
  detect(input: {
    headers: string[];
    // Up to 3 rows of sample values, header-keyed, for disambiguation context.
    sampleRows: Record<string, string>[];
  }): Promise<Result<HrColumnMapping>>;
}
