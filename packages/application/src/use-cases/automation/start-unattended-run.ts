import {
  ok,
  triggerInputsOfSnapshot,
  validateTriggerPayload,
  type IFlowRepository,
  type IFlowVersionRepository,
  type ISessionRepository,
  type IUserRepository,
  type Result,
  type Session,
  type TriggerInput,
} from "@rbrasier/domain";
import type { StartSession } from "../session/start-session";

export interface StartUnattendedRunDependencies {
  users: Pick<IUserRepository, "findById">;
  flows: Pick<IFlowRepository, "findById">;
  flowVersions: Pick<IFlowVersionRepository, "latestPublished">;
  startSession: Pick<StartSession, "execute">;
  sessions: Pick<ISessionRepository, "update">;
}

export interface StartUnattendedRunInput {
  flowId: string;
  runAsUserId: string;
  origin: "watch" | "webhook";
  // The watch or flow-trigger id — what run history is queried by.
  triggerSourceId: string;
  inputs: unknown;
  raw: unknown;
  itemId?: string | null;
}

export type StartUnattendedRunOutput =
  | { started: true; session: Session }
  | {
      started: false;
      reason: "run_as_unavailable" | "flow_unavailable" | "invalid_inputs";
      message: string;
    };

// Kept for audit and debugging only, so a huge body is replaced by a marker
// rather than bloating every session row (ADR-064 §4).
const MAX_RAW_PAYLOAD_BYTES = 256 * 1024;

const capRaw = (raw: unknown): unknown => {
  const bytes = JSON.stringify(raw ?? null).length;
  return bytes > MAX_RAW_PAYLOAD_BYTES ? { truncated: true, bytes } : raw;
};

// Starts a session nobody is at the keyboard for (ADR-065 §1). The run-as user
// owns it, so it appears in their session list and spends their budget. Inputs
// are checked against the version the session will be pinned to, not the live
// flow, so they match what its steps will read. Does not drive the run; the
// caller kicks AdvanceUnattendedRun once the session exists.
export class StartUnattendedRun {
  constructor(private readonly dependencies: StartUnattendedRunDependencies) {}

  async execute(input: StartUnattendedRunInput): Promise<Result<StartUnattendedRunOutput>> {
    const user = await this.dependencies.users.findById(input.runAsUserId);
    if (user.error) return user;
    if (!user.data) {
      return ok({ started: false, reason: "run_as_unavailable", message: "The run-as user no longer exists." });
    }

    const flow = await this.dependencies.flows.findById(input.flowId);
    if (flow.error) return flow;
    if (!flow.data || flow.data.deletedAt || flow.data.status !== "published") {
      return ok({ started: false, reason: "flow_unavailable", message: "The flow is not published." });
    }

    const declared = await this.declaredInputs(input.flowId, flow.data.triggerInputs ?? []);
    if (declared.error) return declared;
    const validated = validateTriggerPayload(declared.data, input.inputs);
    if (validated.error) {
      return ok({ started: false, reason: "invalid_inputs", message: validated.error.message });
    }

    const session = await this.dependencies.startSession.execute({
      flowId: input.flowId,
      userId: input.runAsUserId,
      origin: input.origin,
      triggerSourceId: input.triggerSourceId,
      triggerPayload: { inputs: validated.data, raw: capRaw(input.raw), itemId: input.itemId ?? null },
    });
    if (session.error) return session;

    const title = input.itemId ? `${flow.data.name} · ${input.itemId}` : flow.data.name;
    await this.dependencies.sessions.update(session.data.id, { title });
    return ok({ started: true, session: { ...session.data, title } });
  }

  private async declaredInputs(flowId: string, liveInputs: TriggerInput[]): Promise<Result<TriggerInput[]>> {
    const version = await this.dependencies.flowVersions.latestPublished(flowId);
    if (version.error) return version;
    return ok(version.data ? triggerInputsOfSnapshot(version.data.snapshot) : liveInputs);
  }
}
