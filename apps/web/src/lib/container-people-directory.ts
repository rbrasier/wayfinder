import {
  GraphClient,
  GraphPeopleDirectory,
  GraphReportingLineResolver,
  HrPeopleDirectory,
  SpreadsheetParser,
} from "@rbrasier/adapters";
import type { IHrDatasetRepository, IUserRepository } from "@rbrasier/domain";
import type { ServerEnv } from "./env";

interface PeopleDirectoryDependencies {
  env: ServerEnv;
  hrDatasets: IHrDatasetRepository;
  users: IUserRepository;
}

// The people-directory / reporting-line wiring (approver resolution, HR import),
// factored out of container.ts to keep that file under the source-size ratchet.
// Reuses the Email-Notifications M365 app registration (ADR-018), degrading to
// HR/manual resolution when the added Graph scopes are not yet consented.
export const buildPeopleDirectory = ({ env, hrDatasets, users }: PeopleDirectoryDependencies) => {
  const graphConfig =
    env.M365_TENANT_ID && env.M365_CLIENT_ID && env.M365_CLIENT_SECRET
      ? {
          tenantId: env.M365_TENANT_ID,
          clientId: env.M365_CLIENT_ID,
          clientSecret: env.M365_CLIENT_SECRET,
        }
      : null;
  const graphClient = new GraphClient(graphConfig);

  return {
    spreadsheetParser: new SpreadsheetParser(),
    graphClient,
    graphPeopleDirectory: new GraphPeopleDirectory(graphClient),
    hrPeopleDirectory: new HrPeopleDirectory(hrDatasets),
    reportingLineResolver: new GraphReportingLineResolver(graphClient, hrDatasets, users),
  };
};
