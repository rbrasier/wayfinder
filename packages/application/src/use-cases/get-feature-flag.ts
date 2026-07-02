import type {
  FeatureFlag,
  IFeatureFlagRepository,
  IFeatureFlagRoleRepository,
  IUserRoleRepository,
  NewFeatureFlag,
  Result,
} from "@rbrasier/domain";
import { ok } from "@rbrasier/domain";

const DEFAULT_ENABLED_FLAGS = new Set(["scheduled_node", "mcp", "skills"]);
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
  {
    id: "default:mcp",
    key: "mcp",
    enabled: true,
    rolloutPct: 100,
    description:
      "Enables MCP in the flow builder — flow-wide context servers and MCP action nodes (scoped to Power Users)",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
  {
    id: "default:skills",
    key: "skills",
    enabled: true,
    rolloutPct: 100,
    description: "Enables attaching library skills to conversational steps (scoped to Power Users)",
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

export class IsFeatureEnabledForUser {
  constructor(
    private readonly repo: IFeatureFlagRepository,
    private readonly flagRoles: IFeatureFlagRoleRepository,
    private readonly userRoles: IUserRoleRepository,
  ) {}

  async execute(userId: string, key: string, isAdmin: boolean): Promise<Result<boolean>> {
    const flag = await this.repo.findByKey(key);
    if (flag.error) return flag;

    const enabled = flag.data?.enabled ?? DEFAULT_ENABLED_FLAGS.has(key);
    if (!enabled) return ok(false);

    const allowlist = await this.flagRoles.listRoleIdsForFlag(key);
    if (allowlist.error) return allowlist;
    if (allowlist.data.length === 0) return ok(true);
    if (isAdmin) return ok(true);

    const userRoleResult = await this.userRoles.listRolesForUser(userId);
    if (userRoleResult.error) return userRoleResult;

    const allowed = new Set(allowlist.data);
    return ok(userRoleResult.data.some((role) => allowed.has(role.id)));
  }
}

export class SetFeatureFlagRoles {
  constructor(
    private readonly repo: IFeatureFlagRepository,
    private readonly flagRoles: IFeatureFlagRoleRepository,
  ) {}

  // Upsert the flag row first so `enabled` is explicit (ADR-022), then replace the
  // allowlist. An empty array clears scoping (⇒ available to everyone).
  async execute(key: string, roleIds: string[]): Promise<Result<void>> {
    const existing = await this.repo.findByKey(key);
    if (existing.error) return existing;

    const enabled = existing.data?.enabled ?? DEFAULT_ENABLED_FLAGS.has(key);
    const upserted = await this.repo.upsert({
      key,
      enabled,
      rolloutPct: existing.data?.rolloutPct ?? 100,
      description: existing.data?.description ?? null,
    });
    if (upserted.error) return upserted;

    return this.flagRoles.replaceRolesForFlag(key, roleIds);
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
