import type { RoadmapDerivedStatus, RoadmapResourceStatus } from "@sebela/api-client";

// The colours of a status on the timeline's markers. Hover and open variants repeat the colour, so
// the shared trigger's monochrome hover and open states do not repaint a coloured marker.
const TRIGGER_MARKERS: Readonly<Record<RoadmapDerivedStatus, string>> = {
  completed:
    "border-transparent bg-success text-white group-hover/timeline-trigger:border-transparent group-hover/timeline-trigger:text-white group-data-[panel-open]/timeline-trigger:border-transparent group-data-[panel-open]/timeline-trigger:text-white",
  "in-progress":
    "border-transparent bg-primary text-primary-foreground group-hover/timeline-trigger:border-transparent group-hover/timeline-trigger:text-primary-foreground group-data-[panel-open]/timeline-trigger:border-transparent group-data-[panel-open]/timeline-trigger:text-primary-foreground",
  planned:
    "border-transparent bg-muted text-muted-foreground group-hover/timeline-trigger:border-transparent group-hover/timeline-trigger:text-muted-foreground group-data-[panel-open]/timeline-trigger:border-transparent group-data-[panel-open]/timeline-trigger:text-muted-foreground",
};

/** The marker of an area or a module in its derived status. */
export function triggerMarker(status: RoadmapDerivedStatus): string {
  return `${TRIGGER_MARKERS[status]} transition-transform group-hover/timeline-trigger:scale-110`;
}

const RESOURCE_MARKERS: Readonly<Record<RoadmapResourceStatus, string>> = {
  completed: "border-2 border-success bg-success text-white",
  "in-progress": "border-2 border-primary bg-primary text-primary-foreground",
  planned: "border-2 border-border bg-muted text-muted-foreground",
  paused: "border-2 border-warning bg-warning text-white",
  skipped: "border-2 border-border bg-muted/50 text-muted-foreground",
};

/** The marker of a resource in its own status. */
export function resourceMarker(status: RoadmapResourceStatus): string {
  return RESOURCE_MARKERS[status];
}

const RESOURCE_STATUS_WORDS: Readonly<Record<RoadmapResourceStatus, string>> = {
  completed: "Completed",
  "in-progress": "In progress",
  planned: "Planned",
  paused: "Paused",
  skipped: "Skipped",
};

/** A resource's status in words, for screen readers. */
export function resourceStatusWords(status: RoadmapResourceStatus): string {
  return RESOURCE_STATUS_WORDS[status];
}
