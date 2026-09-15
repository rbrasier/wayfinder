import type { Approval, IUserRepository } from "@wayfinder/domain";

export interface SuggestedApprover {
  userId: string;
  name: string | null;
  email: string;
}

// The identity actually written on the row, as opposed to the one the resolver
// proposed. They differ whenever the request has already been sent — and on a
// chained approval the row is assigned by the *previous approver*, so without
// this the gate can neither name the approver nor build a mailto for them.
export interface AssignedApprover {
  userId: string | null;
  name: string | null;
  email: string | null;
}

// Shared by `SuggestApprover` (which may create the row) and
// `LoadPendingApproval` (which only reads it), so the two cannot come to
// describe the same row differently — the same reason the subject resolver is
// shared rather than duplicated (ADR-040 §2).
export const describeApprover = async (
  users: IUserRepository,
  userId: string | null,
): Promise<SuggestedApprover | null> => {
  if (!userId) return null;
  const result = await users.findById(userId);
  if (result.error || !result.data) return null;
  return { userId: result.data.id, name: result.data.name, email: result.data.email };
};

// Null until an approver is confirmed. An email-only assignment (ADR-018)
// resolves to the address alone, which is all the gate needs to name it.
export const describeAssignedApprover = async (
  users: IUserRepository,
  approval: Approval,
): Promise<AssignedApprover | null> => {
  if (approval.approverUserId) {
    const described = await describeApprover(users, approval.approverUserId);
    if (described) return described;
    return { userId: approval.approverUserId, name: null, email: approval.approverEmail };
  }
  if (approval.approverEmail) {
    return { userId: null, name: null, email: approval.approverEmail };
  }
  return null;
};
