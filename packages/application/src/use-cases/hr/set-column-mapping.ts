import {
  domainError,
  err,
  type HrColumnMapping,
  type HrDataset,
  type IHrDatasetRepository,
  type Result,
} from "@rbrasier/domain";

export interface SetColumnMappingInput {
  datasetId: string;
  mapping: HrColumnMapping;
}

export class SetColumnMapping {
  constructor(private readonly datasets: IHrDatasetRepository) {}

  async execute(input: SetColumnMappingInput): Promise<Result<HrDataset>> {
    const datasetResult = await this.datasets.findDatasetById(input.datasetId);
    if (datasetResult.error) return datasetResult;
    const dataset = datasetResult.data;
    if (!dataset) {
      return err(domainError("NOT_FOUND", `HR dataset ${input.datasetId} not found.`));
    }

    const unknownHeader = Object.keys(input.mapping).find(
      (header) => !dataset.columns.includes(header),
    );
    if (unknownHeader) {
      return err(
        domainError("VALIDATION_FAILED", `Header '${unknownHeader}' is not in the dataset.`),
      );
    }

    return this.datasets.setColumnMapping(input.datasetId, input.mapping);
  }
}
