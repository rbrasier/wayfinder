export type FlowStatus = "draft" | "published";
export type FlowPermissionRole = "owner" | "viewer";
export type ExtractionStatus = "pending" | "complete" | "failed" | "unsupported";

export type FlowVisibility =
  | { kind: "private" }
  | { kind: "global" };

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
  status: FlowStatus;
  visibility: FlowVisibility;
  permissions: FlowPermission[];
  contextDocs: FlowContextDoc[];
  // Ids of `context`-kind MCP servers attached flow-wide (ADR-032). Their tools
  // are offered read-only to the conversational AI across every step, the same
  // way context docs ground the whole flow.
  contextMcpServerIds: string[];
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
}
