import type { FlowLesson, FlowUsageStats } from "@rbrasier/domain";

// Three states, not two: an author with a crowded canvas needs the panel gone
// entirely, and one reading evidence needs it over the canvas.
export type FlowMemoryPanelState = "hidden" | "narrow" | "expanded";

const PANEL_STATES: readonly FlowMemoryPanelState[] = ["hidden", "narrow", "expanded"];

// Per user per flow. A display preference is not worth a table, and it will not
// follow a user across devices — which is acceptable, and stated in the PRD.
export const panelStateStorageKey = (flowId: string): string => `wayfinder.flow-memory.${flowId}`;

// The minimal slice of Storage this needs, so the model can be tested without a
// browser and a page with storage blocked degrades to the default rather than
// throwing on mount.
export interface PanelStateStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const isPanelState = (value: unknown): value is FlowMemoryPanelState =>
  typeof value === "string" && PANEL_STATES.includes(value as FlowMemoryPanelState);

// `narrow` is the default on a published flow: the author asked for memory by
// publishing, so it starts visible but not in the way.
export const readPanelState = (
  store: PanelStateStore | null,
  flowId: string,
): FlowMemoryPanelState => {
  if (!store) return "narrow";
  try {
    const stored = store.getItem(panelStateStorageKey(flowId));
    return isPanelState(stored) ? stored : "narrow";
  } catch {
    // Private windows and blocked site data throw on access rather than
    // returning null. A remembered panel width is never worth a crash.
    return "narrow";
  }
};

export const writePanelState = (
  store: PanelStateStore | null,
  flowId: string,
  state: FlowMemoryPanelState,
): void => {
  if (!store) return;
  try {
    store.setItem(panelStateStorageKey(flowId), state);
  } catch {
    // As above: losing the preference is survivable, failing the interaction is not.
  }
};

// Opening a lesson expands; dismissing returns to narrow rather than to hidden,
// so the canvas comes back without the panel disappearing under the author.
export const stateAfterOpeningLesson = (): FlowMemoryPanelState => "expanded";
export const stateAfterDismissingDrawer = (): FlowMemoryPanelState => "narrow";
export const stateAfterCollapsing = (): FlowMemoryPanelState => "hidden";
export const stateAfterReopening = (): FlowMemoryPanelState => "narrow";

// The panel exists to surface decisions, so lessons awaiting one come first.
// Rejected and retired lessons are inert and are not listed at all: showing an
// author a decision they already made, or one the system made for them, is noise.
export const visibleLessons = (lessons: FlowLesson[]): FlowLesson[] =>
  lessons.filter((lesson) => lesson.status === "proposed" || lesson.status === "accepted");

export const proposedCount = (lessons: FlowLesson[]): number =>
  lessons.filter((lesson) => lesson.status === "proposed").length;

export interface StatTile {
  key: keyof FlowUsageStats;
  label: string;
  value: number;
}

export const statTiles = (stats: FlowUsageStats): StatTile[] => [
  { key: "total", label: "Total chats", value: stats.total },
  { key: "completed", label: "Completed", value: stats.completed },
  { key: "inProgress", label: "In progress", value: stats.inProgress },
  { key: "stale", label: "Stale", value: stats.stale },
  { key: "abandoned", label: "Abandoned", value: stats.abandoned },
];

// An imported or duplicated flow starts with no memory, because ADR-049 rewrites
// node ids on import and a lesson binds to a node id. An author who duplicated a
// flow to iterate on it would otherwise think the feature was broken.
export const EMPTY_STATE_MESSAGE =
  "No lessons yet. This flow learns from completed chats — and a flow imported or duplicated from another starts fresh, because its steps are new.";

export const evidenceLabel = (count: number): string =>
  count === 1 ? "1 session" : `${count} sessions`;
