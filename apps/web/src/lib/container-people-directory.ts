import {
  AiColumnMappingDetector,
  GraphClient,
  GraphPeopleDirectory,
  GraphReportingLineResolver,
  HrPeopleDirectory,
  SpreadsheetParser,
  UserPeopleDirectory,
} from "@rbrasier/adapters";
import { ImportHrDataset, SearchPeople, SetColumnMapping } from "@rbrasier/application";
import type { IHrDatasetRepository, ILanguageModel, IUserRepository } from "@rbrasier/domain";
import type { ServerEnv } from "./env";

interface PeopleDirectoryDependencies {
  env: ServerEnv;
  hrDatasets: IHrDatasetRepository;
  users: IUserRepository;
  languageModel: ILanguageModel;
}

// The people-directory / reporting-line wiring (approver resolution, HR import),
// factored out of container.ts to keep that file under the source-size ratchet.
// Reuses the Email-Notifications M365 app registration (ADR-018), degrading to
// HR/manual resolution when the added Graph scopes are not yet consented.
export const buildPeopleDirectory = ({
  env,
  hrDatasets,
  users,
  languageModel,
}: PeopleDirectoryDependencies) => {
  const graphConfig =
    env.M365_TENANT_ID && env.M365_CLIENT_ID && env.M365_CLIENT_SECRET
      ? {
          tenantId: env.M365_TENANT_ID,
          clientId: env.M365_CLIENT_ID,
          clientSecret: env.M365_CLIENT_SECRET,
        }
      : null;
  const graphClient = new GraphClient(graphConfig);
  const spreadsheetParser = new SpreadsheetParser();
  const graphPeopleDirectory = new GraphPeopleDirectory(graphClient);
  const hrPeopleDirectory = new HrPeopleDirectory(hrDatasets);
  const userPeopleDirectory = new UserPeopleDirectory(users);

  return {
    spreadsheetParser,
    graphClient,
    graphPeopleDirectory,
    hrPeopleDirectory,
    userPeopleDirectory,
    reportingLineResolver: new GraphReportingLineResolver(graphClient, hrDatasets, users),
    useCases: {
      // Accounts first: they are the people who can actually act on what they
      // are sent, and ranking makes them win a de-dupe against the same address
      // from Entra or HR. The external directories augment the list (ADR-018).
      searchPeople: new SearchPeople([userPeopleDirectory, graphPeopleDirectory, hrPeopleDirectory]),
      importHrDataset: new ImportHrDataset(spreadsheetParser, hrDatasets, new AiColumnMappingDetector(languageModel)),
      setColumnMapping: new SetColumnMapping(hrDatasets),
    },
  };
};
