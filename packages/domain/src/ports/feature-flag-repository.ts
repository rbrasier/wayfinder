import type { FeatureFlag, NewFeatureFlag } from "../entities/feature-flag";
import type { Result } from "../result";

export interface IFeatureFlagRepository {
  findByKey(key: string): Promise<Result<FeatureFlag | null>>;
  upsert(flag: NewFeatureFlag): Promise<Result<FeatureFlag>>;
  list(): Promise<Result<FeatureFlag[]>>;
}
