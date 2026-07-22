export type FlowStatus = "draft" | "published";
export type FlowPermissionRole = "owner" | "viewer";

// Discriminates the two flow paradigms (ADR-033). Guided code paths never read
// this — it defaults to "guided" so every existing flow is untouched. An
// extraction flow carries an extraction schema instead of a node graph.
export type FlowType = "guided" | "extraction";
export type ExtractionStatus = "pending" | "complete" | "failed" | "unsupported";

export type FlowVisibility =
  | { kind: "private" }
  | { kind: "global" }
  | { kind: "group"; groupIds: string[] }
  // Visible to users in the flow owner's organisation (ADR-038). The owner's
  // organisation is resolved at listing time from `owner_user_id`, so this
  // variant carries no id of its own — it always means "the owner's organisation".
  | { kind: "organisation" };

export type FlowVisibilityKind = FlowVisibility["kind"];

export interface FlowPermission {
  userId: string;
  role: FlowPermissionRole;
}

export interface FlowContextDoc {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  extractedText: string | null;
  extractionStatus: ExtractionStatus;
}

export interface Flow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  expertRole: string | null;
  ownerUserId: string;
  flowType: FlowType;
  status: FlowStatus;
  visibility: FlowVisibility;
  permissions: FlowPermission[];
  contextDocs: FlowContextDoc[];
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewFlow {
  name: string;
  description?: string | null;
  icon?: string | null;
  expertRole?: string | null;
  ownerUserId: string;
  // Defaults to "guided" at the persistence layer when omitted (ADR-033 §1).
  flowType?: FlowType;
}
