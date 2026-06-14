import type { ConnectivityResult, ConnectivityTarget } from "../entities/connectivity";
import type { Result } from "../result";

// Runs lightweight live probes against external dependencies so an admin can
// confirm each integration is reachable with the saved credentials. Probes never
// send real artefacts (no email, no stored object) or burn AI tokens.
export interface IConnectivityTester {
  test(target: ConnectivityTarget): Promise<Result<ConnectivityResult>>;
  // Runs every applicable probe in parallel; unconfigured targets come back
  // flagged `skipped` rather than failing.
  testAll(): Promise<Result<ConnectivityResult[]>>;
}
