import {
  ApiValueSetAdapter,
  CachingValueSetProvider,
  DirectoryValueSetAdapter,
  DrizzleLookupSourceRepository,
  ManagedValueSetAdapter,
} from "@rbrasier/adapters";
import type { Database, SettingsEncryptionService } from "@rbrasier/adapters";
import {
  DeleteLookupSource,
  ListLookupSources,
  RegisterLookupSource,
  TestLookupSource,
  UpdateLookupSource,
  ValidateTemplateLookupSources,
} from "@rbrasier/application";
import type { IPeopleDirectory } from "@rbrasier/domain";

interface LookupSourceDependencies {
  db: Database;
  // Ranked: accounts first, the external directories augmenting them (ADR-018).
  peopleDirectories: IPeopleDirectory[];
  // Development points an `api` source at a local stub; production never may.
  allowLocalhost: boolean;
  // The same service that protects the n8n, AI and SMTP secrets.
  encryption: SettingsEncryptionService;
}

// The lookup-source registry and value-set provider wiring (ADR-050), factored
// out of container.ts to keep that file under the source-size ratchet. The
// caching provider fronts all three kinds, so callers only ever see the port.
export const buildLookupSources = ({
  db,
  peopleDirectories,
  allowLocalhost,
  encryption,
}: LookupSourceDependencies) => {
  const repository = new DrizzleLookupSourceRepository(db, encryption);
  const valueSetProvider = new CachingValueSetProvider({
    sources: repository,
    adapters: {
      directory: new DirectoryValueSetAdapter(...peopleDirectories),
      managed: new ManagedValueSetAdapter(repository),
      api: new ApiValueSetAdapter({ guardOptions: { allowLocalhost } }),
    },
  });

  return {
    repository,
    valueSetProvider,
    useCases: {
      listLookupSources: new ListLookupSources(repository),
      registerLookupSource: new RegisterLookupSource(repository),
      updateLookupSource: new UpdateLookupSource(repository),
      deleteLookupSource: new DeleteLookupSource(repository),
      testLookupSource: new TestLookupSource(valueSetProvider),
      validateTemplateLookupSources: new ValidateTemplateLookupSources(repository),
    },
  };
};
