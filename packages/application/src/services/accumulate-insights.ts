import type { SessionMessage } from "@rbrasier/domain";

export interface Insight {
  key: string;
  value: string;
}

// Assistant turns gather insights; a system message carries them only when it
// opens an unattended run with its trigger inputs (`run-started-message.ts`).
export function accumulateInsights(messages: SessionMessage[]): Insight[] {
  const order: string[] = [];
  const values = new Map<string, string>();

  for (const message of messages) {
    if (message.role === "user") continue;
    const payload = message.aiPayload;
    if (!payload) continue;

    for (const item of payload.contextGathered) {
      if (!values.has(item.key)) order.push(item.key);
      values.set(item.key, item.value);
    }
  }

  return order.map((key) => ({ key, value: values.get(key) ?? "" }));
}
