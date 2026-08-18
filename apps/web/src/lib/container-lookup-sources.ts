import {
  ApiValueSetAdapter,
  CachingValueSetProvider,
  DirectoryValueSetAdapter,
  DrizzleLookupSourceRepository,
  ManagedValueSetAdapter,
} from "@rbrasier/adapters";
import type { Database } from "@rbrasier/adapters";
import {
  DeleteLookupSource,
  ListLookupSources,
  RegisterLookupSource,
  TestLookupSource,
  UpdateLookupSource,
  ValidateTemplateLookupSources,
} from "@rbrasier/application";
import { domainError, err, isValidLookupCredentialRef, ok, type IPeopleDirectory, type Result } from "@rbrasier/domain";

interface LookupSourceDependencies {
  db: Database;
  // Ranked: accounts first, the external directories augmenting them (ADR-018).
  peopleDirectories: IPeopleDirectory[];
  // Development points an `api` source at a local stub; production never may.
  allowLocalhost: boolean;
}

// A credential reference names an environment variable, and only one inside the
// lookup namespace: without that guard an admin could point a source at
// DATABASE_URL and have it sent as a bearer token to a host they control.
const readCredential = async (credentialRef: string): Promise<Result<string | null>> => {
  if (!isValidLookupCredentialRef(credentialRef)) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${credentialRef}" is not a lookup credential reference.`,
      ),
    );
  }
  return ok(process.env[credentialRef] ?? null);
};

// The lookup-source registry and value-set provider wiring (ADR-050), factored
// out of container.ts to keep that file under the source-size ratchet. The
// caching provider fronts all three kinds, so callers only ever see the port.
export const buildLookupSources = ({
  db,
  peopleDirectories,
  allowLocalhost,
}: LookupSourceDependencies) => {
  const repository = new DrizzleLookupSourceRepository(db);
  const valueSetProvider = new CachingValueSetProvider({
    sources: repository,
    adapters: {
      directory: new DirectoryValueSetAdapter(...peopleDirectories),
      managed: new ManagedValueSetAdapter(repository),
      api: new ApiValueSetAdapter({ readCredential, guardOptions: { allowLocalhost } }),
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
