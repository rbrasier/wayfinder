import type {
  HrColumnMapping,
  HrDataset,
  HrRow,
  NewHrDataset,
  NewHrRow,
} from "../entities/hr-dataset";
import type { Result } from "../result";

export interface HrRowSearchInput {
  query: string;
  limit: number;
}

export interface IHrDatasetRepository {
  createDataset(input: NewHrDataset): Promise<Result<HrDataset>>;
  findDatasetById(id: string): Promise<Result<HrDataset | null>>;
  listDatasets(): Promise<Result<HrDataset[]>>;
  setColumnMapping(id: string, mapping: HrColumnMapping): Promise<Result<HrDataset>>;
  insertRows(rows: NewHrRow[]): Promise<Result<number>>;
  listRows(datasetId: string): Promise<Result<HrRow[]>>;
  // Full-text-ish search over the raw `jsonb` (GIN-backed). Works regardless of
  // whether a column mapping exists yet.
  searchRows(input: HrRowSearchInput): Promise<Result<HrRow[]>>;
}
