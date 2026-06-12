import { describe, it, expect } from "vitest";
import {
  domainError,
  err,
  ok,
  type HrColumnMapping,
  type HrDataset,
  type HrRow,
  type HrRowSearchInput,
  type IColumnMappingDetector,
  type IHrDatasetRepository,
  type ISpreadsheetParser,
  type NewHrDataset,
  type NewHrRow,
  type ParsedSpreadsheet,
  type ParseSpreadsheetInput,
  type Result,
} from "@rbrasier/domain";
import { ImportHrDataset } from "./import-hr-dataset";
import { SetColumnMapping } from "./set-column-mapping";

class InMemoryHrDatasets implements IHrDatasetRepository {
  datasets = new Map<string, HrDataset>();
  rows: HrRow[] = [];

  async createDataset(input: NewHrDataset): Promise<Result<HrDataset>> {
    const now = new Date();
    const dataset: HrDataset = {
      id: `ds-${this.datasets.size + 1}`,
      filename: input.filename,
      sourceFormat: input.sourceFormat,
      uploadedByUserId: input.uploadedByUserId,
      columns: input.columns,
      columnMapping: input.columnMapping ?? {},
      rowCount: input.rowCount,
      status: input.status ?? "active",
      createdAt: now,
      updatedAt: now,
    };
    this.datasets.set(dataset.id, dataset);
    return ok(dataset);
  }

  async findDatasetById(id: string): Promise<Result<HrDataset | null>> {
    return ok(this.datasets.get(id) ?? null);
  }

  async listDatasets(): Promise<Result<HrDataset[]>> {
    return ok([...this.datasets.values()]);
  }

  async setColumnMapping(id: string, mapping: HrColumnMapping): Promise<Result<HrDataset>> {
    const dataset = this.datasets.get(id);
    if (!dataset) return err(domainError("NOT_FOUND", `HR dataset ${id} not found.`));
    const next: HrDataset = { ...dataset, columnMapping: mapping, updatedAt: new Date() };
    this.datasets.set(id, next);
    return ok(next);
  }

  async insertRows(rows: NewHrRow[]): Promise<Result<number>> {
    const now = new Date();
    for (const row of rows) {
      this.rows.push({
        id: `row-${this.rows.length + 1}`,
        datasetId: row.datasetId,
        rowIndex: row.rowIndex,
        data: row.data,
        createdAt: now,
        updatedAt: now,
      });
    }
    return ok(rows.length);
  }

  async listRows(datasetId: string): Promise<Result<HrRow[]>> {
    return ok(this.rows.filter((row) => row.datasetId === datasetId));
  }

  async searchRows(input: HrRowSearchInput): Promise<Result<HrRow[]>> {
    const needle = input.query.trim().toLowerCase();
    const matches = this.rows.filter((row) =>
      Object.values(row.data).some((value) => value.toLowerCase().includes(needle)),
    );
    return ok(matches.slice(0, input.limit));
  }
}

class StubParser implements ISpreadsheetParser {
  constructor(private readonly parsed: ParsedSpreadsheet) {}
  async parse(_input: ParseSpreadsheetInput): Promise<Result<ParsedSpreadsheet>> {
    return ok(this.parsed);
  }
}

class FailingParser implements ISpreadsheetParser {
  async parse(_input: ParseSpreadsheetInput): Promise<Result<ParsedSpreadsheet>> {
    return err(domainError("VALIDATION_FAILED", "corrupt file"));
  }
}

class StubDetector implements IColumnMappingDetector {
  calls: { headers: string[]; sampleRows: Record<string, string>[] }[] = [];
  constructor(private readonly mapping: HrColumnMapping) {}
  async detect(input: {
    headers: string[];
    sampleRows: Record<string, string>[];
  }): Promise<Result<HrColumnMapping>> {
    this.calls.push(input);
    return ok(this.mapping);
  }
}

class FailingDetector implements IColumnMappingDetector {
  async detect(): Promise<Result<HrColumnMapping>> {
    return err(domainError("AI_PROVIDER_FAILED", "model unavailable"));
  }
}

describe("ImportHrDataset", () => {
  it("stores the dataset and rows as-uploaded with detected columns", async () => {
    const repository = new InMemoryHrDatasets();
    const parser = new StubParser({
      columns: ["Full Name", "Email", "Manager"],
      rows: [
        { "Full Name": "Ada Lovelace", Email: "ada@corp.test", Manager: "bob@corp.test" },
        { "Full Name": "Bob Stone", Email: "bob@corp.test", Manager: "" },
      ],
    });
    const sut = new ImportHrDataset(parser, repository);

    const result = await sut.execute({
      filename: "people.csv",
      format: "csv",
      content: new Uint8Array(),
      uploadedByUserId: "admin-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.columns).toEqual(["Full Name", "Email", "Manager"]);
    expect(result.data?.rowCount).toBe(2);
    const stored = await repository.listRows(result.data!.id);
    expect(stored.data?.[0]?.data).toEqual({
      "Full Name": "Ada Lovelace",
      Email: "ada@corp.test",
      Manager: "bob@corp.test",
    });
  });

  it("rejects a file with no columns", async () => {
    const sut = new ImportHrDataset(new StubParser({ columns: [], rows: [] }), new InMemoryHrDatasets());

    const result = await sut.execute({
      filename: "empty.csv",
      format: "csv",
      content: new Uint8Array(),
      uploadedByUserId: "admin-1",
    });

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("surfaces a parser failure", async () => {
    const sut = new ImportHrDataset(new FailingParser(), new InMemoryHrDatasets());

    const result = await sut.execute({
      filename: "broken.xlsx",
      format: "xlsx",
      content: new Uint8Array(),
      uploadedByUserId: "admin-1",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("calls the detector when no mapping is supplied and stores the returned mapping", async () => {
    const repository = new InMemoryHrDatasets();
    const parser = new StubParser({
      columns: ["Full Name", "Email", "Manager"],
      rows: [
        { "Full Name": "Ada Lovelace", Email: "ada@corp.test", Manager: "bob@corp.test" },
        { "Full Name": "Bob Stone", Email: "bob@corp.test", Manager: "" },
      ],
    });
    const detector = new StubDetector({ Email: "email", "Full Name": "name", Manager: "manager" });
    const sut = new ImportHrDataset(parser, repository, detector);

    const result = await sut.execute({
      filename: "people.csv",
      format: "csv",
      content: new Uint8Array(),
      uploadedByUserId: "admin-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.columnMapping).toEqual({
      Email: "email",
      "Full Name": "name",
      Manager: "manager",
    });
    expect(detector.calls[0]?.headers).toEqual(["Full Name", "Email", "Manager"]);
    expect(detector.calls[0]?.sampleRows).toHaveLength(2);
  });

  it("falls back to an empty mapping when the detector returns an error", async () => {
    const repository = new InMemoryHrDatasets();
    const parser = new StubParser({
      columns: ["Full Name", "Email"],
      rows: [{ "Full Name": "Ada", Email: "ada@corp.test" }],
    });
    const sut = new ImportHrDataset(parser, repository, new FailingDetector());

    const result = await sut.execute({
      filename: "people.csv",
      format: "csv",
      content: new Uint8Array(),
      uploadedByUserId: "admin-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.columnMapping).toEqual({});
  });

  it("skips the detector when a mapping is explicitly supplied", async () => {
    const repository = new InMemoryHrDatasets();
    const parser = new StubParser({
      columns: ["Full Name", "Email"],
      rows: [{ "Full Name": "Ada", Email: "ada@corp.test" }],
    });
    const detector = new StubDetector({ Email: "email" });
    const sut = new ImportHrDataset(parser, repository, detector);

    const result = await sut.execute({
      filename: "people.csv",
      format: "csv",
      content: new Uint8Array(),
      uploadedByUserId: "admin-1",
      columnMapping: { Email: "email", "Full Name": "name" },
    });

    expect(result.data?.columnMapping).toEqual({ Email: "email", "Full Name": "name" });
    expect(detector.calls).toHaveLength(0);
  });
});

describe("SetColumnMapping", () => {
  const importDataset = async (repository: InMemoryHrDatasets) => {
    const parser = new StubParser({
      columns: ["Full Name", "Email", "Manager"],
      rows: [{ "Full Name": "Ada", Email: "ada@corp.test", Manager: "" }],
    });
    const imported = await new ImportHrDataset(parser, repository).execute({
      filename: "people.csv",
      format: "csv",
      content: new Uint8Array(),
      uploadedByUserId: "admin-1",
    });
    return imported.data!;
  };

  it("persists a header → field mapping", async () => {
    const repository = new InMemoryHrDatasets();
    const dataset = await importDataset(repository);
    const sut = new SetColumnMapping(repository);

    const mapping: HrColumnMapping = { Email: "email", "Full Name": "name", Manager: "manager" };
    const result = await sut.execute({ datasetId: dataset.id, mapping });

    expect(result.error).toBeUndefined();
    expect(result.data?.columnMapping).toEqual(mapping);
  });

  it("rejects a mapping that references an unknown header", async () => {
    const repository = new InMemoryHrDatasets();
    const dataset = await importDataset(repository);
    const sut = new SetColumnMapping(repository);

    const result = await sut.execute({
      datasetId: dataset.id,
      mapping: { Salary: "band" },
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns NOT_FOUND for a missing dataset", async () => {
    const sut = new SetColumnMapping(new InMemoryHrDatasets());

    const result = await sut.execute({ datasetId: "missing", mapping: {} });

    expect(result.error?.code).toBe("NOT_FOUND");
  });
});
