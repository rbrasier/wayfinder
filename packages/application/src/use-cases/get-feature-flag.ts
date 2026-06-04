import type { FeatureFlag, IFeatureFlagRepository, NewFeatureFlag, Result } from "@rbrasier/domain";
import { ok } from "@rbrasier/domain";

const DEFAULT_ENABLED_FLAGS = new Set(["scheduled_node"]);
const DEFAULT_FEATURE_FLAGS: FeatureFlag[] = [
  {
    id: "default:scheduled_node",
    key: "scheduled_node",
    enabled: true,
    rolloutPct: 100,
    description: "Enables scheduled nodes in flow builder and at runtime",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
];

export class GetFeatureFlag {
  constructor(private readonly repo: IFeatureFlagRepository) {}

  execute(key: string): Promise<Result<FeatureFlag | null>> {
    return this.repo.findByKey(key);
  }
}

export class IsFeatureEnabled {
  constructor(private readonly repo: IFeatureFlagRepository) {}

  async execute(key: string): Promise<Result<boolean>> {
    const flag = await this.repo.findByKey(key);
    if (flag.error) return flag;
    return ok(flag.data?.enabled ?? DEFAULT_ENABLED_FLAGS.has(key));
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

  async execute(): Promise<Result<FeatureFlag[]>> {
    const flags = await this.repo.list();
    if (flags.error) return flags;

    const persistedKeys = new Set(flags.data.map((flag) => flag.key));
    const defaults = DEFAULT_FEATURE_FLAGS.filter((flag) => !persistedKeys.has(flag.key));
    return ok([...flags.data, ...defaults].sort((a, b) => a.key.localeCompare(b.key)));
  }
}
