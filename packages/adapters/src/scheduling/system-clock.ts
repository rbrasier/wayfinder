import type { IClock } from "@wayfinder/domain";

export class SystemClock implements IClock {
  now(): Date {
    return new Date();
  }
}
