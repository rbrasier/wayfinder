import type { IClock } from "@rbrasier/domain";

export class SystemClock implements IClock {
  now(): Date {
    return new Date();
  }
}
