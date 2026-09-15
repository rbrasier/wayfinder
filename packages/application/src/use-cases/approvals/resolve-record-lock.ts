import {
  isRecordLocked,
  ok,
  type IApprovalRepository,
  type Result,
  type Session,
} from "@wayfinder/domain";

// Gathers the three facts the domain lock rule needs and applies it. Shared by
// the document and structured-record guards so the two cannot come to disagree
// about when a record is editable — and so neither has to know that "pending"
// and "routed back here" are the conditions that thaw it.
export const resolveRecordLock = async (
  approvals: IApprovalRepository,
  session: Session,
  stepNodeId: string | null,
): Promise<Result<boolean>> => {
  const snapshotResult = await approvals.hasRecordedSnapshot(session.id);
  if (snapshotResult.error) return snapshotResult;
  if (!snapshotResult.data) return ok(false);

  const rowsResult = await approvals.listBySession(session.id);
  if (rowsResult.error) return rowsResult;

  return ok(
    isRecordLocked({
      hasRecordedSnapshot: true,
      hasPendingApproval: rowsResult.data.some((approval) => approval.status === "pending"),
      sessionIsOnStep: stepNodeId !== null && session.currentNodeId === stepNodeId,
    }),
  );
};
