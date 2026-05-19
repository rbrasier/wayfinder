import type { FeatureFlag, IFeatureFlagRepository, NewFeatureFlag, Result } from "@rbrasier/domain";

export class GetFeatureFlag {
  constructor(private readonly repo: IFeatureFlagRepository) {}

  execute(key: string): Promise<Result<FeatureFlag | null>> {
    return this.repo.findByKey(key);
  }
}

export class UpsertFeatureFlag {
  constructor(private readonly repo: IFeatureFlagRepository) {}

  execute(flag: NewFeatureFlag): Promise<Result<FeatureFlag>> {
    return this.repo.upsert(flag);
  }
}

export class ListFeatureFlags {
  constructor(private readonly repo: IFeatureFlagRepository) {}

  execute(): Promise<Result<FeatureFlag[]>> {
    return this.repo.list();
  }
}
