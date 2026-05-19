import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import InspectModule from "docxtemplater/js/inspect-module.js";
import { domainError, err, ok } from "@rbrasier/domain";
import type { IDocumentGenerator, ExtractTagsInput, ExtractTagsOutput, GenerateDocxInput, GenerateDocxOutput } from "@rbrasier/domain";
import type { Result } from "@rbrasier/domain";

export class DocxGenerator implements IDocumentGenerator {
  extractTags(input: ExtractTagsInput): Result<ExtractTagsOutput> {
    try {
      const zip = new PizZip(input.templateBytes);
      const inspectModule = new InspectModule();
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        modules: [inspectModule],
      });
      doc.compile();
      const tagMap = inspectModule.getAllTags() as Record<string, unknown>;
      const tags = Object.keys(tagMap);
      return ok({ tags });
    } catch (cause) {
      return err(domainError("VALIDATION_FAILED", "Failed to parse DOCX template. Ensure the file is a valid .docx and all {{tags}} are correctly formed.", cause));
    }
  }

  generate(input: GenerateDocxInput): Result<GenerateDocxOutput> {
    try {
      const zip = new PizZip(input.templateBytes);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
      });
      doc.render(input.data);
      const docxBytes = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
      return ok({ docxBytes });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to generate DOCX from template.", cause));
    }
  }
}
