import {
  GraphClient,
  GraphPeopleDirectory,
  GraphReportingLineResolver,
  HrPeopleDirectory,
  SpreadsheetParser,
  UserPeopleDirectory,
  type RuntimeConfigStore,
} from "@rbrasier/adapters";
import type { IHrDatasetRepository, IUserRepository } from "@rbrasier/domain";
import type { ServerEnv } from "./env";

interface PeopleDirectoryDependencies {
  env: ServerEnv;
  hrDatasets: IHrDatasetRepository;
  users: IUserRepository;
  runtimeConfig: RuntimeConfigStore;
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

  return {
    spreadsheetParser: new SpreadsheetParser(),
    graphClient,
    graphPeopleDirectory: new GraphPeopleDirectory(graphClient),
    hrPeopleDirectory: new HrPeopleDirectory(hrDatasets),
    userPeopleDirectory: new UserPeopleDirectory(users),
    reportingLineResolver: new GraphReportingLineResolver(graphClient, hrDatasets, users),
  };
};
