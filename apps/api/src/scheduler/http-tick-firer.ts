import { domainError, err, ok, type Result } from "@rbrasier/domain";
import type { DueScheduleFirer } from "@rbrasier/adapters";

// Drives the scheduler from this long-lived process without owning the firing
// logic: each tick POSTs the internal web tick endpoint (which holds the AI turn
// machinery) with the shared secret. The SchedulerWorker reports health to
// job_registry around these calls.
export class HttpTickFirer implements DueScheduleFirer {
  constructor(
    private readonly url: string,
    private readonly secret: string,
  ) {}

  async execute(): Promise<Result<unknown>> {
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: { "x-scheduler-secret": this.secret },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return err(
          domainError("INFRA_FAILURE", `Scheduler tick endpoint returned ${response.status}. ${body}`),
        );
      }
      const payload = (await response.json().catch(() => ({}))) as unknown;
      return ok(payload);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to reach scheduler tick endpoint.", cause));
    }
  }
}
