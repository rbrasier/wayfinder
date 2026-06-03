// Injectable time source so scheduling logic is testable without waiting.
export interface IClock {
  now(): Date;
}
