import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";
import type { TemplateField } from "./template-field";

const splitMultiValue = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const validateOptions = (field: TemplateField, value: string): Result<string> => {
  const selected = field.multiple ? splitMultiValue(value) : [value];
  const matched = selected.map((candidate) =>
    field.options?.find((option) => option.toLowerCase() === candidate.toLowerCase()),
  );

  if (matched.some((option) => option === undefined)) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${field.label}" must be ${field.multiple ? "values" : "one"} of: ${field.options?.join(", ")}.`,
      ),
    );
  }

  const canonical = matched as string[];
  if (field.multiple && field.max !== undefined && canonical.length > field.max) {
    return err(
      domainError("VALIDATION_FAILED", `"${field.label}" allows at most ${field.max} values.`),
    );
  }

  return ok(field.multiple ? canonical.join(", ") : canonical[0]!);
};

const validateYesNo = (field: TemplateField, value: string): Result<string> => {
  const lower = value.toLowerCase();
  if (lower === "yes") return ok("Yes");
  if (lower === "no") return ok("No");
  return err(domainError("VALIDATION_FAILED", `"${field.label}" must be either Yes or No.`));
};

const validateNumber = (field: TemplateField, value: string): Result<string> => {
  const numeric = Number(value.replace(/[$,\s]/g, ""));
  if (Number.isNaN(numeric)) {
    return err(domainError("VALIDATION_FAILED", `"${field.label}" must be a number.`));
  }
  if (field.min !== undefined && numeric < field.min) {
    return err(domainError("VALIDATION_FAILED", `"${field.label}" must be at least ${field.min}.`));
  }
  if (field.max !== undefined && numeric > field.max) {
    return err(domainError("VALIDATION_FAILED", `"${field.label}" must be at most ${field.max}.`));
  }
  return ok(value);
};

// Pure value-level validation for a single edited field. Mirrors the
// TemplateFieldType vocabulary used at generation time and never throws — it
// returns the canonicalised value (trimmed, Yes/No normalised, options matched
// to their declared casing) or a VALIDATION_FAILED DomainError.
export const validateTemplateFieldValue = (
  field: TemplateField,
  rawValue: string,
): Result<string> => {
  const value = rawValue.trim();

  if (value === "") {
    if (field.optional || field.type === "section") return ok("");
    return err(domainError("VALIDATION_FAILED", `"${field.label}" is required.`));
  }

  // Reached only if a caller bypasses nodeFieldSet's filter. A signature typed
  // by anyone other than the decision path is a forged signature.
  if (field.type === "signature") {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${field.label}" is filled by its approval step and cannot be entered manually.`,
      ),
    );
  }

  if (field.maxLength !== undefined && value.length > field.maxLength) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${field.label}" must be ${field.maxLength} characters or fewer.`,
      ),
    );
  }

  if (field.options && field.options.length > 0) {
    return validateOptions(field, value);
  }

  switch (field.type) {
    case "email":
      return /.+@.+\..+/.test(value)
        ? ok(value)
        : err(domainError("VALIDATION_FAILED", `"${field.label}" must be a valid email address.`));
    case "number":
    case "currency":
      return validateNumber(field, value);
    case "yesno":
    case "section":
      return validateYesNo(field, value);
    default:
      return ok(value);
  }
};
