// The mock HR spreadsheet, rendered from the shared roster.
//
// Headers are deliberately *not* the canonical field names Wayfinder resolves
// through. A real agency hands over whatever its HR system exports, and
// ImportHrDataset stores a file in the structure it arrived in (ADR-018), so a
// fixture whose headers already matched the mapping would test nothing. Three
// headers have no canonical field at all — they exercise the "extra columns are
// kept as uploaded" half of that decision.

import { roster } from "../directory/roster.mjs";

export const CSV_FILENAME = "employees.csv";

export const CSV_HEADERS = [
  "Employee ID",
  "Full Name",
  "Employee Email",
  "Manager Email",
  "Job Title",
  "Grade",
  "Business Unit",
  "Location",
  "Start Date",
];

// What an operator would choose in Settings → HR Directory Data → Map columns.
// Printed by restart.sh so the mapping step is a transcription, not a puzzle.
export const SUGGESTED_COLUMN_MAPPING = {
  "Employee Email": "email",
  "Full Name": "name",
  "Manager Email": "manager",
  "Job Title": "position",
  Grade: "band",
  "Business Unit": "unit",
};

export const employeeToCsvRecord = (employee) => ({
  "Employee ID": employee.employeeId,
  "Full Name": employee.name,
  "Employee Email": employee.email,
  "Manager Email": employee.managerEmail ?? "",
  "Job Title": employee.jobTitle,
  Grade: employee.band,
  "Business Unit": employee.businessUnit,
  Location: employee.location,
  "Start Date": employee.startDate,
});

export const csvValue = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
};

const csvLine = (values) => values.map(csvValue).join(",");

export const renderCsv = () => {
  const lines = [csvLine(CSV_HEADERS)];
  for (const employee of roster) {
    const record = employeeToCsvRecord(employee);
    lines.push(csvLine(CSV_HEADERS.map((header) => record[header])));
  }
  return `${lines.join("\n")}\n`;
};
