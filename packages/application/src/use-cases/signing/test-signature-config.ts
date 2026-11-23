import {
  requiredSignatureTargets,
  type ConnectivityResult,
  type ISignatureServicesProbe,
  type SignatureConfig,
  type SignatureServiceTarget,
} from "@wayfinder/domain";

// Runs the live probes a signature config needs (ADR-067 §6), against the
// candidate values rather than whatever is stored, so the admin's Test and the
// save gate both judge exactly what is about to be saved.
export class TestSignatureConfig {
  constructor(private readonly probe: ISignatureServicesProbe) {}

  async execute(config: SignatureConfig): Promise<ConnectivityResult[]> {
    const targets = requiredSignatureTargets(config) as SignatureServiceTarget[];
    return Promise.all(targets.map((target) => this.probe.probe(target, config)));
  }
}
