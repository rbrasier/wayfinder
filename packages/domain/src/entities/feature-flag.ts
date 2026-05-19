export interface FeatureFlag {
  readonly id: string;
  readonly key: string;
  readonly enabled: boolean;
  readonly rolloutPct: number;
  readonly description: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewFeatureFlag {
  readonly key: string;
  readonly enabled?: boolean;
  readonly rolloutPct?: number;
  readonly description?: string | null;
}
