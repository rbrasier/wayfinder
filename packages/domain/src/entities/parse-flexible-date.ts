// Builds a UTC-midnight date from calendar parts, rejecting impossible dates
// (e.g. 31-02) that the Date constructor would otherwise roll forward.
const buildUtcDate = (year: number, month: number, day: number): Date | null => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  const rolledOver =
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day;
  return rolledOver ? null : date;
};

// Parses a date string that may be in Wayfinder's day-first display format
// (DD-MM-YYYY or DD/MM/YYYY, how date fields are collected and rendered — see
// describeTemplateFieldFormat) or any format the Date constructor already
// accepts (ISO 8601). Day-first is assumed for ambiguous slash/dash dates
// because the app never presents month-first. Returns null when the value
// cannot be interpreted as a date.
export const parseFlexibleDate = (raw: string): Date | null => {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const dayFirst = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (dayFirst) {
    return buildUtcDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
