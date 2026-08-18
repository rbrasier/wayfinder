import {
  domainError,
  err,
  ok,
  probeFieldNames,
  validateNewLookupSource,
  type ILookupSourceRepository,
  type IValueSetProvider,
  type LookupSource,
  type LookupSourceConfig,
  type LookupSourceKind,
  type NewLookupSource,
  type Result,
  type TemplateField,
  type ValueSetEntry,
} from "@rbrasier/domain";

export class ListLookupSources {
  constructor(private readonly sources: ILookupSourceRepository) {}

  async execute(): Promise<Result<LookupSource[]>> {
    return this.sources.list();
  }
}

export class RegisterLookupSource {
  constructor(private readonly sources: ILookupSourceRepository) {}

  async execute(input: NewLookupSource): Promise<Result<LookupSource>> {
    const validated = validateNewLookupSource(input);
    if (validated.error) return validated;

    const existing = await this.sources.findByName(validated.data.name);
    if (existing.error) return existing;
    if (existing.data) {
      return err(
        domainError(
          "ALREADY_EXISTS",
          `A lookup source named "${validated.data.name}" already exists. Names are how templates reference a source, so they must be unique.`,
        ),
      );
    }

    return this.sources.create(validated.data);
  }
}

export class UpdateLookupSource {
  constructor(private readonly sources: ILookupSourceRepository) {}

  async execute(id: string, input: NewLookupSource): Promise<Result<LookupSource>> {
    const validated = validateNewLookupSource(input);
    if (validated.error) return validated;

    const existing = await this.sources.findById(id);
    if (existing.error) return existing;
    if (!existing.data) {
      return err(domainError("NOT_FOUND", `Lookup source "${id}" does not exist.`));
    }

    const nameHolder = await this.sources.findByName(validated.data.name);
    if (nameHolder.error) return nameHolder;
    if (nameHolder.data && nameHolder.data.id !== id) {
      return err(
        domainError(
          "ALREADY_EXISTS",
          `A lookup source named "${validated.data.name}" already exists.`,
        ),
      );
    }

    return this.sources.update(id, validated.data);
  }
}

export class DeleteLookupSource {
  constructor(private readonly sources: ILookupSourceRepository) {}

  async execute(id: string): Promise<Result<void>> {
    const existing = await this.sources.findById(id);
    if (existing.error) return existing;
    if (!existing.data) {
      return err(domainError("NOT_FOUND", `Lookup source "${id}" does not exist.`));
    }

    return this.sources.deleteById(id);
  }
}

export interface TestLookupSourceInput {
  kind: LookupSourceKind;
  config: LookupSourceConfig;
  credentialRef?: string;
  // Absent on the first Test: the admin has not chosen the fields yet, and
  // `fields` is what tells them what there is to choose from (ADR-050 §2b).
  displayField?: string;
  keyField?: string;
}

export interface TestLookupSourceResult {
  fields: string[];
  sample: Array<Record<string, string>>;
  // Populated once a display field is chosen, so the admin verifies the mapping
  // against real records before saving.
  preview: ValueSetEntry[];
}

const missingFieldError = (fieldName: string, available: string[]) =>
  domainError(
    "VALIDATION_FAILED",
    `The source has no field named "${fieldName}". It returns: ${available.join(", ") || "no fields"}.`,
  );

// Fetches a sample so an admin can see what the source returns, pick which field
// is the display and which is the key, and check the mapping before the source
// is saved. Runs against a draft config, not a registered name.
export class TestLookupSource {
  constructor(private readonly valueSetProvider: IValueSetProvider) {}

  async execute(input: TestLookupSourceInput): Promise<Result<TestLookupSourceResult>> {
    const probed = await this.valueSetProvider.probe({
      kind: input.kind,
      config: input.config,
      ...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
    });
    if (probed.error) return probed;

    const fields = probed.data.fields.length > 0 ? probed.data.fields : probeFieldNames(probed.data.sample);
    const sample = probed.data.sample;

    if (!input.displayField) {
      return ok({ fields, sample, preview: [] });
    }

    if (!fields.includes(input.displayField)) {
      return err(missingFieldError(input.displayField, fields));
    }
    if (input.keyField && !fields.includes(input.keyField)) {
      return err(missingFieldError(input.keyField, fields));
    }

    const preview = sample.map((record) => {
      const key = input.keyField ? record[input.keyField] : undefined;
      return {
        display: record[input.displayField!] ?? "",
        ...(key ? { key } : {}),
      };
    });

    return ok({ fields, sample, preview });
  }
}

// Checked at template upload, so an author who mistypes a source name learns of
// it while editing the template rather than an operator hitting it mid-session
// (ADR-050 §1).
export class ValidateTemplateLookupSources {
  constructor(private readonly sources: ILookupSourceRepository) {}

  async execute(fields: TemplateField[]): Promise<Result<void>> {
    const names = [
      ...new Set(
        fields
          .flatMap((field) => [field, ...(field.itemFields ?? [])])
          .map((field) => field.optionsSource)
          .filter((name): name is string => !!name),
      ),
    ];

    const unknown: string[] = [];
    for (const name of names) {
      const found = await this.sources.findByName(name);
      if (found.error) return found;
      if (!found.data) unknown.push(name);
    }

    if (unknown.length === 0) return ok(undefined);

    return err(
      domainError(
        "VALIDATION_FAILED",
        `This template references lookup sources that are not registered: ${unknown.join(", ")}. Add them under Configuration, or correct the tag.`,
      ),
    );
  }
}
