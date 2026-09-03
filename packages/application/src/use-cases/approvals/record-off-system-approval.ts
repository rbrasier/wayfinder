import {
  domainError,
  err,
  ok,
  offSystemApprovalAllowed,
  offSystemDateError,
  type ApprovalNodeConfig,
  type IApprovalRepository,
  type IAuditLogger,
  type IClock,
  type IFlowNodeRepository,
  type IObjectStorage,
  type ISessionRepository,
  type Result,
} from "@rbrasier/domain";
import type { DecideApproval, DecideApprovalOutput } from "./decide-approval";

export interface RecordOffSystemApprovalInput {
  approvalId: string;
  // Who is entering it. Authorised as the nominator by `DecideApproval`, and
  // recorded on the row beside — never in place of — the approver.
  nominatedByUserId: string;
  // The calendar date the approval happened, as `YYYY-MM-DD`.
  approvedOn: string;
  comment?: string | null;
  evidence: {
    filename: string;
    mimeType: string;
    bytes: Buffer;
  };
  isAdmin?: boolean;
}

// Object keys are addressed, listed and logged, so the filename is reduced to
// characters that survive all three. The name the person recognises is kept on
// the row; this is only how the bytes are addressed.
const safeFilename = (filename: string): string => filename.replace(/[^a-zA-Z0-9._-]/g, "_");

// Records that an approval happened outside Wayfinder (ADR-055).
//
// It owns only what is specific to this path — the per-node switch, the date
// rule, the evidence bytes and its own audit entry — and hands the decision
// itself to `DecideApproval`, which stays the single writer of an approval
// outcome. The authorisation of the *nominator* lives there too, so passing an
// off-system nomination can never be a route past a gate.
export class RecordOffSystemApproval {
  constructor(
    private readonly approvals: IApprovalRepository,
    private readonly sessions: ISessionRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly objectStorage: IObjectStorage,
    private readonly auditLogger: IAuditLogger,
    private readonly decideApproval: DecideApproval,
    private readonly clock: IClock,
  ) {}

  async execute(input: RecordOffSystemApprovalInput): Promise<Result<DecideApprovalOutput>> {
    const found = await this.approvals.findById(input.approvalId);
    if (found.error) return found;
    const approval = found.data;
    if (!approval) {
      return err(domainError("NOT_FOUND", `Approval ${input.approvalId} not found.`));
    }
    if (approval.status !== "pending") {
      return err(domainError("VALIDATION_FAILED", "This approval has already been decided."));
    }

    if (!(await this.nodeAllowsOffSystem(approval.flowId, approval.nodeId))) {
      return err(
        domainError(
          "FORBIDDEN",
          "This approval step does not accept an approval recorded outside Wayfinder.",
        ),
      );
    }

    const sessionResult = await this.sessions.findById(approval.sessionId);
    if (sessionResult.error) return sessionResult;
    const sessionRow = sessionResult.data;
    if (!sessionRow) {
      return err(domainError("NOT_FOUND", `Session ${approval.sessionId} not found.`));
    }

    // The work being approved came into existence when the session started, so
    // that is the floor an approval date is measured against (ADR-055 §1).
    const dateError = offSystemDateError(
      input.approvedOn,
      sessionRow.createdAt,
      this.clock.now(),
    );
    if (dateError) return err(domainError("VALIDATION_FAILED", dateError));

    if (input.evidence.bytes.byteLength === 0) {
      return err(
        domainError("VALIDATION_FAILED", "Attach the evidence that this approval happened."),
      );
    }

    // Every cheap refusal is already behind us, so the common rejection paths
    // never write an object at all.
    const timestamp = this.clock.now().toISOString().replace(/[:.]/g, "-");
    const storagePath = `approval-evidence/${approval.id}/${timestamp}-${safeFilename(input.evidence.filename)}`;
    const stored = await this.objectStorage.put(
      storagePath,
      input.evidence.bytes,
      input.evidence.mimeType,
    );
    if (stored.error) return stored;

    const decided = await this.decideApproval.execute({
      approvalId: approval.id,
      // Ignored for the recorded decider, which resolves to the approver, but
      // it is who is acting and so who the audit trail's actor should be.
      decidedByUserId: input.nominatedByUserId,
      decision: "approved",
      comment: input.comment ?? null,
      isAdmin: input.isAdmin,
      offSystem: {
        nominatedByUserId: input.nominatedByUserId,
        approvedOn: input.approvedOn,
        evidence: {
          filename: input.evidence.filename,
          mimeType: input.evidence.mimeType,
          sizeBytes: input.evidence.bytes.byteLength,
          storagePath: stored.data.key,
        },
      },
    });
    if (decided.error) {
      // The bytes are referenced by nothing now — a refused nomination or one
      // that lost the pending race must not leave an orphan behind. Best-effort:
      // a failed delete costs an unreferenced object, not the outcome.
      await this.objectStorage.delete(stored.data.key).catch(() => undefined);
      return decided;
    }

    // Written alongside the `approval.decided` entry rather than instead of it.
    // One entry cannot carry both actors, and neither reading of the trail —
    // what was decided, and who entered it — should have to reconstruct the
    // other (ADR-055 §8).
    await this.auditLogger.log({
      actorId: input.nominatedByUserId,
      action: "approval.recorded_off_system",
      resourceType: "approval",
      resourceId: approval.id,
      metadata: {
        approvedOn: input.approvedOn,
        evidenceFilename: input.evidence.filename,
        evidenceStoragePath: stored.data.key,
        approverUserId: approval.approverUserId,
        approverEmail: approval.approverEmail,
      },
    });

    return ok(decided.data);
  }

  private async nodeAllowsOffSystem(flowId: string, nodeId: string): Promise<boolean> {
    const nodes = await this.flowNodes.listByFlow(flowId);
    if (nodes.error) return false;
    const config = (nodes.data.find((node) => node.id === nodeId)?.config ??
      {}) as unknown as ApprovalNodeConfig;
    return offSystemApprovalAllowed(config);
  }
}
