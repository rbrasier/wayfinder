import {
  ok,
  type Flow,
  type FlowPermission,
  type IAuditLogger,
  type IEmailSender,
  type INotificationLogRepository,
  type IUserRepository,
  type NotificationLog,
  type Result,
} from "@wayfinder/domain";
import type { NotificationConfig } from "./notify-on-session-complete";
import { buildFlowSharedEmail } from "./templates";

export interface NotifyOnFlowSharedInput {
  // The flow after the permission change; the diff against previousPermissions
  // decides who is newly added.
  flow: Flow;
  previousPermissions: FlowPermission[];
  grantedByUserId: string | null;
}

export class NotifyOnFlowShared {
  constructor(
    private readonly notificationLog: INotificationLogRepository,
    private readonly emailSender: IEmailSender,
    private readonly users: IUserRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly config: NotificationConfig,
  ) {}

  // Best-effort per recipient: one failed send marks that row `failed` and
  // moves on, and the share action itself is never broken by email.
  async execute(input: NotifyOnFlowSharedInput): Promise<Result<NotificationLog[]>> {
    if (this.config.isTriggerEnabled && !(await this.config.isTriggerEnabled("flow_shared"))) {
      return ok([]);
    }

    const newlyAdded = this.newlyAddedPermissions(input);
    if (newlyAdded.length === 0) return ok([]);

    const granterName = await this.resolveGranterName(input.grantedByUserId);

    const rows: NotificationLog[] = [];
    for (const permission of newlyAdded) {
      const row = await this.notifyRecipient(input.flow, permission, granterName);
      if (row) rows.push(row);
    }
    return ok(rows);
  }

  private newlyAddedPermissions(input: NotifyOnFlowSharedInput): FlowPermission[] {
    const previousUserIds = new Set(input.previousPermissions.map((p) => p.userId));
    return input.flow.permissions.filter(
      (p) => !previousUserIds.has(p.userId) && p.userId !== input.grantedByUserId,
    );
  }

  private async resolveGranterName(grantedByUserId: string | null): Promise<string | null> {
    if (!grantedByUserId) return null;
    const granter = await this.users.findById(grantedByUserId);
    if (granter.error || !granter.data) return null;
    return granter.data.name ?? granter.data.email;
  }

  private async notifyRecipient(
    flow: Flow,
    permission: FlowPermission,
    granterName: string | null,
  ): Promise<NotificationLog | null> {
    const recipientResult = await this.users.findById(permission.userId);
    const recipientEmail = recipientResult.data?.email ?? "";

    const existsResult = await this.notificationLog.existsFor(
      "flow_shared",
      flow.id,
      recipientEmail,
    );
    if (existsResult.error || existsResult.data) return null;

    const email = buildFlowSharedEmail({
      flowName: flow.name,
      granterName,
      role: permission.role,
      flowUrl: `${this.config.baseUrl}/admin/flows/${flow.id}`,
    });

    const enqueueResult = await this.notificationLog.enqueue({
      recipientEmail,
      recipientUserId: permission.userId,
      trigger: "flow_shared",
      resourceType: "flow",
      resourceId: flow.id,
      subject: email.subject,
    });
    if (enqueueResult.error || !enqueueResult.data) return null;
    const row = enqueueResult.data;

    if (!recipientEmail) {
      const failed = await this.notificationLog.markFailed(
        row.id,
        "Recipient has no usable email address.",
      );
      return failed.data ?? row;
    }

    if (!this.config.enabled) return row;

    const sendResult = await this.emailSender.send({
      to: recipientEmail,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    if (sendResult.error) {
      const failed = await this.notificationLog.markFailed(row.id, sendResult.error.message);
      await this.auditLogger.log({
        action: "notification.failed",
        resourceType: "flow",
        resourceId: flow.id,
        metadata: { trigger: "flow_shared", recipientEmail, error: sendResult.error.message },
      });
      return failed.data ?? row;
    }

    const sent = await this.notificationLog.markSent(row.id);
    await this.auditLogger.log({
      action: "notification.sent",
      resourceType: "flow",
      resourceId: flow.id,
      metadata: { trigger: "flow_shared", recipientEmail },
    });
    return sent.data ?? row;
  }
}
