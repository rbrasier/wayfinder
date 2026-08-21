import {
  AiValueSetShortlister,
  ApiValueSetAdapter,
  CachingValueSetProvider,
  DirectoryValueSetAdapter,
  DrizzleLookupSourceRepository,
  ManagedValueSetAdapter,
} from "@rbrasier/adapters";
import type { Database, SettingsEncryptionService } from "@rbrasier/adapters";
import type { ILanguageModel } from "@rbrasier/domain";
import {
  DeleteLookupSource,
  ListLookupSources,
  ListManagedEntries,
  ReplaceManagedEntries,
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
  // Backs the inferred rung of the matching ladder (ADR-051 §3).
  languageModel: ILanguageModel;
}

// The lookup-source registry and value-set provider wiring (ADR-050), factored
// out of container.ts to keep that file under the source-size ratchet. The
// caching provider fronts all three kinds, so callers only ever see the port.
export const buildLookupSources = ({
  db,
  peopleDirectories,
  allowLocalhost,
  encryption,
  languageModel,
}: LookupSourceDependencies) => {
  const repository = new DrizzleLookupSourceRepository(db, encryption);
  const valueSetProvider = new CachingValueSetProvider({
    sources: repository,
    adapters: {
      directory: new DirectoryValueSetAdapter(...peopleDirectories),
      managed: new ManagedValueSetAdapter(repository),
      api: new ApiValueSetAdapter({ guardOptions: { allowLocalhost } }),
    },
    shortlister: new AiValueSetShortlister(languageModel),
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
      listManagedEntries: new ListManagedEntries(repository),
      replaceManagedEntries: new ReplaceManagedEntries(repository),
    },
  };
};
