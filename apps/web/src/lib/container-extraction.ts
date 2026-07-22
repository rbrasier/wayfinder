import {
  CreateExtractionFlow,
  GetExtractionSchema,
  ListExtractionFlows,
  ListExtractionFlowsForUser,
  RunSampleExtraction,
  SaveExtractionSchema,
} from "@rbrasier/application";
import type {
  IDocumentExtractor,
  IFlowRepository,
  IFlowVersionRepository,
  ILanguageModel,
} from "@rbrasier/domain";

interface ExtractionDependencies {
  flows: IFlowRepository;
  flowVersions: IFlowVersionRepository;
  languageModel: ILanguageModel;
  documentExtractor: IDocumentExtractor;
}

// The extraction-flow ("Synthesise Information") use-cases (ADR-033), factored
// out of container.ts to keep that file under the source-size ratchet.
export const buildExtractionUseCases = ({
  flows,
  flowVersions,
  languageModel,
  documentExtractor,
}: ExtractionDependencies) => ({
  createExtractionFlow: new CreateExtractionFlow(flows),
  saveExtractionSchema: new SaveExtractionSchema(flows, flowVersions),
  getExtractionSchema: new GetExtractionSchema(flowVersions),
  listExtractionFlows: new ListExtractionFlows(flows),
  listExtractionFlowsForUser: new ListExtractionFlowsForUser(flows),
  runSampleExtraction: new RunSampleExtraction(languageModel, documentExtractor),
});
