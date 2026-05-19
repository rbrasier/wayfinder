import type { ServiceStatus } from "@rbrasier/domain";
import Redis from "ioredis";

export class RedisHealthChecker {
  private client: Redis | null = null;

  constructor(private readonly redisUrl: string) {}

  private getClient(): Redis {
    if (!this.client) {
      this.client = new Redis(this.redisUrl, {
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
      });
    }
    return this.client;
  }

  async check(): Promise<ServiceStatus> {
    const start = Date.now();
    try {
      const client = this.getClient();
      await client.connect();
      const pong = await client.ping();
      if (pong !== "PONG") throw new Error(`unexpected ping response: ${pong}`);
      return { ok: true, latencyMs: Date.now() - start };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : "unknown",
      };
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}
