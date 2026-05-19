export type FlowStatus = "draft" | "published";
export type FlowPermissionRole = "owner" | "viewer";

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
}

export interface Flow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  ownerUserId: string;
  status: FlowStatus;
  permissions: FlowPermission[];
  contextDocs: FlowContextDoc[];
  createdAt: Date;
  updatedAt: Date;
}

export interface NewFlow {
  name: string;
  description?: string | null;
  icon?: string | null;
  ownerUserId: string;
}
