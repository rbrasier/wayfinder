import type { PermissionKey } from "@rbrasier/domain";
import type { Container } from "@/lib/container";
import { appRouter } from "./router";
import { createCallerFactory, type TrpcContext } from "./trpc";

// Probes the gate a procedure enforces before its resolver runs. Every container
// access past the error logger throws, so a caller that clears the gate fails
// with something other than FORBIDDEN/UNAUTHORIZED and no side effect happens.

export const PROBE_CALLERS = {
  ordinary: { isAdmin: false, permissions: [] as PermissionKey[] },
  global: { isAdmin: true, permissions: [] as PermissionKey[] },
  technical: { isAdmin: false, permissions: ["admin:technical"] as PermissionKey[] },
  users: { isAdmin: false, permissions: ["admin:users"] as PermissionKey[] },
  oversight: { isAdmin: false, permissions: ["admin:oversight"] as PermissionKey[] },
} as const;

export type ProbeCaller = keyof typeof PROBE_CALLERS;

const refusingProxy = (): unknown =>
  new Proxy(() => undefined, {
    get: (_target, property) => {
      if (property === "then") return undefined;
      return refusingProxy();
    },
    apply: () => {
      throw new Error("container access in gate probe");
    },
  });

const probeContainer = new Proxy(
  {},
  {
    get: (_target, property) => {
      if (property === "services") {
        return new Proxy(
          {},
          {
            get: (_services, name) =>
              name === "errorLogger" ? { log: async () => undefined } : refusingProxy(),
          },
        );
      }
      return refusingProxy();
    },
  },
) as Container;

interface ProbeIdentity {
  readonly isAdmin: boolean;
  readonly permissions: readonly PermissionKey[];
}

const contextFor = (identity: ProbeIdentity): TrpcContext => ({
  container: probeContainer,
  userId: "probe-user",
  authSessionId: null,
  isAdmin: identity.isAdmin,
  permissions: new Set(identity.permissions),
  headers: new Headers(),
});

const createCaller = createCallerFactory(appRouter);

export const procedurePaths = (): string[] =>
  Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures).sort();

const invoke = (caller: ReturnType<typeof createCaller>, path: string, input: unknown): Promise<unknown> => {
  const segments = path.split(".");
  let target: unknown = caller;
  for (const segment of segments) {
    target = (target as Record<string, unknown>)[segment];
  }
  return (target as (value: unknown) => Promise<unknown>)(input);
};

const passes = async (path: string, identity: ProbeIdentity, input: unknown): Promise<boolean> => {
  try {
    await invoke(createCaller(contextFor(identity)), path, input);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code !== "FORBIDDEN" && code !== "UNAUTHORIZED";
  }
};

export const passesGateWith = (
  path: string,
  permissions: readonly PermissionKey[],
  input: unknown = undefined,
): Promise<boolean> => passes(path, { isAdmin: false, permissions }, input);

export const gateProfile = async (path: string, input?: unknown): Promise<ProbeCaller[]> => {
  const passing: ProbeCaller[] = [];
  for (const caller of Object.keys(PROBE_CALLERS) as ProbeCaller[]) {
    if (await passes(path, PROBE_CALLERS[caller], input)) passing.push(caller);
  }
  return passing;
};
