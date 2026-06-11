import { desc, eq, sql } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type HrColumnMapping,
  type HrDataset,
  type HrRow,
  type HrRowSearchInput,
  type IHrDatasetRepository,
  type NewHrDataset,
  type NewHrRow,
  type Result,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { admin_hr_datasets, admin_hr_rows } from "../db/schema/admin";

const toDataset = (row: typeof admin_hr_datasets.$inferSelect): HrDataset => ({
  id: row.id,
  filename: row.filename,
  sourceFormat: row.source_format,
  uploadedByUserId: row.uploaded_by_user_id,
  columns: (row.columns as string[] | null) ?? [],
  columnMapping: (row.column_mapping as HrColumnMapping | null) ?? {},
  rowCount: row.row_count,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toRow = (row: typeof admin_hr_rows.$inferSelect): HrRow => ({
  id: row.id,
  datasetId: row.dataset_id,
  rowIndex: row.row_index,
  data: (row.data as Record<string, string> | null) ?? {},
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleHrDatasetRepository implements IHrDatasetRepository {
  constructor(private readonly db: Database) {}

  async createDataset(input: NewHrDataset): Promise<Result<HrDataset>> {
    try {
      const [row] = await this.db
        .insert(admin_hr_datasets)
        .values({
          filename: input.filename,
          source_format: input.sourceFormat,
          uploaded_by_user_id: input.uploadedByUserId,
          columns: input.columns,
          column_mapping: input.columnMapping ?? {},
          row_count: input.rowCount,
          status: input.status ?? "active",
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "HR dataset insert returned no row."));
      return ok(toDataset(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create HR dataset.", cause));
    }
  }

  async findDatasetById(id: string): Promise<Result<HrDataset | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(admin_hr_datasets)
        .where(eq(admin_hr_datasets.id, id));
      return ok(row ? toDataset(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find HR dataset.", cause));
    }
  }

  async listDatasets(): Promise<Result<HrDataset[]>> {
    try {
      const rows = await this.db
        .select()
        .from(admin_hr_datasets)
        .orderBy(desc(admin_hr_datasets.created_at));
      return ok(rows.map(toDataset));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list HR datasets.", cause));
    }
  }

  async setColumnMapping(id: string, mapping: HrColumnMapping): Promise<Result<HrDataset>> {
    try {
      const [row] = await this.db
        .update(admin_hr_datasets)
        .set({ column_mapping: mapping, updated_at: new Date() })
        .where(eq(admin_hr_datasets.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `HR dataset ${id} not found.`));
      return ok(toDataset(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to set HR column mapping.", cause));
    }
  }

  async insertRows(rows: NewHrRow[]): Promise<Result<number>> {
    if (rows.length === 0) return ok(0);
    try {
      const inserted = await this.db
        .insert(admin_hr_rows)
        .values(
          rows.map((row) => ({
            dataset_id: row.datasetId,
            row_index: row.rowIndex,
            data: row.data,
          })),
        )
        .returning({ id: admin_hr_rows.id });
      return ok(inserted.length);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to insert HR rows.", cause));
    }
  }

  async listRows(datasetId: string): Promise<Result<HrRow[]>> {
    try {
      const rows = await this.db
        .select()
        .from(admin_hr_rows)
        .where(eq(admin_hr_rows.dataset_id, datasetId))
        .orderBy(admin_hr_rows.row_index);
      return ok(rows.map(toRow));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list HR rows.", cause));
    }
  }

  async searchRows(input: HrRowSearchInput): Promise<Result<HrRow[]>> {
    const needle = input.query.trim().toLowerCase();
    if (!needle) return ok([]);
    try {
      // The jsonb is cast to text and matched case-insensitively. The GIN index
      // on `data` keeps this cheap as the dataset grows; exact-key search can be
      // layered on later via the column mapping.
      const rows = await this.db
        .select()
        .from(admin_hr_rows)
        .where(sql`lower(${admin_hr_rows.data}::text) like ${`%${needle}%`}`)
        .limit(input.limit);
      return ok(rows.map(toRow));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to search HR rows.", cause));
    }
  }
}
