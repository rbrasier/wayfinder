import {
  ok,
  type HrColumnMapping,
  type HrDataset,
  type HrRow,
  type IHrDatasetRepository,
  type IPeopleDirectory,
  type PeopleSearchInput,
  type Person,
  type Result,
} from "@rbrasier/domain";

// header for a given canonical field within one dataset's mapping.
const headerFor = (mapping: HrColumnMapping, field: string): string | null => {
  const entry = Object.entries(mapping).find(([, kind]) => kind === field);
  return entry?.[0] ?? null;
};

export const hrRowToPerson = (row: HrRow, mapping: HrColumnMapping): Person | null => {
  const emailHeader = headerFor(mapping, "email");
  const email = emailHeader ? row.data[emailHeader] : undefined;
  if (!email) return null;
  const nameHeader = headerFor(mapping, "name");
  const positionHeader = headerFor(mapping, "position");
  const unitHeader = headerFor(mapping, "unit");
  return {
    source: "hr",
    directoryId: row.id,
    userId: null,
    displayName: nameHeader ? row.data[nameHeader] ?? null : null,
    email,
    jobTitle: positionHeader ? row.data[positionHeader] ?? null : null,
    department: unitHeader ? row.data[unitHeader] ?? null : null,
  };
};

// People search over the uploaded HR dataset. Rows are read through each
// dataset's column mapping; a row with no mapped email cannot be a candidate.
export class HrPeopleDirectory implements IPeopleDirectory {
  constructor(private readonly datasets: IHrDatasetRepository) {}

  async search(input: PeopleSearchInput): Promise<Result<Person[]>> {
    const rowsResult = await this.datasets.searchRows(input);
    if (rowsResult.error) return rowsResult;

    const datasetsResult = await this.datasets.listDatasets();
    if (datasetsResult.error) return datasetsResult;
    const mappingByDataset = new Map<string, HrColumnMapping>(
      datasetsResult.data.map((dataset: HrDataset) => [dataset.id, dataset.columnMapping]),
    );

    const people: Person[] = [];
    for (const row of rowsResult.data) {
      const mapping = mappingByDataset.get(row.datasetId) ?? {};
      const person = hrRowToPerson(row, mapping);
      if (person) people.push(person);
    }
    return ok(people.slice(0, input.limit));
  }
}
