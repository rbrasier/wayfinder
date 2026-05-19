/**
 * Creates example DOCX templates for Phase 3 document generation.
 * Run: node docs/templates/create-templates.mjs
 */
import PizZip from "pizzip";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const buildDocx = (xmlBody) => {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${xmlBody}</w:body>
</w:document>`,
  );
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
};

const para = (text) =>
  `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const heading = (text) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const rftBody = [
  heading("Request for Tender"),
  para("{project_title}"),
  heading("1. Background"),
  para("{background}"),
  heading("2. Scope of Work"),
  para("{scope}"),
  heading("3. Evaluation Criteria"),
  para("{evaluation_criteria}"),
  heading("4. Conditions of Contract"),
  para("{conditions}"),
  heading("5. Timeframes"),
  para("{timeframes}"),
  heading("6. Contact Information"),
  para("{contact_details}"),
].join("\n");

const evalBody = [
  heading("Evaluation Report"),
  para("Evaluation Date: {evaluation_date}"),
  para("Panel Members: {panel_members}"),
  heading("1. Executive Summary"),
  para("{executive_summary}"),
  heading("2. Evaluation Findings"),
  para("{evaluation_findings}"),
  heading("3. Recommendations"),
  para("{recommendations}"),
  heading("4. Decision"),
  para("{decision}"),
].join("\n");

const cmpBody = [
  heading("Contract Management Plan"),
  para("Contract Title: {contract_title}"),
  para("Supplier: {supplier}"),
  para("Contract Value: {contract_value}"),
  heading("1. Contract Overview"),
  para("{contract_overview}"),
  heading("2. Key Performance Indicators"),
  para("{kpi_table}"),
  heading("3. Risk Management"),
  para("{risk_management}"),
  heading("4. Reporting Requirements"),
  para("{reporting_requirements}"),
  heading("5. Variation and Dispute Resolution"),
  para("{dispute_resolution}"),
].join("\n");

mkdirSync(__dirname, { recursive: true });

writeFileSync(join(__dirname, "rft-template.docx"), buildDocx(rftBody));
console.log("Created rft-template.docx");

writeFileSync(join(__dirname, "evaluation-report-template.docx"), buildDocx(evalBody));
console.log("Created evaluation-report-template.docx");

writeFileSync(join(__dirname, "contract-management-plan-template.docx"), buildDocx(cmpBody));
console.log("Created contract-management-plan-template.docx");
