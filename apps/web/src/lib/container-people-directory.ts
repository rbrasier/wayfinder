import {
  AiColumnMappingDetector,
  GraphClient,
  GraphPeopleDirectory,
  GraphReportingLineResolver,
  HrPeopleDirectory,
  SpreadsheetParser,
  UserPeopleDirectory,
  type RuntimeConfigStore,
} from "@rbrasier/adapters";
import { ImportHrDataset, SearchPeople, SetColumnMapping } from "@rbrasier/application";
import type { IHrDatasetRepository, ILanguageModel, IUserRepository } from "@rbrasier/domain";
import type { ServerEnv } from "./env";

interface PeopleDirectoryDependencies {
  env: ServerEnv;
  hrDatasets: IHrDatasetRepository;
  users: IUserRepository;
  runtimeConfig: RuntimeConfigStore;
  languageModel: ILanguageModel;
}

// The people-directory / reporting-line wiring (approver resolution, HR import),
// factored out of container.ts to keep that file under the source-size ratchet.
//
// Credentials are resolved per request from runtime config, not read once here,
// so an admin can switch the directory on or re-point it at another app
// registration from /admin/settings without a redeploy. The two host overrides
// are the exception: they stay in the environment, because they decide where a
// client secret is sent (ADR-018, and the split ADR-042 draws for PKI).
export const buildPeopleDirectory = ({
  env,
  hrDatasets,
  users,
  runtimeConfig,
  languageModel,
}: PeopleDirectoryDependencies) => {
  const graphClient = new GraphClient(async () => {
    const credentials = await runtimeConfig.getDirectoryCredentials();
    if (!credentials) return null;
    return {
      ...credentials,
      baseUrl: env.M365_GRAPH_BASE_URL,
      authority: env.M365_AUTHORITY,
    };
  });
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
      importHrDataset: new ImportHrDataset(
        spreadsheetParser,
        hrDatasets,
        new AiColumnMappingDetector(languageModel),
      ),
      setColumnMapping: new SetColumnMapping(hrDatasets),
    },
  };
};
