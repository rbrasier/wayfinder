// A person's standing on a collaborative session (scaling wall #11). Membership
// is a row, not knowledge of the URL: the server authorises sends against the
// stored role, so revocation is real and every join is auditable.
//
// - owner        the session originator; always allowed, never stored as a row
//                (it is implied by app_sessions.user_id, so legacy sessions need
//                no back-fill).
// - collaborator may read and send.
// - viewer       may read only. Revoking a collaborator downgrades them to
//                viewer, so their next send is rejected while they keep read
//                access.
export type SessionParticipantRole = "owner" | "collaborator" | "viewer";

export interface SessionParticipant {
  id: string;
  sessionId: string;
  userId: string;
  role: SessionParticipantRole;
  joinedAt: Date;
  invitedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSessionParticipant {
  sessionId: string;
  userId: string;
  role: SessionParticipantRole;
  invitedBy?: string | null;
}

// Whether a role may send messages (own a turn). Viewers and non-participants
// cannot; owners and collaborators can.
export const roleCanSend = (role: SessionParticipantRole): boolean =>
  role === "owner" || role === "collaborator";
